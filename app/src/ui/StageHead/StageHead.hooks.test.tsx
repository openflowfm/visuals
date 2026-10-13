// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setBridge } from '../model/ipc';
import { QUIET_MS } from '../Onboarding/Onboarding';
import { useSilent } from './StageHead';

/** `levels` answered by `answer`, each poll counted. */
function levels(answer: (poll: number) => Promise<[number, number]>) {
  let polls = 0;
  const restore = setBridge({
    invoke: <T,>(cmd: string) => (cmd === 'levels' ? (answer(++polls) as Promise<T>) : Promise.reject(new Error(cmd))),
  });
  return { restore, polls: () => polls };
}

const wait = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

describe('useSilent', () => {
  let l: ReturnType<typeof levels> | undefined;
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    l?.restore();
    l = undefined;
    vi.useRealTimers();
  });

  it('is quiet only once every poll has been quiet for QUIET_MS, and not after a loud one', async () => {
    let loud = false;
    l = levels(() => Promise.resolve(loud ? [0.5, 0.1] : [0, 0.01]));
    const { result, unmount } = renderHook(() => useSilent());
    await wait(QUIET_MS - 250);
    expect(result.current).toBe(false);
    await wait(250);
    expect(result.current).toBe(true);
    expect(l.polls()).toBe(QUIET_MS / 250 + 1); // four a second

    loud = true;
    await wait(250);
    expect(result.current).toBe(false);
    loud = false;
    await wait(QUIET_MS); // the next quiet poll is 250 ms on: the quiet starts over from it
    expect(result.current).toBe(false);
    await wait(250);
    expect(result.current).toBe(true);
    unmount();
  });

  it('keeps polling after a failed poll', async () => {
    l = levels((poll) => (poll <= 3 ? Promise.reject(new Error('no input')) : Promise.resolve([0, 0])));
    const { result, unmount } = renderHook(() => useSilent());
    await wait(750);
    expect(l.polls()).toBe(4);
    expect(result.current).toBe(false);
    await wait(QUIET_MS);
    expect(result.current).toBe(true);
    unmount();
  });

  it('stops polling once unmounted, even with a poll out', async () => {
    let answer!: (v: [number, number]) => void;
    l = levels((poll) => (poll === 3 ? new Promise((res) => (answer = res)) : Promise.resolve([0, 0])));
    const { unmount } = renderHook(() => useSilent());
    await wait(500);
    expect(l.polls()).toBe(3);
    unmount();
    answer([0, 0]);
    await wait(5000);
    expect(l.polls()).toBe(3);
  });

  it('stops polling once unmounted between polls', async () => {
    l = levels(() => Promise.resolve([0, 0]));
    const { unmount } = renderHook(() => useSilent());
    await wait(100);
    const polls = l.polls();
    unmount();
    await wait(5000);
    expect(l.polls()).toBe(polls);
  });
});
