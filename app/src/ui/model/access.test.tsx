// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setBridge, type InvokeArgs } from './ipc';
import type { Motion } from './api';
import { SYSTEM_QUERY, setMotion, useAccessibility, useMotion } from './access';

let calls: [string, InvokeArgs | undefined][];
let restore: () => void;
/** What the app says the setting is: `reduced_motion` answers it, `reduced_motion_set` changes it. */
let app: Motion;

beforeEach(() => {
  calls = [];
  app = { reduced: false, system: true };
  restore = setBridge({
    invoke: <T,>(cmd: string, args?: InvokeArgs) => {
      calls.push([cmd, args]);
      if (cmd === 'reduced_motion_set') {
        const on = (args as { on: boolean | null }).on;
        app = { reduced: on ?? false, system: on === null };
      }
      return Promise.resolve({ ...app } as T);
    },
  });
});
afterEach(() => {
  restore();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.reducedMotion;
});

/** A MediaQueryList for `SYSTEM_QUERY` whose changes the test sends. */
function fakeQuery() {
  const target = new EventTarget();
  const query = Object.assign(target, { media: SYSTEM_QUERY, matches: false });
  const matchMedia = vi.fn(() => query);
  vi.stubGlobal('matchMedia', matchMedia);
  return { query, matchMedia, change: () => target.dispatchEvent(new Event('change')) };
}

const asked = () => calls.filter(([cmd]) => cmd === 'reduced_motion').length;

describe('useMotion', () => {
  it('hears a choice made anywhere, in every hook mounted', async () => {
    const a = renderHook(() => useMotion());
    const b = renderHook(() => useMotion());
    await act(() => setMotion(true));
    expect(a.result.current).toEqual({ reduced: true, system: false });
    expect(b.result.current).toEqual({ reduced: true, system: false });
    expect(document.documentElement.dataset.reducedMotion).toBe('');
    await act(() => setMotion(null));
    expect(a.result.current).toEqual({ reduced: false, system: true });
    expect(document.documentElement.dataset.reducedMotion).toBeUndefined();
  });

  it('starts from the setting already known, and stops hearing it once unmounted', async () => {
    await setMotion(true);
    const a = renderHook(() => useMotion());
    expect(a.result.current).toEqual({ reduced: true, system: false });
    const before = a.result.current;
    a.unmount();
    await act(() => setMotion(false));
    expect(a.result.current).toBe(before);
  });
});

describe('useAccessibility', () => {
  it('reads the setting at mount, and again when macOS’s changes or the window comes back', async () => {
    const q = fakeQuery();
    renderHook(() => useAccessibility());
    expect(q.matchMedia).toHaveBeenCalledWith(SYSTEM_QUERY);
    await waitFor(() => expect(asked()).toBe(1));
    app = { reduced: true, system: true };
    q.change();
    await waitFor(() => expect(asked()).toBe(2));
    await waitFor(() => expect(document.documentElement.dataset.reducedMotion).toBe(''));
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(asked()).toBe(3));
  });

  it('stops listening once unmounted', async () => {
    const q = fakeQuery();
    const { unmount } = renderHook(() => useAccessibility());
    await waitFor(() => expect(asked()).toBe(1));
    unmount();
    q.change();
    window.dispatchEvent(new Event('focus'));
    await new Promise((r) => setTimeout(r, 0));
    expect(asked()).toBe(1);
  });

  it('works without matchMedia', async () => {
    vi.stubGlobal('matchMedia', undefined);
    renderHook(() => useAccessibility());
    await waitFor(() => expect(asked()).toBe(1));
  });
});
