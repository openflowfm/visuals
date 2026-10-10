// @vitest-environment happy-dom
//
// The home's source list mounted in a DOM, with the app's commands faked: its
// order (the library, starred and recently played, then the playlists, then the
// smart playlists), its counts, picking and playing rows, making a playlist, and
// the narrow window's source menu.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, EMPTY_DECK, manual, type Lists, type Playlist } from './playlists.ts';
import { paneName, Sidebar, SourceMenu, type SidebarProps } from './Sources.tsx';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args), convertFileSrc: (p: string) => p }));
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => {}) }));

const item = (k: string) => ({ path: `/p/${k}.milk`, name: k, group: 'A', missing: false, hash: k });
const smart = (id: string, name: string, recent?: number): Playlist => ({
  id,
  name,
  items: [],
  kind: 'smart',
  query: { groups: {}, text: '', ...(recent === undefined ? {} : { recent }) },
  settings: DEFAULT_SETTINGS,
});

const chill = manual('chill', 'Chill', [item('a'), item('b')]);
const warm = manual('warm', 'Warm up', []);
const calm = smart('calm', 'Calm');
const recent = smart('recent', 'Recently played', 50);
const lists: Lists = { playlists: [chill, calm, recent, warm], deck: EMPTY_DECK };

function props(over: Partial<SidebarProps> = {}): SidebarProps {
  return {
    lists,
    shown: { kind: 'library' },
    counts: { library: 9795, starred: 42, list: (p) => (p.kind === 'manual' ? p.items.length : p.id === 'calm' ? 318 : null) },
    onPick: vi.fn(),
    onLists: vi.fn(),
    onImport: vi.fn(),
    onError: () => () => {},
    ...over,
  };
}

const rows = () => screen.getAllByRole('listitem');
const sent = (name: string) => invoke.mock.calls.filter(([cmd]) => cmd === name).map(([, args]) => args as Record<string, unknown>);

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation((cmd: string) => Promise.resolve(cmd === 'playlist_create' ? { playlists: [...lists.playlists, manual('new', 'playlist 5', [])], deck: EMPTY_DECK } : null));
});
afterEach(cleanup);

describe('the source list', () => {
  it('lists the library, starred and recently played, then the playlists, then the smart playlists', () => {
    render(<Sidebar {...props()} />);
    const names = rows().map((r) => r.querySelector('.src-name')?.textContent ?? r.textContent);
    expect(names).toEqual(['Library', 'Starred', 'Recently played', 'Chill', 'Warm up', 'Calm']);
    expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual(['Playlists', 'Smart playlists']);
  });

  it('shows the counts, and nothing for one unknown', () => {
    render(<Sidebar {...props()} />);
    const [library, starred, recently, mine, , smartOne] = rows();
    expect(library.querySelector('i')?.textContent).toBe('9,795');
    expect(starred.querySelector('i')?.textContent).toBe('42');
    expect(recently.querySelector('i')).toBeNull();
    expect(mine.querySelector('i')?.textContent).toBe('2');
    expect(smartOne.querySelector('i')?.textContent).toBe('318');
  });

  it('picks a row on a click, and marks the one picked', () => {
    const p = props({ shown: { kind: 'list', id: 'chill' } });
    render(<Sidebar {...p} />);
    fireEvent.click(screen.getByText('Starred'));
    expect(p.onPick).toHaveBeenCalledWith({ kind: 'starred' });
    fireEvent.click(screen.getByText('Recently played'));
    expect(p.onPick).toHaveBeenCalledWith({ kind: 'list', id: 'recent' });
    expect(rows().filter((r) => r.getAttribute('aria-current') === 'true')).toEqual([screen.getByRole('listitem', { name: 'Chill, playlist, 2 presets' })]);
  });

  it('plays a playlist on a double-click, and from its icon', () => {
    render(<Sidebar {...props()} />);
    fireEvent.doubleClick(screen.getByRole('listitem', { name: 'Chill, playlist, 2 presets' }));
    expect(sent('act')).toEqual([{ action: { kind: 'load', playlist: 0, index: null } }]);
    expect(screen.getByRole('button', { name: 'Play Warm up' })).toHaveProperty('disabled', true);
  });

  it('marks the playlist playing with a green dot after its name, not by turning it green', () => {
    render(<Sidebar {...props({ lists: { ...lists, deck: { ...EMPTY_DECK, playlist: 'chill' } } })} />);
    const playing = screen.getByRole('listitem', { name: 'Chill, playlist, 2 presets, playing' });
    expect(playing.querySelector('.src-name')?.nextElementSibling?.className).toBe('src-dot');
    expect(document.querySelectorAll('.src-dot')).toHaveLength(1);
  });

  it('gives playlists ♪ and smart playlists ✦', () => {
    render(<Sidebar {...props()} />);
    const glyph = (name: string) => screen.getByRole('listitem', { name: new RegExp(`^${name},`) }).querySelector('.src-glyph')?.textContent;
    expect(glyph('Chill')).toBe('♪');
    expect(glyph('Calm')).toBe('✦');
  });

  it('names its sections in sentence case, with no caps, and draws no line or fill on the row picked', () => {
    const style = document.createElement('style');
    // Read from disk: vitest hands a test empty CSS for an import, even `?raw`.
    style.textContent = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'sources.css'), 'utf8');
    document.head.append(style);
    try {
      render(<Sidebar {...props({ shown: { kind: 'list', id: 'chill' } })} />);
      for (const h of screen.getAllByRole('heading')) expect(getComputedStyle(h).textTransform).not.toBe('uppercase');
      const picked = screen.getByRole('listitem', { name: 'Chill, playlist, 2 presets' });
      const look = getComputedStyle(picked);
      expect(look.fontWeight).toBe('600');
      expect(['', 'none']).toContain(look.boxShadow);
      expect(['', 'none', 'transparent', 'rgba(0, 0, 0, 0)']).toContain(look.backgroundColor);
    } finally {
      style.remove();
    }
  });

  it('makes a new playlist with + and picks it', async () => {
    const p = props();
    render(<Sidebar {...p} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'new playlist' })));
    expect(sent('playlist_create')).toEqual([{ name: 'playlist 5' }]);
    expect(p.onLists).toHaveBeenCalled();
    expect(p.onPick).toHaveBeenCalledWith({ kind: 'list', id: 'new' });
  });
});

describe('the source menu', () => {
  it('names the pane shown, and closes once a row is picked', () => {
    const p = props();
    render(<SourceMenu {...p} />);
    const button = screen.getByRole('button', { name: 'sources' });
    expect(button.textContent).toBe('Library ▾');
    fireEvent.click(button);
    const menu = screen.getByRole('dialog', { name: 'sources' });
    fireEvent.click(within(menu).getByText('Calm'));
    expect(p.onPick).toHaveBeenCalledWith({ kind: 'list', id: 'calm' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says what each pane is called', () => {
    expect(paneName(null, lists)).toBe('Library');
    expect(paneName({ kind: 'library' }, lists)).toBe('Library');
    expect(paneName({ kind: 'starred' }, lists)).toBe('Starred');
    expect(paneName({ kind: 'list', id: 'recent' }, lists)).toBe('Recently played');
    expect(paneName({ kind: 'list', id: 'chill' }, lists)).toBe('Chill');
  });
});
