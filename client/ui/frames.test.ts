import { describe, expect, it } from 'vitest';
import type { FrameStats } from '../render/meter.ts';
import { BAD_SHARE, describeFrames, SETTLED_AT, toneOf, WATCH_SHARE } from './frames.ts';

const stats = (change: Partial<FrameStats> = {}): FrameStats => ({
  frames: 600,
  interval: { p50: 16.7, p95: 17.2, p99: 18.1, max: 22 },
  cpu: { p50: 3.1, p95: 4, p99: 5.2, max: 9 },
  gpu: null,
  late: 0,
  lateShare: 0,
  hz: 60,
  heapMb: null,
  ...change,
});

describe('the tone of a late share', () => {
  it('holds good right up to the watch line and turns at it', () => {
    expect(toneOf(WATCH_SHARE - 0.0001)).toBe('good');
    expect(toneOf(WATCH_SHARE)).toBe('watch');
    expect(toneOf(BAD_SHARE)).toBe('bad');
  });
});

describe('the frame line', () => {
  it('leads with the numbers a show is judged on', () => {
    const line = describeFrames(stats({ lateShare: 0.0033, late: 2 }), 'wall');

    expect(line.headline).toBe('60Hz · p99 18.1ms · 0.33% late');
    expect(line.tone).toBe('good');
    expect(line.source).toBe('wall');
  });

  it('never calls an unsettled window bad, however bad it looks', () => {
    const line = describeFrames(stats({ frames: SETTLED_AT - 1, lateShare: 0.5 }), 'wall');

    expect(line.settled).toBe(false);
    expect(line.tone).toBe('good');
    expect(line.detail).toContain('(filling)');
  });

  it('calls a settled window with real drops bad', () => {
    const line = describeFrames(stats({ lateShare: 0.04, late: 24 }), 'wall');

    expect(line.tone).toBe('bad');
    expect(line.headline).toContain('4% late');
  });

  it('says the GPU was not timed rather than printing a zero', () => {
    expect(describeFrames(stats(), 'wall').detail).toContain('gpu not timed');
  });

  it('reports the GPU when the driver gave one', () => {
    const line = describeFrames(
      stats({ gpu: { p50: 6.2, p95: 8, p99: 9.4, max: 14 } }),
      'wall',
    );

    expect(line.detail).toContain('gpu p50 6.2 p99 9.4');
  });

  it('carries the heap when the engine exposes it, for watching a leak', () => {
    expect(describeFrames(stats({ heapMb: 412.7 }), 'console').detail).toContain('heap 413MB');
  });

  it('says so plainly before any frame has been drawn', () => {
    const line = describeFrames(null, 'console');

    expect(line.headline).toBe('—');
    expect(line.detail).toBe('no frames yet');
    expect(line.settled).toBe(false);
  });
});
