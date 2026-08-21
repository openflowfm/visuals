import { TRACK_READS, type Circuit, type LookDef } from '../../protocol.ts';
import { compileLook, flatten, knobsOf, tracksOf, type Compiled } from './circuit.ts';

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
 * Every bank a compiled look reads, cut to its own graph.
 *
 * Computed **per frame** rather than kept beside the program, and that is the
 * whole reason it is one function: two of the three change without the shader
 * changing. A knob's value is a uniform, so turning one must not recompile —
 * and an `energy` node's smoothing is a value too, so a bank held from compile
 * time left that one control doing nothing until something else forced a
 * rebuild, which reads as the knob being unwired.
 */
export function banksOf(circuit: Circuit): { params: Float32Array; tracks: TrackAsk[] } {
  return { params: paramsOf(circuit), tracks: namedTracks(circuit) };
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
 * What a look's `track` nodes are asking for, in bank order.
 *
 * Every slot empty for a look that reads no named track, which is most of them
 * and is the cheap case this exists to keep cheap: a bank with nothing claimed
 * is never uploaded at all, so a look that names nothing travels.
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
