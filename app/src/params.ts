/**
 * Every setting a `.milk` file can hold, with the range a hand on a face wants
 * and the default Butterchurn uses when the file leaves it out
 * (`engine/src/runtime.rs`, `BASE_DEFAULTS`, `WAVE_DEFAULTS`, `SHAPE_DEFAULTS`).
 *
 * Keys are spelled the way MilkDrop writes them. A file's own spelling wins when
 * it has the key in another case.
 */

export interface Spec {
  key: string;
  /** What the face calls it. */
  label: string;
  min: number;
  max: number;
  def: number;
  kind: 'float' | 'int' | 'bool' | 'enum';
  items?: string[];
  /** Worth a word on the node's face when it is off its default; every setting is in the inspector. */
  face?: boolean;
}

const f = (key: string, label: string, min: number, max: number, def: number, face = true): Spec => ({ key, label, min, max, def, kind: 'float', face });
const i = (key: string, label: string, min: number, max: number, def: number, face = true): Spec => ({ key, label, min, max, def, kind: 'int', face });
const b = (key: string, label: string, def: number, face = true): Spec => ({ key, label, min: 0, max: 1, def, kind: 'bool', face });
const rgba = (prefix: string, label: string, defs: number[], face = true): Spec[] =>
  ['r', 'g', 'b', 'a'].map((c, n) => f(`${prefix}${c}`, `${label}${c}`, 0, 1, defs[n], face));

export const PARAMS: Record<string, Spec[]> = {
  motion: [
    f('zoom', 'zoom', 0.5, 1.5, 1),
    f('rot', 'rotate', -1, 1, 0),
    f('warp', 'warp', 0, 2, 1),
    f('cx', 'centre x', 0, 1, 0.5),
    f('cy', 'centre y', 0, 1, 0.5),
    f('dx', 'move x', -0.1, 0.1, 0),
    f('dy', 'move y', -0.1, 0.1, 0),
    f('sx', 'stretch x', 0.5, 1.5, 1),
    f('sy', 'stretch y', 0.5, 1.5, 1),
    f('fZoomExponent', 'zoom exp', 0.25, 4, 1, false),
    f('fWarpAnimSpeed', 'warp speed', 0, 4, 1, false),
    f('fWarpScale', 'warp scale', 0.1, 4, 1, false),
  ],
  feedback: [f('fDecay', 'decay', 0.8, 1, 0.98), b('bTexWrap', 'wrap', 1), b('bDarkenCenter', 'darken centre', 0)],
  wave: [
    { key: 'nWaveMode', label: 'mode', min: 0, max: 7, def: 0, kind: 'enum', face: true, items: ['circle', 'x-y', 'blob', 'blob 2', 'derivative', 'explosion', 'line', 'double line'] },
    f('fWaveAlpha', 'alpha', 0, 1, 0.8),
    f('fWaveScale', 'scale', 0, 4, 1),
    f('fWaveSmoothing', 'smoothing', 0, 1, 0.75),
    f('fWaveParam', 'param', -1, 1, 0, false),
    f('wave_r', 'red', 0, 1, 1),
    f('wave_g', 'green', 0, 1, 1),
    f('wave_b', 'blue', 0, 1, 1),
    f('wave_x', 'x', 0, 1, 0.5),
    f('wave_y', 'y', 0, 1, 0.5),
    b('bAdditiveWaves', 'additive', 0, false),
    b('bWaveDots', 'dots', 0, false),
    b('bWaveThick', 'thick', 0, false),
    b('bModWaveAlphaByVolume', 'alpha by volume', 0, false),
    b('bMaximizeWaveColor', 'maximise colour', 1, false),
  ],
  vectors: [
    i('nMotionVectorsX', 'across', 0, 64, 12),
    i('nMotionVectorsY', 'down', 0, 48, 9),
    f('mv_l', 'length', 0, 5, 0.9),
    f('mv_dx', 'offset x', -1, 1, 0, false),
    f('mv_dy', 'offset y', -1, 1, 0, false),
    ...rgba('mv_', 'mv ', [1, 1, 1, 1]),
  ],
  border: [f('ob_size', 'outer size', 0, 0.5, 0.01), ...rgba('ob_', 'outer ', [0, 0, 0, 0]), f('ib_size', 'inner size', 0, 0.5, 0.01), ...rgba('ib_', 'inner ', [0.25, 0.25, 0.25, 0])],
  blur: [f('b1n', 'blur1 min', 0, 1, 0), f('b1x', 'blur1 max', 0, 1, 1), f('b2n', 'blur2 min', 0, 1, 0), f('b2x', 'blur2 max', 0, 1, 1), f('b3n', 'blur3 min', 0, 1, 0), f('b3x', 'blur3 max', 0, 1, 1), f('b1ed', 'edge darken', 0, 1, 0.25)],
  comp: [
    f('fGammaAdj', 'gamma', 1, 4, 2),
    f('fVideoEchoAlpha', 'echo', 0, 1, 0),
    f('fVideoEchoZoom', 'echo zoom', 0.5, 2, 2),
    { key: 'nVideoEchoOrientation', label: 'echo flip', min: 0, max: 3, def: 0, kind: 'enum', face: true, items: ['none', 'x', 'y', 'x+y'] },
    f('fShader', 'shader blend', 0, 1, 0, false),
    b('bBrighten', 'brighten', 0, false),
    b('bDarken', 'darken', 0, false),
    b('bSolarize', 'solarize', 0, false),
    b('bInvert', 'invert', 0, false),
    b('bRedBlueStereo', 'red/blue', 0, false),
  ],
  waves: [
    i('samples', 'samples', 2, 512, 512),
    f('scaling', 'scale', 0, 4, 1),
    f('smoothing', 'smoothing', 0, 1, 0.5),
    i('sep', 'separation', 0, 100, 0, false),
    ...rgba('', '', [1, 1, 1, 1]),
    b('bSpectrum', 'spectrum', 0),
    b('bUseDots', 'dots', 0, false),
    b('bDrawThick', 'thick', 0, false),
    b('bAdditive', 'additive', 0, false),
  ],
  shapes: [
    i('sides', 'sides', 3, 100, 4),
    i('num_inst', 'instances', 1, 1024, 1),
    f('x', 'x', 0, 1, 0.5),
    f('y', 'y', 0, 1, 0.5),
    f('rad', 'radius', 0, 1, 0.1),
    f('ang', 'angle', 0, Math.PI * 2, 0),
    ...rgba('', '', [1, 0, 0, 1]),
    ...rgba('', 'edge ', [0, 1, 0, 0], false).map((s) => ({ ...s, key: `${s.key}2`, label: `${s.label} 2` })),
    ...rgba('border_', 'border ', [1, 1, 1, 0.1], false),
    b('additive', 'additive', 0, false),
    b('thickOutline', 'thick', 0, false),
    b('textured', 'textured', 0, false),
    f('tex_ang', 'texture angle', 0, Math.PI * 2, 0, false),
    f('tex_zoom', 'texture zoom', 0.1, 4, 1, false),
  ],
};

/** The specs for a stage, by its id (`wave2` uses the wave specs). */
export function specsOf(stage: string): Spec[] {
  if (/^wave\d$/.test(stage)) return PARAMS.waves;
  if (/^shape\d$/.test(stage)) return PARAMS.shapes;
  return PARAMS[stage] ?? [];
}

/** The key as `values` spells it, if it has it in any case. */
export function spelling(values: Record<string, number>, key: string): string {
  const lower = key.toLowerCase();
  return Object.keys(values).find((k) => k.toLowerCase() === lower) ?? key;
}

export function read(values: Record<string, number>, spec: Spec): number {
  return values[spelling(values, spec.key)] ?? spec.def;
}

/** Every key a stage's specs claim, lowercased — what the inspector need not list again. */
export const claimed = new Set(Object.values(PARAMS).flat().map((s) => s.key.toLowerCase()));
