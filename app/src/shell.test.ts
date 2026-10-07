import { describe, expect, it } from 'vitest';
import { frameReadout, meterLevel, noticeOf, SLOW_FOR } from './shell.ts';

describe('noticeOf', () => {
  it('keeps the plain words up front and the raw failure as the detail', () => {
    expect(noticeOf('couldn’t open that preset', 'No such file or directory (os error 2)')).toEqual({
      message: 'couldn’t open that preset',
      detail: 'No such file or directory (os error 2)',
    });
  });
  it('drops the Error: prefix a thrown Error carries', () => {
    expect(noticeOf('x', new Error('boom')).detail).toBe('boom');
    expect(noticeOf('x', 'Error: boom').detail).toBe('boom');
  });
  it('falls back to the message when nothing useful was thrown', () => {
    expect(noticeOf('couldn’t save', undefined).detail).toBe('couldn’t save');
    expect(noticeOf('couldn’t save', '').detail).toBe('couldn’t save');
  });
});

describe('meterLevel', () => {
  it('reads decibels: 0 dB full, −60 dB empty, −30 dB half', () => {
    expect(meterLevel(1)).toBe(1);
    expect(meterLevel(0.001)).toBeCloseTo(0);
    expect(meterLevel(10 ** (-30 / 20))).toBeCloseTo(0.5);
  });
  it('clamps silence, overs and garbage', () => {
    expect(meterLevel(0)).toBe(0);
    expect(meterLevel(1e-9)).toBe(0);
    expect(meterLevel(4)).toBe(1);
    expect(meterLevel(Number.NaN)).toBe(0);
  });
});

describe('frameReadout', () => {
  const fast = { fps: 60, cpu_ms: 1.234 };
  const slow = { fps: 24, cpu_ms: 9 };
  it('shows a developer the numbers', () => {
    expect(frameReadout([fast], true)).toEqual({ text: '60 fps · 1.23 ms cpu', slow: false });
  });
  it('shows a release nothing while the picture is smooth', () => {
    expect(frameReadout([], false)).toBeNull();
    expect(frameReadout([fast, fast, fast], false)).toBeNull();
  });
  it('warns a release only after several slow seconds in a row', () => {
    const run = Array.from({ length: SLOW_FOR }, () => slow);
    expect(frameReadout(run.slice(1), false)).toBeNull();
    expect(frameReadout([fast, ...run], false)).toEqual({ text: 'running slowly: 24 fps', slow: true });
    expect(frameReadout([...run, fast], false)).toBeNull();
  });
  it('does not call a bench that draws nothing slow', () => {
    expect(frameReadout([{ fps: 0, cpu_ms: 0 }, { fps: 0, cpu_ms: 0 }, { fps: 0, cpu_ms: 0 }], false)).toBeNull();
  });
});
