import type { LFO_SHAPES } from '../../../protocol.ts';
import { evaluateResponse, productionResponse } from '../../../response.ts';
import { clamp, fract, hash, noise } from '../../render/scalar.ts';

export const LFO_SYNC_LABELS = [
  '4/1',
  '2/1',
  '1/1',
  '1/2',
  '1/4',
  '1/8',
  '1/16',
  '1/32',
] as const;
export const LFO_MIN_HZ = 0.05;
export const LFO_MAX_HZ = 20;

/** The closest straight-note rung; midpoint is a quarter note. */
export function lfoSyncIndex(rate: number): number {
  return Math.round(clamp(rate) * (LFO_SYNC_LABELS.length - 1));
}

/** Cycles per quarter-note beat for the selected straight-note period. */
export function lfoCyclesPerBeat(rate: number): number {
  return 2 ** (lfoSyncIndex(rate) - 4);
}

/** A useful free LFO range with 1 Hz exactly at the midpoint. */
export function lfoHz(rate: number): number {
  return LFO_MIN_HZ * (LFO_MAX_HZ / LFO_MIN_HZ) ** clamp(rate);
}

/** The rung that is one cycle per beat: a quarter-note period. */
const BEAT_RUNG = 4;

/**
 * The `rate` that runs one cycle a beat, for a given shape.
 *
 * A `wave` node had no rate at all — its phase *was* the beat, once per beat —
 * so migrating one has to write the rate that says the same thing. The number
 * differs by shape, which is the part worth knowing: `rate` is calibrated per
 * mode, sine, triangle and saw square the knob and the rest do not, so the
 * resting midpoint is a whole-note cycle on the first three and a quarter-note
 * cycle on the others. Assuming the midpoint would have run six of the shipped
 * flows four times too slowly.
 *
 * Found by scanning rather than by inverting the response: the vocabulary is
 * four kinds wide, only some have a closed form, and a wrong inverse would be a
 * silent tempo error rather than a failure.
 */
export function lfoRateForBeat(shape: (typeof LFO_SHAPES)[number]): number {
  const response = productionResponse({ kind: 'lfo', mode: shape, inlet: 'rate' });
  let first = -1;
  let last = -1;
  for (let step = 0; step <= 1000; step++) {
    const rate = step / 1000;
    const applied = response ? evaluateResponse(response, rate) : rate;
    if (lfoSyncIndex(applied) !== BEAT_RUNG) continue;
    if (first < 0) first = rate;
    last = rate;
  }
  // The middle of the rung's band, so a later recalibration has to move the
  // response by half a rung before this lands on a different note period.
  return first < 0 ? 0.5 : Math.round(((first + last) / 2) * 1000) / 1000;
}

export function lfoRateLabel(rate: number, synced: boolean): string {
  if (synced) return LFO_SYNC_LABELS[lfoSyncIndex(rate)];
  const hz = lfoHz(rate);
  return `${hz < 1 ? hz.toFixed(2) : hz < 10 ? hz.toFixed(1) : hz.toFixed(0)} Hz`;
}

/** A stable per-node number so two sample-and-hold nodes do not pick in unison. */
export function lfoIdentity(id: string): number {
  let held = 2166136261;
  for (let index = 0; index < id.length; index++) {
    held ^= id.charCodeAt(index);
    held = Math.imul(held, 16777619);
  }
  return (held >>> 0) / 4294967296;
}

/**
 * The phase the shape is read at.
 *
 * `clock` is the beat unless something is wired to that inlet — the compiler
 * answers the inlet, not this — and `rate` divides whatever it turns out to be.
 * Free running is the exception: elapsed seconds are the clock there, so a
 * signal wired in has nothing to divide and is not read.
 */
export function lfoClock(
  clock: number,
  seconds: number,
  rate: number,
  sync: number,
  phase: number,
): number {
  const running = sync >= 0.5 ? clock * lfoCyclesPerBeat(rate) : seconds * lfoHz(rate);
  return running + clamp(phase);
}

/** The CPU reference for the GLSL node functions, always bounded to 0–1. */
export function lfoValue(
  shape: (typeof LFO_SHAPES)[number],
  clock: number,
  identity: number,
  seed = 3.71,
): number {
  const phase = fract(clock);
  switch (shape) {
    case 'triangle':
      return 1 - Math.abs(phase * 2 - 1);
    case 'saw':
      return phase;
    case 'ramp':
      return 1 - phase;
    case 'square':
      return phase < 0.5 ? 0 : 1;
    case 'pulse':
      return Math.pow(1 - phase, 4);
    case 'noise':
      return noise(clock, clock * 0.37, seed);
    case 'sample-hold':
      return hash(Math.floor(clock) + identity, identity * 0.37, seed);
    case 'sine':
    default:
      return Math.sin(phase * Math.PI * 2) * 0.5 + 0.5;
  }
}
