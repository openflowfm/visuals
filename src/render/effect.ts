import type { EffectDef } from '../../protocol.ts';
import { compileCircuit, knobsOf, tracksOf } from './circuit.ts';
import { BUILTIN_PARAMS, effectSources } from './shaders.ts';

/**
 * What an effect *is*, independent of who is drawing it.
 *
 * The compositor and the preview both take an `EffectDef` and need the same
 * three things out of it — the shader, the eight floats its knobs ride in, and
 * whether the shader it has is still the right one. Keeping those here is what
 * stops the preview from being a second, subtly different renderer: if the two
 * ever disagreed about what an effect looks like, the preview would be worse
 * than not having one.
 */

/** The fragment shader for an effect, or why there isn't one. */
export function effectShader(def: EffectDef): {
  source: string | null;
  error: string | null;
} {
  if (def.builtin) {
    const source = effectSources.get(def.builtin);
    return source
      ? { source, error: null }
      : { source: null, error: `no built-in called ${def.builtin}` };
  }
  if (!def.circuit) return { source: null, error: 'nothing wired' };
  const built = compileCircuit(def.circuit);
  return { source: built.source, error: built.error };
}

/**
 * What it was compiled from, excluding everything that rides a uniform.
 *
 * Node positions and knob values are deliberately absent: dragging a node or
 * turning a knob must not rebuild a shader, and a signature that included them
 * would rebuild one sixty times a second during a drag.
 */
export function signatureOf(def: EffectDef): string {
  if (def.builtin) return `builtin:${def.builtin}`;
  const circuit = def.circuit;
  if (!circuit) return 'empty';
  const nodes = circuit.nodes.map((n) => `${n.id}:${n.kind}:${n.op ?? ''}`).join(',');
  const cords = circuit.cords.map((c) => `${c.from}>${c.to}`).join(',');
  return `circuit:${nodes}|${cords}`;
}

/** The parameter bank, in the order the shader reads it. */
export function paramsOf(def: EffectDef): Float32Array {
  const values = new Float32Array(8);
  if (def.builtin) {
    const declared = BUILTIN_PARAMS[def.builtin] ?? [];
    declared.forEach((param, i) => {
      values[i] = def.params?.[param.name] ?? param.value;
    });
    return values;
  }
  if (def.circuit) for (const knob of knobsOf(def.circuit)) values[knob.index] = knob.value;
  return values;
}

/**
 * The tracks an effect names, in `uTracks` order.
 *
 * Empty for a built-in and for any circuit that only ever reads the layer it is
 * drawing — which is most of them, and is the cheap case this exists to keep
 * cheap. A look that names nothing is a look that travels.
 */
export function namedTracks(def: EffectDef): string[] {
  if (!def.circuit) return [];
  const names = new Array<string>(8).fill('');
  for (const track of tracksOf(def.circuit)) names[track.index] = track.name;
  return names;
}

/**
 * Those names, resolved to meters.
 *
 * The reading is the caller's because the two callers have different sets to
 * read from: the compositor has the show, and the bench has whatever the editor
 * decided to feed it. A name nobody can resolve reads zero rather than throwing
 * — a look pointed at a track that has since been renamed should go quiet, not
 * take the layer down with it.
 */
export function trackBank(names: readonly string[], read: (name: string) => number): Float32Array {
  const values = new Float32Array(8);
  for (let i = 0; i < values.length; i++) {
    const name = names[i];
    if (name) values[i] = read(name);
  }
  return values;
}
