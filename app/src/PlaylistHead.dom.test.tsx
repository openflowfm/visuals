// @vitest-environment happy-dom
//
// The header over a playlist's strip on the home (decision 67), with the app's
// commands faked: what it shows, play and stop, shuffle, how it plays in a
// popover, and rename and delete from the "···" menu.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

function Harness({ deck, variant }: { deck: Deck; variant?: 'pane' | 'inspector' }) {
  const [lists, setLists] = useState<Lists>({ playlists: [other, chill], deck });
  const list = lists.playlists.find((p) => p.id === chill.id) as Playlist;
  return <PlaylistHead list={list} lists={lists} tiles={[]} total={list.items.length} onLists={setLists} onDeleted={onDeleted} onError={() => () => {}} variant={variant} />;
}

async function mount(deck: Deck = EMPTY_DECK, variant?: 'pane' | 'inspector') {
  render(<Harness deck={deck} variant={variant} />);
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

  it('is the pane’s title over its actions as type, with no fill and no boxes (decision 68)', async () => {
    const style = document.createElement('style');
    // Read from disk: vitest hands a test empty CSS for an import, even `?raw`.
    style.textContent = ['playlisthead.css', 'popover.css'].map((f) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), f), 'utf8')).join('\n');
    document.head.append(style);
    try {
      await mount();
      const head = screen.getByRole('banner');
      expect(['', 'none', 'transparent', 'rgba(0, 0, 0, 0)']).toContain(getComputedStyle(head).backgroundColor);
      expect(getComputedStyle(screen.getByRole('heading', { level: 1, name: 'Chill' })).fontSize).toBe('20px');
      expect(screen.getByRole('button', { name: say('playlist settings') }).textContent).toBe('How it plays ▾');
      for (const name of ['▶ Play', 'Shuffle', say('playlist settings')]) {
        const b = getComputedStyle(screen.getByRole('button', { name }));
        // happy-dom reads `border: 0` back as "initial".
        expect(['', 'none', 'initial']).toContain(b.borderTopStyle);
        expect(['', 'none', 'transparent', 'rgba(0, 0, 0, 0)']).toContain(b.backgroundColor);
      }
    } finally {
      style.remove();
    }
  });

  it('plays the playlist, and stops it while it plays', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: '▶ Play' }));
    await flush();
    expect(sent('act')).toEqual([{ action: { kind: 'load', playlist: 1, index: null } }]);
    cleanup();
    invoke.mockClear();
    await mount({ ...EMPTY_DECK, playlist: chill.id, index: 0, count: 3 });
    expect(screen.getByText(/· playing 1 of 3$/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '■ Stop' }));
    await flush();
    expect(sent('act')).toEqual([{ action: { kind: 'unload' } }]);
  });

  it('shuffles the playlist and keeps it', async () => {
    await mount();
    const shuffle = screen.getByRole('button', { name: 'Shuffle' });
    expect(shuffle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(shuffle);
    await flush();
    const [args] = sent('playlist_settings');
    expect(args.id).toBe(chill.id);
    expect((args.settings as { order: string }).order).toBe('shuffle');
    expect(screen.getByRole('button', { name: 'Shuffle' }).getAttribute('aria-pressed')).toBe('true');
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
    fireEvent.click(within(screen.getByRole('menu', { name: 'more' })).getByRole('menuitem', { name: 'Rename' }));
    const box = screen.getByRole('textbox', { name: 'playlist name' });
    fireEvent.change(box, { target: { value: 'Calm' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await flush();
    expect(sent('playlist_rename')).toEqual([{ id: chill.id, name: 'Calm' }]);
  });

  it('deletes from the more menu, after asking', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'more' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }));
    expect(sent('playlist_delete')).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Chill?' }));
    await flush();
    expect(onDeleted).toHaveBeenCalledOnce();
    expect(sent('playlist_delete')).toEqual([{ id: chill.id }]);
  });

  it('in the pane, the name is the h1 and the menus hang from the left', async () => {
    await mount();
    expect(screen.getByRole('banner').getAttribute('data-variant')).toBe('pane');
    fireEvent.click(screen.getByRole('button', { name: 'more' }));
    expect(screen.getByRole('menu', { name: 'more' }).getAttribute('data-align')).toBe('left');
  });
});

describe('the playlist head in the inspector', () => {
  it('is a card: the name an h2 under the cover, how it plays, and the same actions', async () => {
    await mount(EMPTY_DECK, 'inspector');
    const head = document.querySelector('.pl-head')!;
    expect(head.getAttribute('data-variant')).toBe('inspector');
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Chill' })).toBeTruthy();
    expect(head.firstElementChild?.className).toBe('pl-cover');
    expect(screen.getByText('3 presets · moves on every 30 s · in order · crossfade 2 s')).toBeTruthy();
    for (const name of ['▶ Play', 'Shuffle', say('playlist settings'), 'more']) expect(screen.getByRole('button', { name })).toBeTruthy();
  });

  it('lays the card out down the panel, from playlisthead.css', async () => {
    const style = document.createElement('style');
    style.textContent = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'playlisthead.css'), 'utf8');
    document.head.append(style);
    try {
      await mount(EMPTY_DECK, 'inspector');
      const head = document.querySelector<HTMLElement>('.pl-head')!;
      expect(getComputedStyle(head).flexDirection).toBe('column');
      expect(getComputedStyle(head.querySelector('.pl-cover')!).width).toBe('100%');
      expect(getComputedStyle(screen.getByRole('heading', { level: 2, name: 'Chill' })).fontSize).toBe('22px');
    } finally {
      style.remove();
    }
  });

  it('plays, shuffles, opens how it plays, and hangs ⋯ from the right', async () => {
    await mount(EMPTY_DECK, 'inspector');
    fireEvent.click(screen.getByRole('button', { name: '▶ Play' }));
    await flush();
    expect(sent('act')).toEqual([{ action: { kind: 'load', playlist: 1, index: null } }]);
    fireEvent.click(screen.getByRole('button', { name: 'Shuffle' }));
    await flush();
    expect((sent('playlist_settings')[0].settings as { order: string }).order).toBe('shuffle');
    fireEvent.click(screen.getByRole('button', { name: say('playlist settings') }));
    const dialog = screen.getByRole('dialog', { name: say('playlist settings') });
    expect(within(dialog).getByRole('group', { name: 'how it plays' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'more' }));
    expect(screen.getByRole('menu', { name: 'more' }).getAttribute('data-align')).toBe('right');
  });

  it('renames from the more menu, and Esc in the box ends the rename without reaching the window', async () => {
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    try {
      await mount(EMPTY_DECK, 'inspector');
      fireEvent.click(screen.getByRole('button', { name: 'more' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
      let box = screen.getByRole('textbox', { name: 'playlist name' });
      fireEvent.keyDown(box, { key: 'Escape' });
      expect(screen.queryByRole('textbox', { name: 'playlist name' })).toBeNull();
      expect(onWindowKey.mock.calls.filter(([e]) => (e as KeyboardEvent).key === 'Escape')).toEqual([]);
      fireEvent.doubleClick(screen.getByRole('heading', { level: 2, name: 'Chill' }));
      box = screen.getByRole('textbox', { name: 'playlist name' });
      fireEvent.change(box, { target: { value: 'Calm' } });
      fireEvent.keyDown(box, { key: 'Enter' });
      await flush();
      expect(sent('playlist_rename')).toEqual([{ id: chill.id, name: 'Calm' }]);
    } finally {
      window.removeEventListener('keydown', onWindowKey);
    }
  });

  it('deletes after asking, and Esc keeps it without reaching the window', async () => {
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    try {
      await mount(EMPTY_DECK, 'inspector');
      fireEvent.click(screen.getByRole('button', { name: 'more' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }));
      fireEvent.keyDown(screen.getByRole('button', { name: 'Delete Chill?' }), { key: 'Escape' });
      expect(screen.queryByRole('button', { name: 'Delete Chill?' })).toBeNull();
      expect(onWindowKey.mock.calls.filter(([e]) => (e as KeyboardEvent).key === 'Escape')).toEqual([]);
      fireEvent.click(screen.getByRole('button', { name: 'more' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete Chill?' }));
      await flush();
      expect(onDeleted).toHaveBeenCalledOnce();
      expect(sent('playlist_delete')).toEqual([{ id: chill.id }]);
    } finally {
      window.removeEventListener('keydown', onWindowKey);
    }
  });
});
