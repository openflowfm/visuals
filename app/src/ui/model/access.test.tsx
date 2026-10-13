// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setBridge, type InvokeArgs } from './ipc';
import type { Motion } from './api';
import { SYSTEM_QUERY, TRANSPARENCY_QUERY, mark, refresh, setMotion, useAccessibility, useMotion } from './access';

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
        // `reduced_motion_set` answers the motion alone, never macOS's Reduce transparency.
        const on = (args as { on: boolean | null }).on;
        app = { ...app, reduced: on ?? false, system: on === null };
        return Promise.resolve({ reduced: app.reduced, system: app.system } as T);
      }
      return Promise.resolve({ ...app } as T);
    },
  });
});
afterEach(() => {
  restore();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.reducedMotion;
  delete document.documentElement.dataset.transparency;
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

describe('Reduce transparency', () => {
  const marked = () => document.documentElement.dataset.transparency;

  it('marks the document while macOS’s Reduce transparency is on, and unmarks it once off', async () => {
    app = { reduced: false, system: true, transparency: true };
    await refresh();
    expect(marked()).toBe('reduced');
    app = { reduced: false, system: true, transparency: false };
    await refresh();
    expect(marked()).toBeUndefined();
  });

  it('keeps the mark through a motion choice, which answers without transparency', async () => {
    app = { reduced: false, system: true, transparency: true };
    await refresh();
    await setMotion(true);
    expect(document.documentElement.dataset.reducedMotion).toBe('');
    expect(marked()).toBe('reduced');
    await setMotion(null);
    expect(marked()).toBe('reduced');
  });

  it('leaves the document unmarked when the app never says', () => {
    const root = { dataset: {} as DOMStringMap };
    mark({ reduced: true, system: false }, root);
    expect(root.dataset.transparency).toBeUndefined();
    mark({ reduced: false, system: true, transparency: true }, root);
    expect(root.dataset).toEqual({ transparency: 'reduced' });
  });
});

describe('useAccessibility', () => {
  it('reads the setting at mount, and again when macOS’s changes or the window comes back', async () => {
    const q = fakeQuery();
    renderHook(() => useAccessibility());
    expect(q.matchMedia).toHaveBeenCalledWith(SYSTEM_QUERY);
    expect(q.matchMedia).toHaveBeenCalledWith(TRANSPARENCY_QUERY);
    await waitFor(() => expect(asked()).toBe(1));
    app = { reduced: true, system: true };
    q.change();
    await waitFor(() => expect(asked()).toBe(2));
    await waitFor(() => expect(document.documentElement.dataset.reducedMotion).toBe(''));
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(asked()).toBe(3));
  });

  it('marks the document for Reduce transparency when the window comes back, as macOS’s setting changed', async () => {
    fakeQuery();
    renderHook(() => useAccessibility());
    await waitFor(() => expect(asked()).toBe(1));
    expect(document.documentElement.dataset.transparency).toBeUndefined();
    app = { reduced: false, system: true, transparency: true };
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(document.documentElement.dataset.transparency).toBe('reduced'));
    app = { reduced: false, system: true, transparency: false };
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(document.documentElement.dataset.transparency).toBeUndefined());
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
