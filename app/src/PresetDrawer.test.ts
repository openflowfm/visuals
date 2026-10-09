import { describe, expect, it } from 'vitest';
import type { LibraryRow, Mine } from './api.ts';
import { manual, type Playlist } from './playlists.ts';
import { prepareRow } from './librarySearch.ts';
import { flipFor, hiddenCount, inPlaylistsSays, playlistsWith, selectedSays, tagCounts } from './PresetDrawer.tsx';

const row = (key: string): LibraryRow => ({ key, path: `/p/${key}`, hash: '', style: 'A', sub_style: null, authors: [], title: key, thumbnail: null, look: null, starter: false });
const p = (key: string, mine?: Mine) => prepareRow(row(key), mine);

describe('tagCounts', () => {
  it('counts each tag over the selection, the commonest first', () => {
    const chosen = [p('a', { tags: ['warm', 'peak'] }), p('b', { tags: ['peak'] }), p('c')];
    expect(tagCounts(chosen)).toEqual([
      { tag: 'peak', count: 2 },
      { tag: 'warm', count: 1 },
    ]);
    expect(tagCounts([])).toEqual([]);
  });
});

describe('selection hidden by the filter', () => {
  it('counts the chosen the filter keeps out, and says so', () => {
    expect(hiddenCount([p('a'), p('b'), p('c')], [p('b')])).toBe(2);
    expect(selectedSays(3, 2)).toBe('3 selected, 2 hidden by the filter');
    expect(selectedSays(3, 0)).toBe('3 selected');
  });
});

describe('flipFor', () => {
  it('turns on for all unless every one already has it', () => {
    const star = (x: { star: boolean }) => x.star;
    expect(flipFor([p('a', { star: true }), p('b')], star)).toBe(true);
    expect(flipFor([p('a', { star: true }), p('b', { star: true })], star)).toBe(false);
  });
});

describe('playlistsWith', () => {
  const list = (id: string, paths: string[]): Playlist =>
    manual(
      id,
      `list ${id}`,
      paths.map((path) => ({ path, name: '', group: '', missing: false, hash: null })),
    );

  it('names each playlist holding the preset once', () => {
    const lists = [list('1', ['/p/a', '/p/a']), list('2', ['/p/b']), list('3', ['/p/a'])];
    expect(playlistsWith('/p/a', lists)).toEqual(['list 1', 'list 3']);
    expect(playlistsWith('/p/z', lists)).toEqual([]);
  });

  it('says so in plain words', () => {
    expect(inPlaylistsSays(null)).toBe('in playlists: …');
    expect(inPlaylistsSays([])).toBe('in no playlists');
    expect(inPlaylistsSays(['Warm up', 'Peak'])).toBe('in playlists: Warm up, Peak');
  });
});
