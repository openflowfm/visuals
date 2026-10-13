// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setBridge, type InvokeArgs, type UnlistenFn } from './ipc';
import { usePlaceBench, useTauriEvent } from './hooks';

/** A subscription whose promise resolves only when `resolve` is called, counting its listeners and unlistens. */
function deferredSubscribe<T>() {
  const handlers: ((p: T) => void)[] = [];
  const unlisten = vi.fn();
  let resolve: () => void = () => {};
  const subscribe = vi.fn((f: (p: T) => void) => {
    handlers.push(f);
    return new Promise<UnlistenFn>((r) => {
      resolve = () => r(unlisten);
    });
  });
  return { subscribe, handlers, unlisten, resolve: () => resolve() };
}

/** A subscription that resolves at once. */
function subscription<T>() {
  const handlers: ((p: T) => void)[] = [];
  const unlisten = vi.fn();
  const subscribe = vi.fn((f: (p: T) => void) => {
    handlers.push(f);
    return Promise.resolve<UnlistenFn>(unlisten);
  });
  return { subscribe, handlers, unlisten };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('useTauriEvent', () => {
  it('calls the latest handler without subscribing again', () => {
    const s = subscription<number>();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ h }) => useTauriEvent(s.subscribe, h), { initialProps: { h: first } });
    rerender({ h: second });
    expect(s.subscribe).toHaveBeenCalledTimes(1);
    s.handlers[0](7);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(7);
  });

  it('still unlistens when unmounted before the subscription resolves', async () => {
    const s = deferredSubscribe<number>();
    const { unmount } = renderHook(() => useTauriEvent(s.subscribe, () => {}));
    unmount();
    expect(s.unlisten).not.toHaveBeenCalled();
    s.resolve();
    await settle();
    expect(s.unlisten).toHaveBeenCalledTimes(1);
  });

  it('subscribes again, and lets go of the old one, when the subscription changes', async () => {
    const a = subscription<number>();
    const b = subscription<number>();
    const { rerender, unmount } = renderHook(({ sub }) => useTauriEvent(sub, () => {}), { initialProps: { sub: a.subscribe } });
    rerender({ sub: b.subscribe });
    await settle();
    expect(a.unlisten).toHaveBeenCalledTimes(1);
    expect(b.subscribe).toHaveBeenCalledTimes(1);
    expect(b.unlisten).not.toHaveBeenCalled();
    unmount();
    await settle();
    expect(b.unlisten).toHaveBeenCalledTimes(1);
  });
});

describe('usePlaceBench', () => {
  let frames: Map<number, FrameRequestCallback>;
  let calls: [string, InvokeArgs | undefined][];
  let restore: () => void;
  /** Run the frames pending now, as the browser would at the next display refresh. */
  const frame = () => {
    const now = [...frames];
    frames.clear();
    for (const [, f] of now) f(0);
  };

  beforeEach(() => {
    frames = new Map();
    let id = 0;
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => (frames.set(++id, f), id));
    vi.stubGlobal('cancelAnimationFrame', (n: number) => frames.delete(n));
    calls = [];
    restore = setBridge({
      invoke: <T,>(cmd: string, args?: InvokeArgs) => {
        calls.push([cmd, args]);
        return Promise.resolve(undefined as T);
      },
    });
  });
  afterEach(() => {
    restore();
    vi.unstubAllGlobals();
  });

  const hole = (radius = '') => {
    const el = document.createElement('div');
    el.style.borderTopLeftRadius = radius;
    el.getBoundingClientRect = () => ({ left: 10, top: 40, width: 320, height: 180 }) as DOMRect;
    document.body.append(el);
    return el;
  };

  it('sends an unchanged hole once however many frames pass', () => {
    const el = hole();
    renderHook(() => usePlaceBench({ current: el }));
    frame();
    frame();
    frame();
    expect(calls).toEqual([['place_bench', { x: 10, y: 40, width: 320, height: 180 }]]);
    el.remove();
  });

  it('sends the hole again when it moves, with its rounded corners', () => {
    const el = hole('18px');
    renderHook(() => usePlaceBench({ current: el }));
    el.getBoundingClientRect = () => ({ left: 10, top: 76, width: 320, height: 180 }) as DOMRect;
    frame();
    expect(calls).toEqual([
      ['place_bench', { x: 10, y: 40, width: 320, height: 180, radius: 18 }],
      ['place_bench', { x: 10, y: 76, width: 320, height: 180, radius: 18 }],
    ]);
    el.remove();
  });

  it('stops reading the hole once unmounted', () => {
    const el = hole();
    const { unmount } = renderHook(() => usePlaceBench({ current: el }));
    expect(frames.size).toBe(1);
    unmount();
    expect(frames.size).toBe(0);
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1, height: 1 }) as DOMRect;
    frame();
    expect(calls).toHaveLength(1);
    el.remove();
  });
});
