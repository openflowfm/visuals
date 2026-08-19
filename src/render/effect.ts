import type { EffectDef } from '../../protocol.ts';
import { compileCircuit, knobsOf } from './circuit.ts';
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
