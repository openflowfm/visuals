import { TRACK_READS, type Circuit, type FlowDef } from '../../protocol.ts';
import {
  compileFlow,
  flatten,
  valuesOf,
  tracksOf,
  type CompileOptions,
  type Compiled,
} from './circuit.ts';

/**
 * What a flow *is*, independent of who is drawing it.
 *
 * The stage and the bench both take a flow id and need the same things out of
 * it — the shader, the banks its numbers and meters ride in, and whether the
 * shader it has is still the right one. Keeping those here is what stops the
 * bench from being a second, subtly different renderer: two things that
 * disagreed about what a flow looks like would be worse than one preview.
 */

/**
 * Everything a flow compiles to, cached by its structure.
 *
 * A flow is compiled from **the whole library**, not from its own graph, because
 * a `flow` node is replaced by the graph it names. That means a flow's shader
 * changes when a flow it contains changes, which is exactly right and is the
 * reason the signature below walks the same expansion.
 */
export function buildFlow(
  flows: Record<string, FlowDef>,
  id: string,
  options: CompileOptions = {},
): Compiled {
  return compileFlow(flows, id, options);
}

/**
 * What it was compiled from, excluding everything that rides a uniform.
 *
 * Node positions and set numbers are deliberately absent: dragging a node or
 * turning a number must not rebuild a shader, and a signature that included
 * them would rebuild one sixty times a second during a drag.
 *
 * **Which** inlets carry a value is in, because that is structure: it decides
 * how big the bank is and which inlets read a slot rather than a constant. So
 * setting a number for the first time recompiles once and every turn of it
 * afterwards recompiles nothing, which is the whole bargain.
 *
 * It walks the **expanded** graph, so editing a flow changes the signature of
 * every flow that contains it. Signing only the top graph would leave a nested
 * edit invisible until something else forced a rebuild, which is the kind of
 * bug that looks like the editor having stopped working.
 */
export function signatureOf(flows: Record<string, FlowDef>, id: string): string {
  const { circuit, error } = flatten(flows, id);
  if (error) return `broken:${error}`;
  return signatureOfCircuit(circuit);
}

export function signatureOfCircuit(circuit: Circuit): string {
  // Sorted, because two files with the same inlets set in a different order
  // compile to the same shader and should not throw the cache away.
  const nodes = circuit.nodes
    .map(
      (n) =>
        `${n.id}:${n.kind}:${n.op ?? ''}:${n.asset ?? ''}:${n.setup ?? ''}:${n.setupRevision ?? ''}:` +
        `${(n.modelPorts ?? []).map((port) => port.id).join('+')}:${Object.keys(n.values ?? {}).sort().join('+')}`,
    )
    .join(',');
  const cords = circuit.cords.map((c) => `${c.from}>${c.to}`).join(',');
  return `flow:${nodes}|${cords}`;
}

/**
 * Every bank a compiled flow reads, cut to its own graph.
 *
 * Computed **per frame** rather than kept beside the program, and that is the
 * whole reason it is one function: two of the three change without the shader
 * changing. A number set on an inlet is a uniform, so turning one must not
 * recompile — and an `energy` node's smoothing is one too, so a bank held from
 * compile time left that one control doing nothing until something else forced
 * a rebuild, which reads as the control being unwired.
 */
export function banksOf(circuit: Circuit): { params: Float32Array; tracks: TrackAsk[] } {
  return { params: paramsOf(circuit), tracks: namedTracks(circuit) };
}

/**
 * The number bank, in the order the shader reads it and exactly as long.
 *
 * Cut to the graph, because the shader declares `uParams` at the size this
 * returns. A bank shorter than the array leaves the tail reading zero; a bank
 * longer than it is an `INVALID_OPERATION` and a black picture. Both come from
 * `valuesOf` so that neither can happen — and a flow that sets nothing at all
 * still gets one float, because GLSL rejects a zero-length array.
 */
export function paramsOf(circuit: Circuit): Float32Array {
  const values = valuesOf(circuit);
  const bank = new Float32Array(Math.max(1, values.length));
  for (const each of values) bank[each.index] = each.value;
  return bank;
}

/** What one `track` node is asking the set for, in the slot it asks from. */
export interface TrackAsk {
  /** The track's name, or empty for a slot nobody claimed. */
  name: string;
  /** One of `TRACK_READS`. */
  read: string;
  /** How much envelope to put on it. Zero is the number itself. */
  smooth: number;
}

/**
 * What a flow's `track` nodes are asking for, in bank order.
 *
 * Every slot empty for a flow that reads no named track, which is most of them
 * and is the cheap case this exists to keep cheap: a bank with nothing claimed
 * is never uploaded at all, so a flow that names nothing travels.
 */
export function namedTracks(circuit: Circuit): TrackAsk[] {
  const out: TrackAsk[] = Array.from({ length: 8 }, () => ({
    name: '',
    read: TRACK_READS[0],
    smooth: 0,
  }));
  for (const each of tracksOf(circuit)) {
    out[each.index] = { name: each.name, read: each.read, smooth: each.smooth };
  }
  return out;
}
