import type { Preset } from '../model/api';

/**
 * Presets for the editor's tests and stories. `blank` is a 1:1 port of
 * visual[flow]'s `app/src/testPresets.ts`; `sample` is new here, a preset with
 * something on every kind of node so the lab's screens have something to show.
 */

const wave = () => ({ values: { enabled: 0 }, init: '', frame: '', point: '' });
const shape = () => ({ values: { enabled: 0 }, init: '', frame: '' });

/** A preset that draws nothing but MilkDrop's pipeline: no waveform, no vectors, no borders. */
export function blank(values: Record<string, number> = {}): Preset {
  return {
    values: { fWaveAlpha: 0, mv_a: 0, ob_a: 0, ib_a: 0, ...values },
    init: '',
    frame: '',
    vertex: '',
    waves: [wave(), wave(), wave(), wave()],
    shapes: [shape(), shape(), shape(), shape()],
    warp: '',
    comp: '',
  };
}

/** Where `sample` opens from, for a story's `World.presets`. */
export const SAMPLE_PATH = 'presets/Lab/sample.milk';

/**
 * A preset with motion code, the waveform, one custom wave, one custom shape, a
 * border and a written warp shader (the composite left at MilkDrop's default).
 */
export function sample(): Preset {
  const p = blank({ fWaveAlpha: 0.8, ob_a: 0.5, ob_size: 0.01, zoom: 1.02, rot: 0.01, fDecay: 0.97 });
  p.init = 'q1 = 0;';
  p.frame = 'zoom = 1.01 + 0.02*bass;\nrot = 0.01*sin(time*0.3);';
  p.vertex = 'dx = 0.002*sin(y*6 + time);';
  p.waves[0] = {
    values: { enabled: 1, samples: 512, bAdditive: 1, r: 1, g: 0.6, b: 0.2, a: 0.8 },
    init: '',
    frame: 'r = 0.5 + 0.5*sin(time);',
    point: 'ang = sample*6.2832;\nx = 0.5 + 0.3*cos(ang);\ny = 0.5 + 0.3*sin(ang);',
  };
  p.shapes[1] = {
    values: { enabled: 1, sides: 5, additive: 1, x: 0.5, y: 0.5, rad: 0.15, r: 0.2, g: 0.5, b: 1, a: 0.6 },
    init: '',
    frame: 'ang = time*0.4;\nrad = 0.12 + 0.08*bass;',
  };
  p.warp = 'shader_body\n{\n  ret = tex2D(sampler_main, uv).xyz * 0.97;\n}';
  return p;
}
