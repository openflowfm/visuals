// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useElapsed } from './useElapsed';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
});
afterEach(() => vi.useRealTimers());

describe('useElapsed', () => {
  it('ticks each second while on', () => {
    const { result } = renderHook(() => useElapsed(8_000, true, 30));
    expect(result.current).toEqual({ elapsed: 2, length: 30 });
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toEqual({ elapsed: 3, length: 30 });
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current?.elapsed).toBe(5);
  });

  it('never goes below zero', () => {
    const { result } = renderHook(() => useElapsed(12_000, true, null));
    expect(result.current).toEqual({ elapsed: 0, length: null });
  });

  it('is null when off, with its interval cleared', () => {
    const clear = vi.spyOn(window, 'clearInterval');
    const { result, rerender } = renderHook(({ on }) => useElapsed(8_000, on, 30), { initialProps: { on: true } });
    expect(vi.getTimerCount()).toBe(1);
    rerender({ on: false });
    expect(result.current).toBeNull();
    expect(clear).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts over from a new since', () => {
    const { result, rerender } = renderHook(({ since }) => useElapsed(since, true, 30), { initialProps: { since: 8_000 } });
    act(() => vi.advanceTimersByTime(1000));
    rerender({ since: 11_000 });
    expect(result.current?.elapsed).toBe(0);
  });

  it('stops ticking on unmount', () => {
    const { unmount } = renderHook(() => useElapsed(8_000, true, 30));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
