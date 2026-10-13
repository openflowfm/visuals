// @vitest-environment happy-dom
//
// `useLibrary` (library.ts): the page's start preset against the one the app put
// back (`resume.rs`). While the app picks up where it left off, the page opens
// nothing of its own. Its backend is the fixtures' (`ui/fixtures/backend.ts`).
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { install, type World } from '../fixtures/backend';
import type { Entry, Resume } from './api';
import { currentBridge, localEvents, setBridge, type InvokeArgs } from './ipc';
import { useLibrary } from './library';
import { CHANGED } from './pack';
import { EMPTY_DECK } from './playlists';

const ENTRIES: Entry[] = ['a', 'b', 'c'].map((k) => ({ path: `/p/${k}.milk`, name: k, group: 'A' }));

/** The commands the page sent, in order. */
let sent: string[] = [];
const undo: (() => void)[] = [];

/**
 * The fixtures' app behind the page, with nothing playing on the deck unless `over` says so;
 * every command it is sent is noted in `sent`, and `presets` answers a copy each time, as the
 * real app's answer is a new array.
 */
function backend(over: Partial<World> = {}) {
  const restore = install({ entries: ENTRIES, resume: null, lists: { playlists: [], deck: EMPTY_DECK }, ...over });
  const inner = currentBridge();
  const unspy = setBridge({
    ...inner,
    invoke: <T,>(cmd: string, args?: InvokeArgs) => {
      sent.push(cmd);
      const answer = inner.invoke<T>(cmd, args);
      return cmd === 'presets' ? answer.then((l) => [...(l as Entry[])] as T) : answer;
    },
  });
  undo.push(() => {
    unspy();
    restore();
  });
}

afterEach(() => {
  cleanup();
  for (const u of undo.splice(0)) u();
  sent = [];
});

const settle = () => act(() => new Promise<void>((done) => setTimeout(done, 0)));

/** The hook mounted, once the library is read: what it opened, what it was told was put back, and what it said failed. */
async function started(start: string | null = null) {
  const load = vi.fn();
  const onResumed = vi.fn();
  const failed = vi.fn();
  const fail = vi.fn(() => failed);
  const hook = renderHook(() => useLibrary(start, load, fail, onResumed));
  await settle();
  return { load, onResumed, fail, failed, hook };
}

describe('the page starting while the app picks up where it left off', () => {
  it('opens nothing of its own and shows the preset put back', async () => {
    backend({ resume: { playlist: null, index: null, current: '/p/b.milk', source: null } satisfies Resume });
    const { load, onResumed } = await started();
    expect(load).not.toHaveBeenCalled();
    expect(onResumed).toHaveBeenCalledWith(ENTRIES[1]);
  });

  it('names what the deck plays now when it has moved on from the preset put back', async () => {
    backend({ resume: { playlist: 'mine', index: 0, current: '/p/b.milk', source: null }, lists: { playlists: [], deck: { ...EMPTY_DECK, current: '/p/a.milk' } } });
    const { load, onResumed } = await started();
    expect(load).not.toHaveBeenCalled();
    expect(onResumed).toHaveBeenCalledWith(ENTRIES[0]);
  });

  // `resume_state` answers none both with nothing to pick up and when the restore
  // opened nothing (the file gone, the playlist or filter failing): never black.
  it('opens a preset of its own with nothing to pick up, or when the restore opened nothing', async () => {
    backend();
    const { load, onResumed } = await started();
    expect(load).toHaveBeenCalledTimes(1);
    expect(onResumed).not.toHaveBeenCalled();
  });

  it('opens the preset it was started on without asking', async () => {
    backend({ resume: { playlist: null, index: null, current: '/p/b.milk', source: null } });
    const { load } = await started('/p/c.milk');
    expect(load).toHaveBeenCalledWith(ENTRIES[2]);
    expect(sent).not.toContain('resume_state');
  });
});

describe('the library when the folder changes or fails', () => {
  it('counts as loaded when the preset folder can’t be read, and says so', async () => {
    backend({ fail: { presets: 'the folder is gone' } });
    const { load, fail, failed, hook } = await started();
    expect(hook.result.current.loaded).toBe(true);
    expect(hook.result.current.library).toEqual([]);
    expect(fail).toHaveBeenCalledWith("Couldn't read the preset folder.");
    expect(failed).toHaveBeenCalledWith('the folder is gone');
    expect(load).not.toHaveBeenCalled();
  });

  it('reads the library again when the presets folder changes', async () => {
    const entries = [...ENTRIES];
    backend({ entries });
    const { hook } = await started();
    expect(hook.result.current.library).toHaveLength(3);
    entries.push({ path: '/p/d.milk', name: 'd', group: 'A' });
    await act(() => localEvents().emit(CHANGED));
    await settle();
    expect(sent.filter((c) => c === 'presets')).toHaveLength(2);
    expect(hook.result.current.library.map((e) => e.name)).toEqual(['a', 'b', 'c', 'd']);
  });
});
