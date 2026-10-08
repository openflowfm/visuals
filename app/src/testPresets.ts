import type { Preset } from './api.ts';

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
