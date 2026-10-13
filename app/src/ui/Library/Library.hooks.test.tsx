// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emit, setBridge, type InvokeArgs } from '../model/ipc';
import { LIBRARY_CHANGED_EVENT, type LibraryData, type LibraryRow } from '../model/api';
import { CHANGED } from '../model/pack';
import { useIndex, useLibraryData } from './Library';

/** A promise and what settles it. */
function later<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Each command answered by `answer`; every call kept. */
function bridge(answer: (cmd: string, args?: InvokeArgs) => Promise<unknown>) {
  const calls: string[] = [];
  const restore = setBridge({
    invoke: <T,>(cmd: string, args?: InvokeArgs) => {
      calls.push(cmd);
      return answer(cmd, args) as Promise<T>;
    },
  });
  return { calls, restore, count: (cmd: string) => calls.filter((c) => c === cmd).length };
}

const rows = (name: string) => [{ path: name }] as unknown as LibraryRow[];
const data = (name: string) => ({ name }) as unknown as LibraryData;
const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));
const wait = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

describe('useIndex', () => {
  let b: ReturnType<typeof bridge> | undefined;
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    b?.restore();
    b = undefined;
    vi.useRealTimers();
  });

  it('reads the index once at start, and a burst of folder changes reads it once more', async () => {
    let n = 0;
    b = bridge((cmd) => (cmd === 'library_index' ? Promise.resolve(rows(`read ${++n}`)) : Promise.reject(new Error(cmd))));
    const { result, unmount } = renderHook(() => useIndex());
    expect(result.current).toEqual({ index: null, settled: false });
    await flush();
    expect(b.count('library_index')).toBe(1);
    expect(result.current).toEqual({ index: rows('read 1'), settled: true });

    for (let i = 0; i < 5; i++) {
      await act(() => emit(CHANGED));
      await wait(100);
    }
    expect(b.count('library_index')).toBe(1); // still within the quiet wait
    await wait(500);
    expect(b.count('library_index')).toBe(2);
    expect(result.current.index).toEqual(rows('read 2'));
    await wait(5000);
    expect(b.count('library_index')).toBe(2);
    unmount();
  });

  it('keeps one read in flight: a change during it reads after it, so the newer rows land last', async () => {
    const answers = [later<LibraryRow[]>(), later<LibraryRow[]>()];
    let n = 0;
    b = bridge((cmd) => (cmd === 'library_index' ? answers[n++].promise : Promise.reject(new Error(cmd))));
    const { result, unmount } = renderHook(() => useIndex());
    await flush();
    await act(() => emit(CHANGED));
    await wait(600);
    expect(b.count('library_index')).toBe(1); // not while the first is out
    answers[0].resolve(rows('old'));
    await flush();
    expect(result.current.index).toEqual(rows('old'));
    expect(b.count('library_index')).toBe(2);
    answers[1].resolve(rows('new'));
    await flush();
    expect(result.current.index).toEqual(rows('new'));
    unmount();
  });

  it('is settled with no rows when the first read fails', async () => {
    b = bridge(() => Promise.reject(new Error('no index')));
    const { result, unmount } = renderHook(() => useIndex());
    await flush();
    expect(result.current).toEqual({ index: null, settled: true });
    unmount();
  });

  it('stops rereading once unmounted', async () => {
    b = bridge(() => Promise.resolve(rows('x')));
    const { unmount } = renderHook(() => useIndex());
    await flush();
    await act(() => emit(CHANGED));
    unmount();
    await wait(5000);
    await act(() => emit(CHANGED));
    await wait(5000);
    expect(b.count('library_index')).toBe(1);
  });
});

describe('useLibraryData', () => {
  let b: ReturnType<typeof bridge> | undefined;
  afterEach(() => {
    b?.restore();
    b = undefined;
  });

  it('takes the first read, then follows library-changed', async () => {
    b = bridge((cmd) => (cmd === 'library_data' ? Promise.resolve(data('read')) : Promise.reject(new Error(cmd))));
    const { result, unmount } = renderHook(() => useLibraryData());
    expect(result.current[0]).toBeNull();
    await act(async () => {});
    expect(result.current[0]).toEqual(data('read'));
    await act(() => emit(LIBRARY_CHANGED_EVENT, data('changed')));
    expect(result.current[0]).toEqual(data('changed'));
    expect(b.count('library_data')).toBe(1); // the event carries the data: no reread
    unmount();
  });

  it('drops the first read when it answers after a newer change event', async () => {
    const first = later<LibraryData>();
    b = bridge(() => first.promise);
    const { result, unmount } = renderHook(() => useLibraryData());
    await act(() => emit(LIBRARY_CHANGED_EVENT, data('newer')));
    expect(result.current[0]).toEqual(data('newer'));
    await act(async () => first.resolve(data('older')));
    expect(result.current[0]).toEqual(data('newer'));
    unmount();
  });

  it("drops an applied answer older than one already applied, and an event's data beats an older answer", async () => {
    b = bridge(() => Promise.resolve(data('read')));
    const { result, unmount } = renderHook(() => useLibraryData());
    await act(async () => {});
    const one = later<LibraryData>();
    const two = later<LibraryData>();
    const apply = result.current[1];
    let a1!: Promise<void>, a2!: Promise<void>;
    act(() => {
      a1 = apply(one.promise);
      a2 = apply(two.promise);
    });
    await act(async () => {
      two.resolve(data('two'));
      await a2;
    });
    expect(result.current[0]).toEqual(data('two'));
    await act(async () => {
      one.resolve(data('one'));
      await a1;
    });
    expect(result.current[0]).toEqual(data('two'));

    const three = later<LibraryData>();
    let a3!: Promise<void>;
    act(() => void (a3 = apply(three.promise)));
    await act(() => emit(LIBRARY_CHANGED_EVENT, data('event')));
    await act(async () => {
      three.resolve(data('three'));
      await a3;
    });
    expect(result.current[0]).toEqual(data('event'));
    unmount();
  });

  it('stops following library-changed once unmounted', async () => {
    b = bridge(() => Promise.resolve(data('read')));
    const { result, unmount } = renderHook(() => useLibraryData());
    await act(async () => {});
    unmount();
    await act(() => emit(LIBRARY_CHANGED_EVENT, data('after')));
    expect(result.current[0]).toEqual(data('read'));
  });
});
