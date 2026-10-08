import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Preset, Report } from './api.ts';
import { makeApplier } from './editor.ts';

const preset = (name: string) => ({ name }) as unknown as Preset;
const ok = (name: string): Report => ({ equations: [{ stage: 'equations', message: name, line: null }], shaders: [] });

/** An `apply` whose calls stay pending until the test resolves or rejects them. */
function controlled() {
  const calls: { p: Preset; resolve: (r: Report) => void; reject: (e: unknown) => void }[] = [];
  const apply = vi.fn((p: Preset) => new Promise<Report>((resolve, reject) => calls.push({ p, resolve, reject })));
  return { apply, calls };
}

describe('makeApplier', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('applies only the last of a burst of edits, once it has been quiet for the wait', async () => {
    const { apply, calls } = controlled();
    const onReport = vi.fn();
    const send = makeApplier(apply, onReport, 250);
    send(preset('a'));
    await vi.advanceTimersByTimeAsync(200);
    send(preset('b'));
    await vi.advanceTimersByTimeAsync(200);
    expect(apply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);
    expect(calls.map((c) => c.p)).toEqual([preset('b')]);
    calls[0].resolve(ok('b'));
    await vi.advanceTimersByTimeAsync(0);
    expect(onReport).toHaveBeenCalledWith(ok('b'));
  });

  it('runs one apply at a time, and only the latest edit waits behind it', async () => {
    const { apply, calls } = controlled();
    const onReport = vi.fn();
    const send = makeApplier(apply, onReport, 250);
    send(preset('a'));
    await vi.advanceTimersByTimeAsync(250);
    send(preset('b'));
    await vi.advanceTimersByTimeAsync(250);
    send(preset('c'));
    await vi.advanceTimersByTimeAsync(250);
    expect(apply).toHaveBeenCalledTimes(1);

    calls[0].resolve(ok('a'));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.map((c) => c.p)).toEqual([preset('a'), preset('c')]);
    calls[1].resolve(ok('c'));
    await vi.advanceTimersByTimeAsync(0);
    expect(onReport.mock.calls).toEqual([[ok('a')], [ok('c')]]);
  });

  it('reports a failed apply as an equations problem and carries on', async () => {
    const { apply, calls } = controlled();
    const onReport = vi.fn();
    const send = makeApplier(apply, onReport, 250);
    send(preset('a'));
    await vi.advanceTimersByTimeAsync(250);
    calls[0].reject('no bench');
    await vi.advanceTimersByTimeAsync(0);
    expect(onReport).toHaveBeenCalledWith({ equations: [{ stage: 'equations', message: 'no bench', line: null }], shaders: [] });

    send(preset('b'));
    await vi.advanceTimersByTimeAsync(250);
    expect(apply).toHaveBeenCalledTimes(2);
  });
});
