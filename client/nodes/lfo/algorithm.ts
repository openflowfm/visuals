import type { LFO_SHAPES } from '../../../protocol.ts';

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

const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const fract = (value: number): number => value - Math.floor(value);

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

/** Matches the renderer preamble's scalar hash. */
function hash(x: number, y: number, seed: number): number {
  return fract(Math.sin(x * 127.1 + y * 311.7 + seed) * 43758.5453);
}

export function lfoClock(
  beat: number,
  seconds: number,
  rate: number,
  sync: number,
  phase: number,
): number {
  const clock = sync >= 0.5 ? beat * lfoCyclesPerBeat(rate) : seconds * lfoHz(rate);
  return clock + clamp(phase);
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
    case 'square':
      return phase < 0.5 ? 0 : 1;
    case 'sample-hold':
      return hash(Math.floor(clock) + identity, identity * 0.37, seed);
    case 'sine':
    default:
      return Math.sin(phase * Math.PI * 2) * 0.5 + 0.5;
  }
}
