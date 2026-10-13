// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emit, localEvents, setBridge, type InvokeArgs } from '../model/ipc';
import type { Fx, FxAction } from '../model/fx';
import { useFx } from './Effects';

/** A promise the test settles. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

const FX = { speed: 1, hue: 0, trails: 0, brightness: 1 } as unknown as Fx;

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
  localEvents().clear();
});

/** `fx_state` answers `read`; each `act` waits for the test to settle it. */
function backend(read: () => Promise<Fx>) {
  const acts: { action: FxAction; answer: ReturnType<typeof deferred<void>> }[] = [];
  const invoke = vi.fn((cmd: string, args?: InvokeArgs) => {
    if (cmd === 'fx_state') return read();
    if (cmd === 'act') {
      const answer = deferred<void>();
      acts.push({ action: (args as { action: FxAction }).action, answer });
      return answer.promise;
    }
    return Promise.reject(new Error(cmd));
  });
  restore = setBridge({ invoke: invoke as <T>(cmd: string, args?: InvokeArgs) => Promise<T> });
  return { invoke, acts };
}

describe('useFx', () => {
  it('reads the effects once', async () => {
    const b = backend(() => Promise.resolve(FX));
    const { result } = renderHook(() => useFx());
    expect(result.current.state).toBeNull();
    await waitFor(() => expect(result.current.state).toEqual(FX));
    expect(b.invoke).toHaveBeenCalledTimes(1);
    expect(result.current.notice).toBeNull();
  });

  it('shows a patch at once, before the app answers', async () => {
    const b = backend(() => Promise.resolve(FX));
    const { result } = renderHook(() => useFx());
    await waitFor(() => expect(result.current.state).not.toBeNull());
    const action = { kind: 'hue', value: 0.5 } as unknown as FxAction;
    act(() => result.current.set(action, { hue: 0.5 }));
    expect(result.current.state).toEqual({ ...FX, hue: 0.5 });
    expect(b.acts.map((a) => a.action)).toEqual([action]);
    await act(async () => b.acts[0].answer.resolve());
    expect(result.current.state).toEqual({ ...FX, hue: 0.5 });
    expect(result.current.notice).toBeNull();
  });

  it('says so when a change fails', async () => {
    const b = backend(() => Promise.resolve(FX));
    const { result } = renderHook(() => useFx());
    await waitFor(() => expect(result.current.state).not.toBeNull());
    act(() => result.current.send({ kind: 'punch', on: null } as FxAction));
    await act(async () => b.acts[0].answer.reject(new Error('no deck')));
    expect(result.current.notice).toEqual({ message: "Couldn't change that effect.", detail: 'no deck' });
    act(() => result.current.dismiss());
    expect(result.current.notice).toBeNull();
  });

  it("says so when the effects can't be read", async () => {
    backend(() => Promise.reject(new Error('gone')));
    const { result } = renderHook(() => useFx());
    await waitFor(() => expect(result.current.notice).toEqual({ message: "Couldn't read the effects.", detail: 'gone' }));
    expect(result.current.state).toBeNull();
  });

  it("takes the app's fx event over a patch", async () => {
    backend(() => Promise.resolve(FX));
    const { result } = renderHook(() => useFx());
    await waitFor(() => expect(result.current.state).not.toBeNull());
    act(() => result.current.set({ kind: 'hue', value: 0.5 } as unknown as FxAction, { hue: 0.5 }));
    const told = { ...FX, hue: 0.25, trails: 0.75 };
    await act(() => emit('fx', told));
    expect(result.current.state).toEqual(told);
  });
});
