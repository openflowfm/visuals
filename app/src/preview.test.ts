import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Stats } from './api.ts';
import { whenDrawing } from './preview.ts';

const idle: Stats = { fps: 0, cpu_ms: 0 };
const drawing: Stats = { fps: 60, cpu_ms: 1.5 };

/** A stats reader that answers `answers` in turn, then the last one again. */
const reader = (...answers: (Stats | Error)[]) => {
  const read = vi.fn(() => {
    const a = answers.length > 1 ? answers.shift()! : answers[0];
    return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
  });
  return read;
};

describe('whenDrawing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('says so at once when the bench is already drawing, and asks no more', async () => {
    const read = reader(drawing);
    const then = vi.fn();
    whenDrawing(read, then, 250);
    await vi.advanceTimersByTimeAsync(1000);
    expect(then).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('keeps asking through no frames and failed reads until frames are counted', async () => {
    const read = reader(new Error('no bench yet'), idle, idle, drawing);
    const then = vi.fn();
    whenDrawing(read, then, 250);
    await vi.advanceTimersByTimeAsync(500);
    expect(then).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(then).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledTimes(4);
  });

  it('stops asking when stopped, and never says so after', async () => {
    const read = reader(idle, drawing);
    const then = vi.fn();
    const stop = whenDrawing(read, then, 250);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(then).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
  });
});
