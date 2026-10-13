// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setBridge, type InvokeArgs } from './ipc';
import { BASE } from './stages';
import type { Preset } from './api';
import { usePresetEdits } from './editor';
import { blank } from '../fixtures/presets';

let frames: FrameRequestCallback[];
let calls: [string, InvokeArgs | undefined][];
/** What `set_value` answers: whether the bench took the change live. */
let live: boolean;
let restore: () => void;

/** Run the pending display frame. */
const frame = () => act(() => frames.splice(0).forEach((f) => f(0)));

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => frames.push(f));
  calls = [];
  live = true;
  restore = setBridge({
    invoke: <T,>(cmd: string, args?: InvokeArgs) => {
      calls.push([cmd, args]);
      return Promise.resolve((cmd === 'set_value' ? live : null) as T);
    },
  });
});
afterEach(() => {
  restore();
  vi.unstubAllGlobals();
});

/** The hook over `preset`, with the state it would be kept in. */
function edits(preset: Preset | null) {
  const setPreset = vi.fn();
  const apply = vi.fn();
  const hook = renderHook(() => usePresetEdits(preset, setPreset, apply));
  return { setPreset, apply, set: hook.result.current.set, edit: hook.result.current.edit };
}

describe('usePresetEdits', () => {
  it('sends one change per setting a frame, the last value winning', async () => {
    const e = edits(blank({ zoom: 1, rot: 0 }));
    e.set(BASE, 'zoom', 1.1);
    e.set(BASE, 'rot', 0.2);
    e.set(BASE, 'zoom', 1.3);
    expect(calls).toEqual([]);
    expect(frames).toHaveLength(1);
    // Each edit is shown at once, on top of the ones before it in the frame.
    expect(e.setPreset).toHaveBeenCalledTimes(3);
    expect(e.setPreset.mock.lastCall![0].values).toMatchObject({ zoom: 1.3, rot: 0.2 });
    await frame();
    expect(calls).toEqual([
      ['set_value', { owner: BASE, key: 'zoom', value: 1.3 }],
      ['set_value', { owner: BASE, key: 'rot', value: 0.2 }],
    ]);
    expect(e.apply).not.toHaveBeenCalled();
  });

  it('applies the whole preset when the bench can’t take a change live', async () => {
    live = false;
    const e = edits(blank({ zoom: 1 }));
    e.set(BASE, 'zoom', 2);
    await frame();
    await waitFor(() => expect(e.apply).toHaveBeenCalledTimes(1));
    expect(e.apply.mock.lastCall![0].values).toMatchObject({ zoom: 2 });
  });

  it('does nothing with no preset open', () => {
    const e = edits(null);
    e.set(BASE, 'zoom', 2);
    expect(e.setPreset).not.toHaveBeenCalled();
    expect(frames).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('replaces and applies the preset on an edit', () => {
    const e = edits(blank());
    const next = blank({ zoom: 3 });
    e.edit(next);
    expect(e.setPreset).toHaveBeenCalledWith(next);
    expect(e.apply).toHaveBeenCalledWith(next);
  });
});
