// @vitest-environment happy-dom
//
// The home's now playing panel (decision 67): the preset playing, its name,
// folder and where it plays from; star, never play and + playlist; my tags; a
// selection of several at once; and, since the engine's view shows through the
// preview, nothing painted behind it.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryRow, Mine } from './api.ts';
import { prepareRow } from './librarySearch.ts';
import { NowPanel, type NowPanelProps } from './NowPanel.tsx';
import { manual, type Playlist } from './playlists.ts';

// The preview's placement asks the engine every frame; here it is only a box.
vi.mock('./preview.ts', () => ({ usePreview: () => true }));

const row = (key: string, extra: Partial<LibraryRow> = {}): LibraryRow => ({
  key,
  path: `/p/${key}.milk`,
  hash: key,
  style: 'Geiss',
  sub_style: null,
  authors: ['geiss'],
  title: key,
  thumbnail: null,
  look: null,
  starter: false,
  ...extra,
});
const item = (r: LibraryRow) => ({ path: r.path, name: r.title, group: r.style, missing: false, hash: r.hash });

const A = row('RadioActive Lightsticks 1');
const B = row('Firesticks');
const SMART: Playlist = { ...manual('s', 'Calm', []), kind: 'smart', query: { groups: {}, text: '' } };
const PLAYLISTS: Playlist[] = [manual('1', 'Chill', [item(A)]), manual('2', 'Warm up', []), SMART];

function mount(over: Partial<NowPanelProps> = {}, mine: Mine | undefined = { tags: ['warm'] }) {
  const props: NowPanelProps = {
    chosen: [prepareRow(A, mine)],
    current: { path: A.path, name: A.title, group: A.style },
    from: 'from the library',
    playlists: PLAYLISTS,
    onSet: vi.fn(),
    onAddTo: vi.fn(),
    onClose: vi.fn(),
    error: null,
    ...over,
  };
  render(<NowPanel {...props} />);
  return props;
}

afterEach(cleanup);

describe('NowPanel', () => {
  it('shows the name, the folder and where it plays from, and what it is', () => {
    mount();
    expect(screen.getByRole('heading', { name: A.title })).toBeTruthy();
    expect(screen.getByText('Geiss · from the library')).toBeTruthy();
    expect(screen.getByText('in').nextElementSibling?.textContent).toBe('Chill');
    expect(screen.getByText('author').nextElementSibling?.textContent).toBe('geiss');
  });

  it('stars and never plays the preset', () => {
    const p = mount();
    fireEvent.click(screen.getByRole('button', { name: 'star' }));
    expect(p.onSet).toHaveBeenLastCalledWith([A.key], { star: true });
    fireEvent.click(screen.getByRole('button', { name: 'never play' }));
    expect(p.onSet).toHaveBeenLastCalledWith([A.key], { hidden: true });
  });

  it('adds to a manual playlist only', () => {
    const p = mount();
    fireEvent.click(screen.getByRole('button', { name: 'add to a playlist' }));
    const menu = screen.getByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((b) => b.textContent),
    ).toEqual(['Chill', 'Warm up']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Warm up' }));
    expect(p.onAddTo).toHaveBeenCalledWith('2', [A.path]);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('adds tags with + tag and Enter, and takes one off', () => {
    const p = mount();
    fireEvent.click(screen.getByRole('button', { name: '+ tag' }));
    const box = screen.getByRole('textbox', { name: 'add tags' });
    fireEvent.change(box, { target: { value: 'Intro, dark' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(p.onSet).toHaveBeenLastCalledWith([A.key], { add_tags: ['intro', 'dark'] });
    fireEvent.click(screen.getByRole('button', { name: 'take the tag warm off' }));
    expect(p.onSet).toHaveBeenLastCalledWith([A.key], { remove_tags: ['warm'] });
  });

  it('cancels a tag with Esc', () => {
    const p = mount();
    fireEvent.click(screen.getByRole('button', { name: '+ tag' }));
    const box = screen.getByRole('textbox', { name: 'add tags' });
    fireEvent.change(box, { target: { value: 'intro' } });
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(p.onSet).not.toHaveBeenCalled();
  });

  it('works on several at once', () => {
    const p = mount({ chosen: [prepareRow(A, { tags: ['warm'] }), prepareRow(B, undefined)] });
    expect(screen.getByRole('heading', { name: '2 selected' })).toBeTruthy();
    expect(screen.queryByText('author')).toBeNull();
    expect(screen.getByTitle('on 1 of 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'star' }));
    expect(p.onSet).toHaveBeenLastCalledWith([A.key, B.key], { star: true });
  });

  it('says nothing plays yet, with its buttons off', () => {
    mount({ chosen: [], current: null });
    expect(screen.getByText('nothing playing yet')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'star' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'add to a playlist' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('img', { name: 'preview of the playing preset' })).toBeTruthy();
  });

  it('closes with ✕', () => {
    const p = mount();
    fireEvent.click(screen.getByRole('button', { name: 'close now playing' }));
    expect(p.onClose).toHaveBeenCalled();
  });

  it('paints nothing behind the preview', () => {
    const style = document.createElement('style');
    // Read from disk: vitest hands a test empty CSS for an import, even `?raw`.
    const theme = ':root { --bg: rgb(1, 1, 1); --panel: rgb(2, 2, 2); --rail: rgb(3, 3, 3); }';
    style.textContent = [theme, ...['app.css', 'nowpanel.css'].map((f) => readFileSync(new URL(f, import.meta.url), 'utf8'))].join('\n');
    document.head.append(style);
    try {
      mount();
      const preview = screen.getByRole('img', { name: 'preview of the playing preset' });
      const painted: string[] = [];
      for (let el: Element | null = preview; el; el = el.parentElement) {
        const bg = getComputedStyle(el).backgroundColor;
        if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') painted.push(`${el.tagName.toLowerCase()}.${el.className}: ${bg}`);
      }
      expect(painted).toEqual([]);
      // The panel's colour is the preview's own shadow, clipped by the panel.
      expect(getComputedStyle(preview).boxShadow).toContain('100vmax');
      expect(getComputedStyle(screen.getByRole('region', { name: 'now playing' })).overflow).toBe('hidden');
    } finally {
      style.remove();
    }
  });
});
