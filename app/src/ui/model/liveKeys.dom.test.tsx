// @vitest-environment happy-dom
//
// `useLiveKeys` (liveKeys.ts): live mode's keys on the window, for as long as the
// component is shown. Unmounting takes every listener away, a pending Esc hold
// with them, and the page hidden lets go of any effect held.
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hitAction } from './fx';
import { LEAVE_HOLD_MS, useLiveKeys, type LiveKeyTargets } from './liveKeys';

function targets(more: Partial<LiveKeyTargets> = {}) {
  return { editor: vi.fn(), act: vi.fn<LiveKeyTargets['act']>(), fx: vi.fn<LiveKeyTargets['fx']>(), rate: vi.fn(), favourite: vi.fn(), help: vi.fn(), ...more };
}

const key = (type: 'keydown' | 'keyup', k: string) => window.dispatchEvent(new KeyboardEvent(type, { key: k }));

/** Says the page is `state`, as the browser does before `visibilitychange`. */
function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

describe('useLiveKeys', () => {
  it('hears the window’s keys while mounted', () => {
    const t = targets();
    renderHook(() => useLiveKeys(t));
    key('keydown', 'ArrowRight');
    expect(t.act).toHaveBeenCalledWith({ kind: 'next' });
  });

  it('unmounted: every listener it added is removed, and a pending Esc hold never leaves', () => {
    const winAdd = vi.spyOn(window, 'addEventListener');
    const winRemove = vi.spyOn(window, 'removeEventListener');
    const docAdd = vi.spyOn(document, 'addEventListener');
    const docRemove = vi.spyOn(document, 'removeEventListener');
    const holding = vi.fn();
    const t = targets({ holding });
    const { unmount } = renderHook(() => useLiveKeys(t));
    const added = (spy: typeof winAdd) => spy.mock.calls.filter(([type]) => ['keydown', 'keyup', 'blur', 'visibilitychange'].includes(type));
    expect(added(winAdd).map(([type]) => type)).toEqual(['keydown', 'keyup', 'blur']);
    expect(added(docAdd).map(([type]) => type)).toEqual(['visibilitychange']);

    key('keydown', 'Escape');
    expect(holding).toHaveBeenLastCalledWith(true);
    unmount();
    for (const [type, listener] of added(winAdd)) expect(winRemove).toHaveBeenCalledWith(type, listener);
    for (const [type, listener] of added(docAdd)) expect(docRemove).toHaveBeenCalledWith(type, listener);

    vi.advanceTimersByTime(LEAVE_HOLD_MS * 2);
    expect(t.editor).not.toHaveBeenCalled();
    key('keydown', 'ArrowRight');
    expect(t.act).not.toHaveBeenCalled();
  });

  it('the page hidden lets go of every effect held', () => {
    const t = targets();
    renderHook(() => useLiveKeys(t));
    key('keydown', 's');
    key('keydown', 'f');
    t.fx.mockClear();
    setVisibility('visible');
    expect(t.fx).not.toHaveBeenCalled();
    setVisibility('hidden');
    expect(t.fx.mock.calls).toEqual([[hitAction('strobe', false)], [hitAction('freeze', false)]]);
  });

  it('the window losing focus lets go too', () => {
    const t = targets();
    renderHook(() => useLiveKeys(t));
    key('keydown', 'p');
    window.dispatchEvent(new Event('blur'));
    expect(t.fx).toHaveBeenLastCalledWith(hitAction('punch', false));
  });

  it('gives back the same Esc feed on every render, which holds toward leaving', () => {
    const t = targets();
    const { result, rerender } = renderHook((to: LiveKeyTargets) => useLiveKeys(to), { initialProps: t });
    const feed = result.current;
    rerender(targets());
    expect(result.current).toBe(feed);
    feed.escapeDown();
    feed.escapeUp();
    vi.advanceTimersByTime(LEAVE_HOLD_MS);
    feed.escapeDown();
    vi.advanceTimersByTime(LEAVE_HOLD_MS - 1);
    expect(t.editor).not.toHaveBeenCalled();
  });

  it('calls the latest targets, without resubscribing', () => {
    const first = targets();
    const add = vi.spyOn(window, 'addEventListener');
    const { result, rerender } = renderHook((to: LiveKeyTargets) => useLiveKeys(to), { initialProps: first });
    const second = targets();
    rerender(second);
    expect(add.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1);
    result.current.escapeDown();
    vi.advanceTimersByTime(LEAVE_HOLD_MS);
    expect(first.editor).not.toHaveBeenCalled();
    expect(second.editor).toHaveBeenCalledTimes(1);
  });

  it('an open modal in the page takes Esc when no sheetOpen is given', () => {
    const t = targets();
    renderHook(() => useLiveKeys(t));
    const sheet = document.createElement('div');
    sheet.setAttribute('aria-modal', 'true');
    document.body.append(sheet);
    try {
      key('keydown', 'Escape');
      vi.advanceTimersByTime(LEAVE_HOLD_MS);
      expect(t.editor).not.toHaveBeenCalled();
    } finally {
      sheet.remove();
    }
  });
});
