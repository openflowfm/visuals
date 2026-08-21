import type { Circuit, LookDef } from '../../protocol.ts';
import { compileLook, flatten, knobsOf, energiesOf, tracksOf, type Compiled } from './circuit.ts';

/**
 * What a look *is*, independent of who is drawing it.
 *
 * The stage and the bench both take a look id and need the same things out of
 * it — the shader, the banks its knobs and meters ride in, and whether the
 * shader it has is still the right one. Keeping those here is what stops the
 * bench from being a second, subtly different renderer: two things that
 * disagreed about what a look looks like would be worse than one preview.
 */

/**
 * Everything a look compiles to, cached by its structure.
 *
 * A look is compiled from **the whole library**, not from its own graph, because
 * a `look` node is replaced by the graph it names. That means a look's shader
 * changes when a look it contains changes, which is exactly right and is the
 * reason the signature below walks the same expansion.
 */
export function buildLook(looks: Record<string, LookDef>, id: string): Compiled {
  return compileLook(looks, id);
}

/**
 * What it was compiled from, excluding everything that rides a uniform.
 *
 * Node positions and knob values are deliberately absent: dragging a node or
 * turning a knob must not rebuild a shader, and a signature that included them
 * would rebuild one sixty times a second during a drag.
 *
 * **Which** inlets carry a value is in, because that is structure: it decides
 * how big the bank is and which inlets read a slot rather than a constant. So
 * setting a number for the first time recompiles once and every turn of it
 * afterwards recompiles nothing, which is the whole bargain.
 *
 * It walks the **expanded** graph, so editing a look changes the signature of
 * every look that contains it. Signing only the top graph would leave a nested
 * edit invisible until something else forced a rebuild, which is the kind of
 * bug that looks like the editor having stopped working.
 */
export function signatureOf(looks: Record<string, LookDef>, id: string): string {
  const { circuit, error } = flatten(looks, id);
  if (error) return `broken:${error}`;
  return signatureOfCircuit(circuit);
}

export function signatureOfCircuit(circuit: Circuit): string {
  // Sorted, because two files with the same knobs written in a different order
  // compile to the same shader and should not throw the cache away.
  const nodes = circuit.nodes
    .map((n) => `${n.id}:${n.kind}:${n.op ?? ''}:${Object.keys(n.knobs ?? {}).sort().join('+')}`)
    .join(',');
  const cords = circuit.cords.map((c) => `${c.from}>${c.to}`).join(',');
  return `look:${nodes}|${cords}`;
}

/**
 * The knob bank, in the order the shader reads it and exactly as long.
 *
 * Cut to the graph, because the shader declares `uParams` at the size this
 * returns. A bank shorter than the array leaves the tail reading zero; a bank
 * longer than it is an `INVALID_OPERATION` and a black picture. Both come from
 * `knobsOf` so that neither can happen — and a look with no knobs at all still
 * gets one float, because GLSL rejects a zero-length array.
 */
export function paramsOf(circuit: Circuit): Float32Array {
  const knobs = knobsOf(circuit);
  const values = new Float32Array(Math.max(1, knobs.length));
  for (const knob of knobs) values[knob.index] = knob.value;
  return values;
}

/**
 * The names a look's `track` nodes point at, in bank order.
 *
 * Empty for a look that reads no named track, which is most of them and is the
 * cheap case this exists to keep cheap. A look that names nothing travels.
 */
export function namedTracks(circuit: Circuit): string[] {
  const names = new Array<string>(8).fill('');
  for (const track of tracksOf(circuit)) names[track.index] = track.name;
  return names;
}

/** The same, for `energy` nodes, which additionally carry how much to smooth. */
export function namedEnergies(circuit: Circuit): { name: string; smooth: number }[] {
  const out = Array.from({ length: 8 }, () => ({ name: '', smooth: 0.5 }));
  for (const each of energiesOf(circuit)) {
    out[each.index] = { name: each.name, smooth: each.smooth ?? 0.5 };
  }
  return out;
}

/**
 * Those names, resolved to meters.
 *
 * The reading is the caller's because the two callers have different sets to
 * read from: the stage has the show, and the bench has whatever the editor
 * decided to feed it. A name nobody can resolve reads zero rather than throwing
 * — a look pointed at a track that has since been renamed should go quiet, not
 * take the picture down with it.
 */
export function trackBank(names: readonly string[], read: (name: string) => number): Float32Array {
  const values = new Float32Array(8);
  for (let i = 0; i < values.length; i++) {
    const name = names[i];
    if (name) values[i] = read(name);
  }
  return values;
}
