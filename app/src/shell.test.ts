import { describe, expect, it } from 'vitest';
import { frameReadout, isTyping, meterLevel, nameOf, notice, openFailed, SLOW_FOR } from './shell.ts';

describe('notice', () => {
  it('keeps the plain words up front and what the app said as the detail', () => {
    expect(notice('couldn’t open that preset', 'No such file or directory (os error 2)')).toEqual({
      message: 'couldn’t open that preset',
      detail: 'No such file or directory (os error 2)',
    });
  });
  it('drops the Error: prefix a thrown Error carries', () => {
    expect(notice('x', new Error('boom')).detail).toBe('boom');
    expect(notice('x', '  Error: boom ').detail).toBe('boom');
  });
  it('has no detail when nothing useful was thrown', () => {
    expect(notice('couldn’t save').detail).toBeNull();
    expect(notice('couldn’t save', undefined).detail).toBeNull();
    expect(notice('couldn’t save', '  ').detail).toBeNull();
    expect(notice('same', 'same').detail).toBeNull();
  });
  it('writes out anything else that was thrown', () => {
    expect(notice('x', { code: 3 }).detail).toBe('{"code":3}');
    expect(notice('x', 42).detail).toBe('42');
  });
});

describe('nameOf', () => {
  it('is the file name without .milk', () => {
    expect(nameOf('Geiss/Spiral Galaxy.milk')).toBe('Spiral Galaxy');
    expect(nameOf('loose.MILK')).toBe('loose');
    expect(nameOf('no-extension')).toBe('no-extension');
  });
});

describe('openFailed', () => {
  it('names the preset, not its path', () => {
    const n = openFailed('Geiss/Spiral Galaxy.milk', 'shader: line 3: bad token');
    expect(n.message).toBe("Couldn't open Spiral Galaxy — the last preset keeps playing.");
    expect(n.detail).toBe('shader: line 3: bad token');
  });
  it('says something without a path', () => {
    expect(openFailed(null, 'x').message).toBe("Couldn't open that preset.");
  });
});

describe('isTyping', () => {
  const on = (match: boolean) => ({ target: { closest: (s: string) => (match && s.includes('input') ? {} : null) } as unknown as EventTarget });
  it('is a key landing in a field', () => {
    expect(isTyping(on(true))).toBe(true);
  });
  it('is not a key anywhere else, or with no element behind it', () => {
    expect(isTyping(on(false))).toBe(false);
    expect(isTyping({ target: null })).toBe(false);
    expect(isTyping({ target: {} as EventTarget })).toBe(false);
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
    expect(
      frameReadout(
        [
          { fps: 0, cpu_ms: 0 },
          { fps: 0, cpu_ms: 0 },
          { fps: 0, cpu_ms: 0 },
        ],
        false,
      ),
    ).toBeNull();
  });
});
