import type { AppliedLook, Circuit, LookDef, LayerSpec, Scheme } from '../../protocol.ts';
import { starterCircuit } from '../render/circuit.ts';

/**
 * What every pane needs from a scheme: how to read one, and how to change it.
 *
 * The changes all return a whole new scheme rather than mutating one, because
 * that is what goes on the wire: the editor sends the scheme entire, the server
 * writes it, and the resolved answer comes back. See `protocol.ts` on why it is
 * whole rather than a patch.
 */

/**
 * An effect as anything reading a layer spells it.
 *
 * Its name — an id is a key and never shown — and its amount when that is worth
 * the room. A column of "100"s says nothing and pushes the useful columns off
 * the edge. Shared between the panel and the layers pane so a layer reads the
 * same in both.
 */
export function lookLabel(scheme: Scheme | null, look: AppliedLook): string {
  const name = scheme?.looks[look.id]?.name ?? look.id;
  return look.amount > 0.95 ? name : `${name} ${Math.round(look.amount * 100)}`;
}

/** An effect id and what to call it, built-ins first and each group by name. */
export function lookList(scheme: Scheme): { id: string; def: LookDef }[] {
  return Object.entries(scheme.looks)
    .map(([id, def]) => ({ id, def }))
    .sort((a, b) => {
      const kind = Number(Boolean(a.def.circuit)) - Number(Boolean(b.def.circuit));
      return kind !== 0 ? kind : (a.def.name || a.id).localeCompare(b.def.name || b.id);
    });
}

/** Add or remove one id, keeping the order the rest were already in. */
export function toggleId(list: readonly string[] | undefined, id: string, on: boolean): string[] {
  const held = list ?? [];
  return on ? (held.includes(id) ? [...held] : [...held, id]) : held.filter((x) => x !== id);
}

/**
 * A spec with one field changed, or dropped entirely once it says nothing.
 *
 * The dropping matters more than it looks. A binding is what makes the editor
 * legible — a track that appears in `layers` has been *decided about* — so a
 * binding left behind after its last field was cleared would claim a decision
 * nobody made, and would keep the name hint from applying ever again.
 */
export function setLayer(
  layers: Record<string, LayerSpec>,
  name: string,
  next: Partial<LayerSpec>,
): Record<string, LayerSpec> {
  const merged: LayerSpec = { ...layers[name], ...next };
  for (const key of Object.keys(merged) as (keyof LayerSpec)[]) {
    const value = merged[key];
    if (value === undefined || (Array.isArray(value) && value.length === 0)) delete merged[key];
  }
  const out = { ...layers };
  if (Object.keys(merged).length === 0) delete out[name];
  else out[name] = merged;
  return out;
}

/** The next free `fx*` id. Ids are stable and never shown; names are neither. */
export function freeLookId(scheme: Scheme): string {
  for (let n = 1; ; n++) {
    const id = `fx${n}`;
    if (!scheme.looks[id]) return id;
  }
}

export function addCircuit(scheme: Scheme): { scheme: Scheme; id: string } {
  const id = freeLookId(scheme);
  const used = new Set(Object.values(scheme.looks).map((def) => def.name));
  let name = 'New effect';
  for (let n = 2; used.has(name); n++) name = `New effect ${n}`;
  return {
    id,
    scheme: {
      ...scheme,
      looks: { ...scheme.looks, [id]: { name, circuit: starterCircuit() } },
    },
  };
}

/**
 * Delete an effect, and every reference to it.
 *
 * Leaving the references would be survivable — the resolver drops an id it
 * cannot find — but it would also mean a chorus quietly carrying a ghost, and
 * an effect list that could never tell you what an archetype actually does.
 */
export function dropLook(scheme: Scheme, id: string): Scheme {
  const without = (list: string[] | undefined) => list?.filter((x) => x !== id);
  const looks = { ...scheme.looks };
  delete looks[id];
  const strip = <T extends { looks?: string[] }>(record: Record<string, T>) =>
    Object.fromEntries(
      Object.entries(record).map(([key, value]) => [key, { ...value, looks: without(value.looks) }]),
    ) as Record<string, T>;
  return {
    ...scheme,
    looks,
    archetypes: strip(scheme.archetypes),
    layers: strip(scheme.layers),
    clips: strip(scheme.clips),
  };
}

/** One node moved, or its op or value changed. */
export function setNode(
  circuit: Circuit,
  id: string,
  next: Partial<Circuit['nodes'][number]>,
): Circuit {
  return {
    ...circuit,
    nodes: circuit.nodes.map((n) => (n.id === id ? { ...n, ...next } : n)),
  };
}

/** A node and everything that reached it. */
export function dropNode(circuit: Circuit, id: string): Circuit {
  return {
    nodes: circuit.nodes.filter((n) => n.id !== id),
    cords: circuit.cords.filter((c) => !c.from.startsWith(`${id}/`) && !c.to.startsWith(`${id}/`)),
  };
}

/**
 * Wire an outlet to an inlet, replacing whatever fed that inlet.
 *
 * One cord per inlet, because an inlet is one value. Replacing rather than
 * refusing is the behaviour that makes rewiring a gesture instead of a chore:
 * you drag the new cord where you want it and the old one gets out of the way.
 */
export function connect(circuit: Circuit, from: string, to: string): Circuit {
  return {
    ...circuit,
    cords: [...circuit.cords.filter((c) => c.to !== to), { from, to }],
  };
}

export function disconnect(circuit: Circuit, to: string): Circuit {
  return { ...circuit, cords: circuit.cords.filter((c) => c.to !== to) };
}

/** A node id nothing in this circuit is using. */
export function freeNodeId(circuit: Circuit, kind: string): string {
  for (let n = 1; ; n++) {
    const id = `${kind}${n}`;
    if (!circuit.nodes.some((node) => node.id === id)) return id;
  }
}
