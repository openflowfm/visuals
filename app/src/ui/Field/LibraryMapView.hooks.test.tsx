// @vitest-environment happy-dom
//
// `usePlotShape` (LibraryMapView.tsx): when the Map view's plot shape updates as its room
// resizes (visuals#267). Timing only, on fake timers and a fake ResizeObserver: no position or
// size is asserted beyond "the shape a single measure of that size gives".
//
// Spec:
// 1. With no ResizeObserver, or no room element, the shape is the default 4:3 box (`BOX`), and
//    stays it as time passes.
// 2. The first measure applies at once: no timer has to run.
// 3. A later resize leaves the shape as it was until the size has held for 150 ms: at 149 ms it
//    is still the old shape, at 150 ms it is the newest size's.
// 4. A burst of resizes recomputes the shape once, to the last size of the burst.
// 5. Every resize restarts the 150 ms wait.
// 6. Unmounted, it stops observing and updates nothing afterwards.
import { act, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOX, type Box } from '../model/field';
import { usePlotShape } from './LibraryMapView';

type Size = { width: number; height: number };

/** A ResizeObserver the test drives: `resize` sizes the observed element and tells the hook. */
class FakeResizeObserver {
  static all: FakeResizeObserver[] = [];
  targets: Element[] = [];
  disconnected = false;
  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.all.push(this);
  }
  observe(el: Element) {
    this.targets.push(el);
  }
  unobserve(el: Element) {
    this.targets = this.targets.filter((t) => t !== el);
  }
  disconnect() {
    this.disconnected = true;
    this.targets = [];
  }
  fire() {
    const entries = this.targets.map((target) => {
      const { width, height } = sizes.get(target)!;
      const box = [{ inlineSize: width, blockSize: height }];
      return { target, contentRect: { x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height }, contentBoxSize: box, borderBoxSize: box, devicePixelContentBoxSize: box };
    }) as unknown as ResizeObserverEntry[];
    if (entries.length) this.callback(entries, this as unknown as ResizeObserver);
  }
}

const sizes = new Map<Element, Size>();

/** A room element holding the plot (`.vs-field-plot`, as LibraryMapView renders it), whose measured size the test sets. */
function roomOf(size: Size): RefObject<HTMLDivElement | null> {
  const room = document.createElement('div');
  const el = document.createElement('div');
  el.className = 'vs-field-plot';
  room.append(el);
  document.body.append(room);
  sizes.set(el, size);
  const get = (k: keyof Size) => () => sizes.get(el)![k];
  for (const [prop, k] of [
    ['clientWidth', 'width'],
    ['offsetWidth', 'width'],
    ['scrollWidth', 'width'],
    ['clientHeight', 'height'],
    ['offsetHeight', 'height'],
    ['scrollHeight', 'height'],
  ] as const)
    Object.defineProperty(el, prop, { configurable: true, get: get(k) });
  el.getBoundingClientRect = () => {
    const { width, height } = sizes.get(el)!;
    return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({}) } as DOMRect;
  };
  return { current: room };
}

const plotOf = (room: RefObject<HTMLDivElement | null>) => room.current!.querySelector('.vs-field-plot')!;

/** Size the plot and tell every observer of it, as a browser does on a resize. */
function resize(room: RefObject<HTMLDivElement | null>, size: Size) {
  const plot = plotOf(room);
  sizes.set(plot, size);
  act(() => {
    for (const ro of FakeResizeObserver.all) if (ro.targets.includes(plot)) ro.fire();
  });
}

/** The hook mounted on a room of `size`, its first measure delivered as the observer's first callback. */
function mount(size: Size) {
  const room = roomOf(size);
  const shapes: Box[] = [];
  const hook = renderHook(() => {
    const s = usePlotShape(room);
    shapes.push(s);
    return s;
  });
  resize(room, size);
  /** How many times the shape changed, counted over the renders. */
  const changes = () => shapes.reduce((n, s, i) => (i > 0 && (s.w !== shapes[i - 1].w || s.h !== shapes[i - 1].h) ? n + 1 : n), 0);
  return { room, ...hook, changes };
}

/** The shape a single first measure of `size` gives: what a settled resize to it should show. */
function shapeFor(size: Size): Box {
  const { result, unmount } = mount(size);
  const s = result.current;
  unmount();
  return s;
}

const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

const A = { width: 800, height: 600 };
const B = { width: 1200, height: 500 };
const C = { width: 640, height: 900 };

beforeEach(() => {
  vi.useFakeTimers();
  FakeResizeObserver.all = [];
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  sizes.clear();
  document.body.replaceChildren();
});

describe('usePlotShape', () => {
  it('spec 1: the default box without a ResizeObserver or a room', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const room = roomOf(A);
    const { result } = renderHook(() => usePlotShape(room));
    expect(result.current).toEqual(BOX);
    tick(1000);
    expect(result.current).toEqual(BOX);

    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const none = renderHook(() => usePlotShape({ current: null }));
    tick(1000);
    expect(none.result.current).toEqual(BOX);
  });

  it('spec 2: the first measure applies at once', () => {
    const ref = shapeFor(A);
    const before = vi.getTimerCount();
    const { result } = mount(A);
    expect(result.current).toEqual(ref);
    // No timer stands between the first measure and the shape.
    expect(vi.getTimerCount()).toBeLessThanOrEqual(before);
    // The two sizes used below give different shapes, or the timing tests prove nothing.
    expect(shapeFor(B)).not.toEqual(ref);
    expect(shapeFor(C)).not.toEqual(shapeFor(B));
  });

  it('spec 3: a later resize applies once the size has held for 150 ms', () => {
    const [a, b] = [shapeFor(A), shapeFor(B)];
    const { room, result } = mount(A);
    expect(result.current).toEqual(a);
    resize(room, B);
    expect(result.current).toEqual(a);
    tick(149);
    expect(result.current).toEqual(a);
    tick(1);
    expect(result.current).toEqual(b);
  });

  it('spec 4: a burst of resizes recomputes once, to the last size', () => {
    const [a, c] = [shapeFor(A), shapeFor(C)];
    const { room, result, changes } = mount(A);
    const first = changes();
    for (let i = 0; i < 20; i++) {
      resize(room, { width: 800 + i * 10, height: 600 - i * 5 });
      tick(10);
    }
    resize(room, C);
    expect(result.current).toEqual(a);
    tick(150);
    expect(result.current).toEqual(c);
    expect(changes() - first).toBe(1);
    tick(1000);
    expect(changes() - first).toBe(1);
  });

  it('spec 5: every resize restarts the wait', () => {
    const [a, b, c] = [shapeFor(A), shapeFor(B), shapeFor(C)];
    const { room, result } = mount(A);
    resize(room, B);
    tick(100);
    resize(room, C);
    tick(100);
    // 200 ms since the first resize, 100 since the last: still the first shape.
    expect(result.current).toEqual(a);
    expect(result.current).not.toEqual(b);
    tick(49);
    expect(result.current).toEqual(a);
    tick(1);
    expect(result.current).toEqual(c);
  });

  it('spec 6: unmounted, it stops observing and updates nothing', () => {
    const { room, unmount } = mount(A);
    resize(room, B);
    // The resize's wait is pending…
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(FakeResizeObserver.all.every((ro) => ro.disconnected || !ro.targets.includes(plotOf(room)))).toBe(true);
    // …and unmounting cancels it, so nothing can update afterwards.
    expect(vi.getTimerCount()).toBe(0);
  });
});
