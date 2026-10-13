// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { localEvents, setBridge, type InvokeArgs } from '../model/ipc';
import { LIBRARY_CHANGED_EVENT, type LibraryData, type LibraryRow } from '../model/api';
import { CHANGED } from '../model/pack';
import { DEFAULT_SETTINGS, EMPTY_DECK, type Item, type Lists, type Playlist } from '../model/playlists';
import { useLibraryRows, useStrip } from './Home';

/** Every command the page sends, answered by `answer`. */
function bridge(answer: (cmd: string, args?: InvokeArgs) => unknown) {
  const calls: string[] = [];
  const restore = setBridge({
    invoke: <T,>(cmd: string, args?: InvokeArgs) => {
      calls.push(cmd);
      return answer(cmd, args) as Promise<T>;
    },
  });
  return { calls, restore };
}

/** A promise and what settles it, so a test decides the order answers arrive in. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const item = (path: string): Item => ({ path, name: path, group: '', missing: false, hash: null });
const shuffled: Playlist = { id: 'p', name: 'P', items: [item('a.milk'), item('b.milk'), item('c.milk')], kind: 'manual', query: null, settings: { ...DEFAULT_SETTINGS, order: 'shuffle' } };
const playing = (count: number, order: 'in_order' | 'shuffle' = 'shuffle'): Lists => ({ playlists: [shuffled], deck: { ...EMPTY_DECK, playlist: 'p', order, count } });

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
  localEvents().clear();
});

describe('useStrip', () => {
  it('drops an older deckItems answer that arrives after a newer one', async () => {
    const answers: ReturnType<typeof deferred<string[]>>[] = [];
    const b = bridge((cmd) => {
      if (cmd !== 'deck_items') return Promise.resolve(null);
      const d = deferred<string[]>();
      answers.push(d);
      return d.promise;
    });
    restore = b.restore;
    const { result, rerender } = renderHook(({ lists }) => useStrip(shuffled, lists, [], []), { initialProps: { lists: playing(3) } });
    rerender({ lists: playing(4) });
    expect(answers).toHaveLength(2);
    await act(async () => {
      answers[1].resolve(['c.milk', 'b.milk', 'a.milk']);
    });
    await act(async () => {
      answers[0].resolve(['b.milk', 'a.milk', 'c.milk']);
    });
    expect(result.current.tiles.map((t) => t.path)).toEqual(['c.milk', 'b.milk', 'a.milk']);
  });

  it('asks again when the deck order changes, and not when nothing in its key does', async () => {
    const b = bridge((cmd) => Promise.resolve(cmd === 'deck_items' ? ['b.milk', 'c.milk', 'a.milk'] : null));
    restore = b.restore;
    const { result, rerender } = renderHook(({ lists }) => useStrip(shuffled, lists, [], []), { initialProps: { lists: playing(3) } });
    await waitFor(() => expect(result.current.tiles.map((t) => t.path)).toEqual(['b.milk', 'c.milk', 'a.milk']));
    expect(b.calls.filter((c) => c === 'deck_items')).toHaveLength(1);
    rerender({ lists: playing(3) });
    expect(b.calls.filter((c) => c === 'deck_items')).toHaveLength(1);
    rerender({ lists: playing(3, 'in_order') });
    expect(b.calls.filter((c) => c === 'deck_items')).toHaveLength(2);
  });
});

const row = (path: string, title: string): LibraryRow => ({ key: path, path, hash: '', style: 'Other', sub_style: null, authors: ['unknown'], title, thumbnail: null, look: null, starter: false });

describe('useLibraryRows', () => {
  it('reads the library again on library-changed and presets-changed, and stops after unmount', async () => {
    let index = [row('a.milk', 'A')];
    let data: LibraryData = { version: 1, presets: {} };
    const b = bridge((cmd) => Promise.resolve(cmd === 'library_index' ? index : cmd === 'library_data' ? data : null));
    restore = b.restore;
    const count = (cmd: string) => b.calls.filter((c) => c === cmd).length;
    const { result, unmount } = renderHook(() => useLibraryRows());
    await waitFor(() => expect(result.current.rows?.map((p) => p.title)).toEqual(['A']));
    expect(count('library_data')).toBe(1);
    await waitFor(() => expect(localEvents().count(LIBRARY_CHANGED_EVENT)).toBe(1));

    data = { version: 2, presets: {} };
    await act(() => localEvents().emit(LIBRARY_CHANGED_EVENT, data));
    expect(count('library_data')).toBe(2);
    await waitFor(() => expect(result.current.data).toBe(data));

    index = [row('a.milk', 'A'), row('b.milk', 'B')];
    await act(() => localEvents().emit(CHANGED));
    await waitFor(() => expect(result.current.rows?.map((p) => p.title)).toEqual(['A', 'B']));
    expect(count('library_index')).toBe(2);

    unmount();
    await waitFor(() => expect(localEvents().count(LIBRARY_CHANGED_EVENT)).toBe(0));
    expect(localEvents().count(CHANGED)).toBe(0);
    await localEvents().emit(LIBRARY_CHANGED_EVENT, data);
    await localEvents().emit(CHANGED);
    expect(count('library_data')).toBe(2);
    expect(count('library_index')).toBe(2);
  });
});
