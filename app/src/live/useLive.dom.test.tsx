// @vitest-environment happy-dom
//
// useLive's quiet hint: a step the deck refuses under Hold says so as a state
// (not a failure) and clears when Hold is let go; leaving live with the output
// on a display asks first and leaves on the second press.
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DATA, DISPLAYS, FX, LISTS, OUTPUT_OFF, OUTPUT_ON } from '../stories/fixtures.ts';
import { HOLD_HINT, LEAVE_HINT } from './live-model.ts';
import { useLive } from './useLive.ts';

const app = vi.hoisted(() => ({
  held: true,
  /** The handlers listening, by event name. */
  on: new Map<string, (e: { payload: unknown }) => void>(),
}));

function answer(cmd: string, args?: { action?: { kind: string } }): Promise<unknown> {
  if (cmd === 'displays') return Promise.resolve(DISPLAYS);
  if (cmd === 'output_open') return Promise.resolve(OUTPUT_ON);
  if (cmd === 'output_close') return Promise.resolve(OUTPUT_OFF);
  if (cmd === 'fx_state') return Promise.resolve({ ...FX, hold: app.held });
  if (cmd === 'playlists') return Promise.resolve(LISTS);
  if (cmd === 'library_data') return Promise.resolve(DATA);
  if (cmd === 'library_index') return Promise.resolve([]);
  // The deck refuses a step under Hold, as the app does.
  if (cmd === 'act' && args?.action?.kind === 'random' && app.held) return Promise.reject('held');
  return Promise.resolve(null);
}
vi.mock('@tauri-apps/api/core', () => ({ invoke: (cmd: string, args?: { action?: { kind: string } }) => answer(cmd, args), convertFileSrc: (p: string) => p }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: (name: string, f: (e: { payload: unknown }) => void) => {
    app.on.set(name, f);
    return Promise.resolve(() => {});
  },
}));

beforeEach(() => {
  app.held = true;
  app.on.clear();
});
afterEach(cleanup);

/** The hook, once the effects and the output have been read. */
async function mounted() {
  const hook = renderHook(() => useLive({ start: null }));
  await waitFor(() => expect(hook.result.current.effects).not.toBeNull());
  await waitFor(() => expect(hook.result.current.status.display).not.toBeNull());
  return hook;
}

describe('the Hold hint', () => {
  it('says Hold keeps the preset as a state, not a failure, and clears when Hold is let go', async () => {
    const { result } = await mounted();
    act(() => result.current.act({ kind: 'random' }));
    await waitFor(() => expect(result.current.hint).toBe(HOLD_HINT));
    expect(result.current.error).toBeNull();
    app.held = false;
    act(() => app.on.get('fx')?.({ payload: { ...FX, hold: false } }));
    await waitFor(() => expect(result.current.hint).toBeNull());
  });
});

describe('leaving live', () => {
  it('with the output showing, asks on the first press and leaves on the second', async () => {
    const { result } = await mounted();
    const go = vi.fn();
    act(() => result.current.leave?.(go));
    expect(go).not.toHaveBeenCalled();
    expect(result.current.hint).toBe(LEAVE_HINT);
    act(() => result.current.leave?.(go));
    expect(go).toHaveBeenCalledOnce();
    expect(result.current.hint).toBeNull();
  });

  it('leaves at once with no output on a display', async () => {
    const { result } = await mounted();
    act(() => app.on.get('output')?.({ payload: OUTPUT_OFF }));
    const go = vi.fn();
    act(() => result.current.leave?.(go));
    expect(go).toHaveBeenCalledOnce();
  });
});
