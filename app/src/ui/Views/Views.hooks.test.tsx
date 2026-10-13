// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MENU_SETTINGS_EVENT } from '../model/api';
import { emit, setBridge, type UnlistenFn } from '../model/ipc';
import { SHEET_EVENT, openSheet, useSheet } from './Views';

describe('useSheet', () => {
  it('opens the sheet openSheet asks for, and ignores an event for anything else', () => {
    const { result } = renderHook(() => useSheet());
    expect(result.current.sheet).toBeNull();
    act(() => openSheet('camera'));
    expect(result.current.sheet).toBe('camera');
    act(() => {
      window.dispatchEvent(new CustomEvent(SHEET_EVENT, { detail: 'nonsense' }));
      window.dispatchEvent(new Event(SHEET_EVENT));
    });
    expect(result.current.sheet).toBe('camera');
    act(() => result.current.close());
    expect(result.current.sheet).toBeNull();
  });

  it("ignores the menu's Settings… while disabled, and opens Settings once enabled", async () => {
    const { result, rerender, unmount } = renderHook(({ on }) => useSheet(on), { initialProps: { on: false } });
    await act(() => Promise.resolve());
    await act(() => emit(MENU_SETTINGS_EVENT));
    expect(result.current.sheet).toBeNull();
    rerender({ on: true });
    await act(() => emit(MENU_SETTINGS_EVENT));
    expect(result.current.sheet).toBe('settings');
    unmount();
  });

  it('stops listening to the menu when unmounted before the subscription resolves', async () => {
    let resolve: (un: UnlistenFn) => void = () => {};
    const un = vi.fn();
    const restore = setBridge({ listen: () => new Promise<UnlistenFn>((r) => (resolve = r)) });
    try {
      const { unmount } = renderHook(() => useSheet());
      unmount();
      expect(un).not.toHaveBeenCalled();
      await act(async () => resolve(un));
      expect(un).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });
});
