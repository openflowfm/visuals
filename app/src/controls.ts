import type { Param } from '@openflow/widgets/param/param.ts';
import type { Spec } from './params.ts';

/**
 * What the editor's controls share, the graph's settings and the live effects
 * alike: how a range becomes a widgets `Param`, how a value reads, and the log
 * taper the multiplier sliders run on.
 */

/** A count with its noun: `1 item`, `3 items`, or `many` for irregular plurals. */
export const plural = (n: number, word: string, many = word + 's'): string => `${n} ${n === 1 ? word : many}`;

/** A float control from `min` to `max`, double-click back to `defaultValue`. */
export const range = (name: string, min: number, max: number, defaultValue: number): Param => ({ kind: 'float', min, max, defaultValue, name });

/** A setting's control: the spec's range, stretched to reach what the file says —
 * presets set `sx=100` as readily as `sx=1`, and a field pinned at its end hides that. */
export const paramOf = (s: Spec, value: number): Param => ({
  ...range(s.label, Math.min(s.min, value), Math.max(s.max, value), s.def),
  kind: s.kind === 'enum' ? 'enum' : s.kind === 'int' || s.kind === 'bool' ? 'int' : 'float',
  steps: s.kind === 'int' || s.kind === 'enum' ? s.max - s.min + 1 : undefined,
  items: s.items,
});

/** A plain number as a reading: a few decimals, fewer once it is large. */
export const decimals = (v: number) => (Math.abs(v) >= 10 ? v.toFixed(1) : String(Number(v.toFixed(3))));

/** A setting's value as a reading: the item's name, on or off, a whole number, or a few decimals. */
export const show = (s: Spec, v: number) =>
  s.kind === 'enum' ? (s.items?.[Math.round(v)] ?? String(v)) : s.kind === 'bool' ? (v >= 0.5 ? 'on' : 'off') : s.kind === 'int' ? String(Math.round(v)) : decimals(v);

/**
 * The speed and sensitivity sliders run on a log taper: the position is the
 * multiplier's log2, from −2 (¼×) to 2 (4×), so 1× is the centre and every
 * doubling is the same distance. What is sent stays the plain multiplier.
 */
export const MULTIPLIER_MIN = 0.25;
export const MULTIPLIER_MAX = 4;
export const POSITION_MIN = Math.log2(MULTIPLIER_MIN);
export const POSITION_MAX = Math.log2(MULTIPLIER_MAX);
/** Positions this close to the centre land on exactly 1×. */
export const CENTRE_SNAP = 0.06;

/** A multiplier's place on the slider, −2 to 2; out of range clamps, NaN is the centre. */
export function multiplierToPosition(multiplier: number): number {
  if (Number.isNaN(multiplier) || multiplier <= 0) return Number.isNaN(multiplier) ? 0 : POSITION_MIN;
  return Math.max(POSITION_MIN, Math.min(POSITION_MAX, Math.log2(multiplier)));
}

/** The multiplier at a slider position, ¼× to 4×; near the centre it is exactly 1. */
export function positionToMultiplier(position: number): number {
  if (Number.isNaN(position)) return 1;
  const p = Math.max(POSITION_MIN, Math.min(POSITION_MAX, position));
  return Math.abs(p) < CENTRE_SNAP ? 1 : 2 ** p;
}

/** A multiplier as the panel shows it: `0.25×`, `0.5×`, `1×`, `2.8×`. */
export function formatMultiplier(multiplier: number): string {
  const digits = multiplier < 1 ? 2 : 1;
  return `${Number(multiplier.toFixed(digits))}×`;
}
