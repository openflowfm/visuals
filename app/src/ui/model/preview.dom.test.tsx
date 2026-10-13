// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setBridge, type InvokeArgs } from './ipc';
import { usePreview } from './preview';

/** Every command the page sends, answered by `answer`. */
function bridge(answer: (cmd: string, args?: InvokeArgs) => unknown) {
  const calls: [string, InvokeArgs | undefined][] = [];
  const restore = setBridge({
    invoke: <T,>(cmd: string, args?: InvokeArgs) => {
      calls.push([cmd, args]);
      return Promise.resolve(answer(cmd, args) as T);
    },
  });
  return { calls, count: (cmd: string) => calls.filter(([c]) => c === cmd).length, restore };
}

describe("the bench's usePreview", () => {
  let fps: number;
  let b: ReturnType<typeof bridge>;
  beforeEach(() => {
    vi.useFakeTimers();
    // usePlaceBench follows the box every frame: one frame here, never another.
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    fps = 0;
    b = bridge((cmd) => (cmd === 'stats' ? { fps } : null));
  });
  afterEach(() => {
    b.restore();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const box = () => ({ current: document.createElement('div') });

  it('is false until the engine counts frames, then true', async () => {
    const ref = box();
    const { result, unmount } = renderHook(() => usePreview(ref));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(b.count('stats')).toBe(1);
    expect(b.count('place_bench')).toBe(1);
    expect(result.current).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(result.current).toBe(false);
    fps = 30;
    await act(() => vi.advanceTimersByTimeAsync(250));
    expect(result.current).toBe(true);
    // Drawing: it stops asking.
    const asked = b.count('stats');
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(b.count('stats')).toBe(asked);
    unmount();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
  });

  it('stops asking for stats when unmounted', async () => {
    const ref = box();
    const { unmount } = renderHook(() => usePreview(ref));
    await act(() => vi.advanceTimersByTimeAsync(600));
    const asked = b.count('stats');
    expect(asked).toBeGreaterThan(1);
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(b.count('stats')).toBe(asked);
  });
});
