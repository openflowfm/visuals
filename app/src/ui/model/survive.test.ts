import { describe, expect, it } from 'vitest';
import { follow, problemKey, shownProblems } from './survive.ts';
import type { SettingsProblem } from './api.ts';

/** A list read and its event, driven by hand. */
function source<T>() {
  let resolveRead: (v: T) => void = () => {};
  let send: (v: T) => void = () => {};
  let unlistened = 0;
  const read = () => new Promise<T>((r) => (resolveRead = r));
  const subscribe = (f: (v: T) => void) => {
    send = f;
    return Promise.resolve(() => void unlistened++);
  };
  return { read, subscribe, resolve: (v: T) => resolveRead(v), send: (v: T) => send(v), unlistened: () => unlistened };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('follow', () => {
  it('sets what the first read finds, then each list the event sends', async () => {
    const s = source<string[]>();
    const got: string[][] = [];
    follow(s.read, s.subscribe, (v) => got.push(v));
    s.resolve(['/a.milk']);
    await tick();
    s.send(['/a.milk', '/b.milk']);
    expect(got).toEqual([['/a.milk'], ['/a.milk', '/b.milk']]);
  });

  it('drops a read that comes back after an event, which is newer', async () => {
    const s = source<string[]>();
    const got: string[][] = [];
    follow(s.read, s.subscribe, (v) => got.push(v));
    s.send(['/new.milk']);
    s.resolve([]);
    await tick();
    expect(got).toEqual([['/new.milk']]);
  });

  it('sets nothing once stopped, and stops listening', async () => {
    const s = source<string[]>();
    const got: string[][] = [];
    const stop = follow(s.read, s.subscribe, (v) => got.push(v));
    stop();
    s.resolve(['/a.milk']);
    s.send(['/b.milk']);
    await tick();
    expect(got).toEqual([]);
    expect(s.unlistened()).toBe(1);
  });

  it('shrugs off a read that fails', async () => {
    const got: string[][] = [];
    follow(
      () => Promise.reject(new Error('no app')),
      () => Promise.resolve(() => {}),
      (v) => got.push(v),
    );
    await tick();
    expect(got).toEqual([]);
  });
});

describe('shownProblems', () => {
  const tempo: SettingsProblem = { file: 'tempo.json', message: 'Your tempo setting was damaged, so it was reset; the old file is kept as tempo.json.bad.' };
  const lists: SettingsProblem = { file: 'playlists.json', message: 'Your playlists from before couldn’t be backed up as playlists.json.v1, so they haven’t been upgraded on disk yet.' };

  it('shows every problem until one is dismissed', () => {
    expect(shownProblems([tempo, lists], new Set())).toEqual([tempo, lists]);
    expect(shownProblems([tempo, lists], new Set([problemKey(tempo)]))).toEqual([lists]);
  });

  it('shows a new message about a file dismissed before', () => {
    const again = { file: 'tempo.json', message: 'Your tempo setting couldn’t be saved.' };
    expect(shownProblems([again], new Set([problemKey(tempo)]))).toEqual([again]);
  });

  it('shows the same problem once', () => {
    expect(shownProblems([tempo, { ...tempo }], new Set())).toEqual([tempo]);
  });

  it('keys by file and message together', () => {
    expect(problemKey({ file: 'a', message: 'b c' })).not.toBe(problemKey({ file: 'a b', message: 'c' }));
  });
});
