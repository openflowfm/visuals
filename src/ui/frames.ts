import type { FrameStats } from '../render/meter.ts';

/**
 * The frame reading, as one line of a panel.
 *
 * The formatting is here rather than in the JSX because deciding *which*
 * window's numbers are on screen is a real choice with a wrong answer — a
 * console showing its own quarter-size preview's frame time while a projector
 * is up would read as the show being fine when nobody has measured the show.
 */

/**
 * Where a reading came from, which the readout has to say out loud.
 *
 * With a wall up, `this window` is a preview at a quarter of the pixels and its
 * frame time means almost nothing. The label is not decoration.
 */
export type FrameSource = 'wall' | 'console';

/** How much dropped frame a show tolerates before somebody should look. */
export const WATCH_SHARE = 0.005;
export const BAD_SHARE = 0.02;

export type Tone = 'good' | 'watch' | 'bad';

export interface FrameLine {
  source: FrameSource;
  /** Empty until the window has enough frames for a percentile to mean anything. */
  headline: string;
  detail: string;
  tone: Tone;
  /** False while the window is still filling, so the readout can say so. */
  settled: boolean;
}

/** Percentiles over a window this short are noise wearing a number's clothes. */
export const SETTLED_AT = 300;

const ms = (value: number): string => (value >= 100 ? value.toFixed(0) : value.toFixed(1));

export function toneOf(lateShare: number): Tone {
  if (lateShare >= BAD_SHARE) return 'bad';
  if (lateShare >= WATCH_SHARE) return 'watch';
  return 'good';
}

export function describeFrames(stats: FrameStats | null, source: FrameSource): FrameLine {
  if (!stats || !stats.frames) {
    return { source, headline: '—', detail: 'no frames yet', tone: 'good', settled: false };
  }

  const settled = stats.frames >= SETTLED_AT;
  const late = (stats.lateShare * 100).toFixed(stats.lateShare >= 0.01 ? 0 : 2);
  const headline = `${stats.hz.toFixed(0)}Hz · p99 ${ms(stats.interval.p99)}ms · ${late}% late`;

  // Every clock the meter has, because which one is climbing is the whole
  // diagnostic — see `docs/engine.md`. GPU is absent far more often than not.
  const parts = [
    `${stats.frames} frames${settled ? '' : ' (filling)'}`,
    `interval p50 ${ms(stats.interval.p50)} p95 ${ms(stats.interval.p95)} p99 ${ms(
      stats.interval.p99,
    )} max ${ms(stats.interval.max)}`,
    `cpu p50 ${ms(stats.cpu.p50)} p99 ${ms(stats.cpu.p99)}`,
    stats.gpu ? `gpu p50 ${ms(stats.gpu.p50)} p99 ${ms(stats.gpu.p99)}` : 'gpu not timed',
  ];
  if (stats.heapMb !== null) parts.push(`heap ${stats.heapMb.toFixed(0)}MB`);

  return {
    source,
    headline,
    detail: parts.join(' · '),
    // An unsettled window is never called bad. It is one spike away from
    // saying so on a rig that has been running for four seconds.
    tone: settled ? toneOf(stats.lateShare) : 'good',
    settled,
  };
}
