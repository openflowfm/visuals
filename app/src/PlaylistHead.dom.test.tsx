// @vitest-environment happy-dom
//
// The header over a playlist's strip on the home (decision 67), with the app's
// commands faked: what it shows, play and stop, shuffle, how it plays in a
// popover, and rename and delete from the "···" menu.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaylistHead } from './PlaylistHead.tsx';
import { EMPTY_DECK, manual, type Deck, type Lists, type Playlist } from './playlists.ts';
import { say } from './words.ts';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args), convertFileSrc: (p: string) => p }));
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => {}) }));

const item = (k: string) => ({ path: `/p/${k}.milk`, name: k, group: 'A', missing: false, hash: k });
const other = manual('o', 'Other', []);
const chill = manual('c', 'Chill', ['a', 'b', 'c'].map(item));

/** The commands sent, by name, with their arguments. */
const sent = (name: string) => invoke.mock.calls.filter(([cmd]) => cmd === name).map(([, args]) => args as Record<string, unknown>);

let onDeleted = vi.fn();

function Harness({ deck }: { deck: Deck }) {
  const [lists, setLists] = useState<Lists>({ playlists: [other, chill], deck });
  const list = lists.playlists.find((p) => p.id === chill.id) as Playlist;
  return <PlaylistHead list={list} lists={lists} tiles={[]} total={list.items.length} onLists={setLists} onDeleted={onDeleted} onError={() => () => {}} />;
}

async function mount(deck: Deck = EMPTY_DECK) {
  render(<Harness deck={deck} />);
  await act(async () => {});
}
const flush = () => act(async () => {});

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
  onDeleted = vi.fn();
});
afterEach(cleanup);

describe('the playlist head', () => {
  it('shows what it is, its name and how it plays', async () => {
    await mount();
    expect(screen.getByRole('heading', { level: 1, name: 'Chill' })).toBeTruthy();
    expect(screen.getByText('Playlist')).toBeTruthy();
    expect(screen.getByText('3 presets · moves on every 30 s · in order · crossfade 2 s')).toBeTruthy();
  });

  it('plays the playlist, and stops it while it plays', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: '▶ play' }));
    await flush();
    expect(sent('act')).toEqual([{ action: { kind: 'load', playlist: 1, index: null } }]);
    cleanup();
    invoke.mockClear();
    await mount({ ...EMPTY_DECK, playlist: chill.id, index: 0, count: 3 });
    expect(screen.getByText(/· playing 1 of 3$/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '■ stop' }));
    await flush();
    expect(sent('act')).toEqual([{ action: { kind: 'unload' } }]);
  });

  it('shuffles the playlist and keeps it', async () => {
    await mount();
    const shuffle = screen.getByRole('button', { name: 'shuffle' });
    expect(shuffle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(shuffle);
    await flush();
    const [args] = sent('playlist_settings');
    expect(args.id).toBe(chill.id);
    expect((args.settings as { order: string }).order).toBe('shuffle');
    expect(screen.getByRole('button', { name: 'shuffle' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('opens how it plays in a popover, and Esc closes it', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: say('playlist settings') }));
    const dialog = screen.getByRole('dialog', { name: say('playlist settings') });
    expect(within(dialog).getByRole('group', { name: 'how it plays' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renames from the more menu', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'more' }));
    fireEvent.click(within(screen.getByRole('menu', { name: 'more' })).getByRole('menuitem', { name: 'rename' }));
    const box = screen.getByRole('textbox', { name: 'playlist name' });
    fireEvent.change(box, { target: { value: 'Calm' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await flush();
    expect(sent('playlist_rename')).toEqual([{ id: chill.id, name: 'Calm' }]);
  });

  it('deletes from the more menu, after asking', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'more' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'delete…' }));
    expect(sent('playlist_delete')).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'delete Chill?' }));
    await flush();
    expect(onDeleted).toHaveBeenCalledOnce();
    expect(sent('playlist_delete')).toEqual([{ id: chill.id }]);
  });
});
