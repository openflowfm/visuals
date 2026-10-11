// @vitest-environment happy-dom
//
// The home's shell (HomeLayout) mounted in a DOM with the app's real
// stylesheets: nothing paints under the hero's picture, the native preview's
// hole, in any of the window's shapes (home-model.ts's `modesFor`); a panel
// laid over the main column paints near-opaque glass; Escape and a press
// outside put it away; focus goes into it when it opens and back when it goes;
// the parts come in the order a screen reader walks them, and only the grid or
// pane under the pinned hero scrolls.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Header, Preview } from '../views.tsx';
import { Hero } from './Hero.tsx';
import { modesFor, type InspectorMode, type LayoutPrefs, type SidebarMode } from './home-model.ts';
import { HomeLayout, INSPECTOR_ID, SIDEBAR_ID } from './HomeLayout.tsx';
import { TransportBar } from './TransportBar.tsx';

/** What the app's commands answer: the bar's meter and audio input, the frame rate, nothing else. */
const answer = (cmd: string): unknown => (cmd === 'levels' ? [0, 0] : cmd === 'stats' ? { fps: 60, cpu_ms: 1 } : ['audio_sources', 'inputs'].includes(cmd) ? [] : null);
vi.mock('@tauri-apps/api/core', () => ({ invoke: (cmd: string) => Promise.resolve(answer(cmd)), convertFileSrc: (p: string) => p }));
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => {}) }));
// The preview's placement asks the engine every frame; here it is only a box, drawing.
vi.mock('../preview.ts', () => ({ usePreview: () => true }));

/** A stylesheet from app/src, read from disk: vitest hands a test empty CSS for an import, even `?raw`. */
const css = (file: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', file), 'utf8');
const SHEETS = ['app.css', 'home.css', 'chrome.css', 'layout/layout.css', 'layout/inspector.css', 'layout/hero.css', 'layout/transport-bar.css'];

const setViewport = (width: number) => (window as unknown as { happyDOM: { setViewport(v: { width: number; height: number }): void } }).happyDOM.setViewport({ width, height: 900 });

let style: HTMLStyleElement | null = null;
function useSheets(sheets: string[]) {
  style = document.createElement('style');
  style.textContent = sheets.join('\n');
  document.head.append(style);
}

beforeEach(() => setViewport(1440));
afterEach(() => {
  cleanup();
  style?.remove();
  style = null;
});

interface WindowProps {
  sidebarMode: SidebarMode;
  inspectorMode: InspectorMode;
  onDismiss?(): void;
  pane?: ReactNode;
}

/** The window as Home composes it: the preview in the hero, the transport in the bar, a toggle naming the inspector. */
function Window({ sidebarMode, inspectorMode, onDismiss, pane }: WindowProps) {
  return (
    <HomeLayout
      sidebar={<button type="button">Library</button>}
      header={
        <Header view="home" onChange={() => {}} lead={<button type="button" aria-label="sidebar" aria-controls={SIDEBAR_ID} />}>
          <span className="vf-fill" />
          <button type="button" aria-label="details" aria-controls={INSPECTOR_ID} />
        </Header>
      }
      hero={<Hero picture={<Preview className="hero-pic" />} />}
      bar={
        <TransportBar
          playing
          onPlayPause={() => {}}
          onStep={() => {}}
          stepIn=""
          position={{ elapsed: 12, length: 30 }}
          onAudioError={() => {}}
          now={{ name: 'Flexi - mindblob', from: 'from Warm-up · 3 of 10' }}
        />
      }
      inspector={inspectorMode ? <button type="button">Play it</button> : undefined}
      sidebarMode={sidebarMode}
      inspectorMode={inspectorMode}
      onDismiss={onDismiss}
      pane={pane}
    >
      <div className="grid-stand-in" role="listbox" aria-label="presets" />
    </HomeLayout>
  );
}

// happy-dom lays nothing out, so where things land is read from the rules: the
// root's cells each set their grid column, and a panel laid over the column is
// positioned absolutely over it.
const paints = (el: Element) => {
  const bg = getComputedStyle(el).backgroundColor;
  return !!bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'none';
};
const label = (el: Element) => `${el.tagName.toLowerCase()}.${el.className}`;
/** A grid-column as the lines it spans, counting a negative line from the end of `columns` columns. */
function span(v: string, columns: number): [number, number] {
  const line = (n: number) => (n < 0 ? columns + 2 + n : n);
  const [a, b] = v.split('/').map((s) => s.trim());
  const start = line(Number(a) || 1);
  const end = b === undefined || b === '' || b === 'auto' ? start + 1 : line(Number(b));
  return [start, end];
}
const meet = (a: [number, number], b: [number, number]) => a[0] < b[1] && b[0] < a[1];
const alpha = (colour: string) => Number(colour.match(/rgba\([^)]*,\s*([\d.]+)\)/)?.[1] ?? 1);

/** Whatever paints under the hole: the hole, what holds it, the column's bars over its shadow, and the root's other cells where they meet it. */
function paintedUnder(hole: Element): string[] {
  const painted: string[] = [];
  if (paints(hole)) painted.push(`${label(hole)} (the hole)`);
  for (let el = hole.parentElement; el; el = el.parentElement) if (paints(el)) painted.push(`${label(el)} (holds it)`);
  for (const bar of document.querySelectorAll('.lay-head, .lay-head > *, .lay-main, .lay-bar, .lay-bar > *')) if (paints(bar)) painted.push(`${label(bar)} (over its shadow)`);
  const root = document.querySelector('.app.home.lay')!;
  const columns = getComputedStyle(root).gridTemplateColumns.split(/\s+(?![^(]*\))/).length;
  const col = root.querySelector(':scope > .lay-col')!;
  const at = span(getComputedStyle(col).gridColumn, columns);
  for (const cell of root.querySelectorAll(':scope > .lay-cell')) {
    const s = getComputedStyle(cell);
    if (s.position === 'absolute') {
      // Laid over the column: the cell itself paints nothing, its panel near-opaque glass.
      if (paints(cell)) painted.push(`${label(cell)} (laid over it)`);
      const panel = cell.firstElementChild!;
      const glass = getComputedStyle(root).getPropertyValue('--surface-float').trim();
      if (getComputedStyle(panel).backgroundColor !== glass || alpha(glass) < 0.8) painted.push(`${label(panel)} (laid over it, not glass)`);
    } else if (cell.getAttribute('data-mode') === 'overlay') painted.push(`${label(cell)} (meant to be laid over it, but in the grid)`);
    else if (meet(span(s.gridColumn, columns), at)) painted.push(`${label(cell)} (shares its cell)`);
  }
  return painted;
}

const hole = () => screen.getByRole('img', { name: 'preview of the playing preset' });

describe('the hero’s picture, the native preview’s hole', () => {
  it.each([
    [1440, { sidebar: null, inspector: false }, 'docked', null],
    [1440, { sidebar: null, inspector: true }, 'docked', 'docked'],
    [1100, { sidebar: null, inspector: true }, 'docked', 'overlay'],
    [800, { sidebar: true, inspector: true }, 'overlay', 'overlay'],
    [800, { sidebar: null, inspector: null }, 'hidden', null],
  ] as const)('has nothing painted under it at %ipx, %o', (width, prefs, sidebar, inspector) => {
    setViewport(width);
    const modes = modesFor(width, prefs as LayoutPrefs);
    expect(modes).toEqual({ sidebar, inspector });
    useSheets(SHEETS.map(css));
    render(<Window sidebarMode={modes.sidebar} inspectorMode={modes.inspector} />);
    expect(hole().classList).toContain('hero-pic');
    expect(paintedUnder(hole())).toEqual([]);
    // Its spread shadow paints the main column instead.
    expect(getComputedStyle(hole()).boxShadow).toContain('100vmax');
  });

  it('would catch the root painting under it (the check itself)', () => {
    const layout = css('layout/layout.css');
    const painting = layout.replace(/(\.app\.home\.lay \{[^}]*?)background: none;/, '$1background: var(--surface-0);');
    expect(painting).not.toBe(layout);
    useSheets(SHEETS.map((f) => (f === 'layout/layout.css' ? painting : css(f))));
    render(<Window sidebarMode="docked" inspectorMode={null} />);
    expect(paintedUnder(hole())).toContain('div.app home lay (holds it)');
  });

  it('would catch a docked inspector in the column’s place (the check itself)', () => {
    const insp = css('layout/inspector.css').replace(/grid-column: -2;/, 'grid-column: 2;');
    useSheets(SHEETS.map((f) => (f === 'layout/inspector.css' ? insp : css(f))));
    render(<Window sidebarMode="docked" inspectorMode="docked" />);
    expect(paintedUnder(hole())).toContain('div.lay-cell lay-insp-cell (shares its cell)');
  });
});

describe('the shell', () => {
  it('walks sidebar, header, hero, grid, bar, inspector, and scrolls only the grid', () => {
    useSheets(SHEETS.map(css));
    render(<Window sidebarMode="docked" inspectorMode="docked" />);
    const order = [
      screen.getByRole('navigation', { name: 'sources' }),
      screen.getByRole('banner'),
      screen.getByRole('region', { name: 'now playing' }),
      screen.getByRole('listbox', { name: 'presets' }),
      screen.getByRole('region', { name: 'transport' }),
      screen.getByRole('complementary', { name: 'about the preset' }),
    ];
    for (let i = 1; i < order.length; i++) expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const main = screen.getByRole('main');
    expect(main.contains(screen.getByRole('listbox', { name: 'presets' }))).toBe(true);
    expect(main.contains(hole())).toBe(false);
    const scrolls = [...document.querySelectorAll('.app.home.lay *')].filter((el) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowY));
    expect(scrolls.filter((el) => !el.closest('.lay-cell'))).toEqual([main]);
  });

  it('puts a pane in the grid’s place, under the hero, filling the column and scrolling itself', () => {
    useSheets(SHEETS.map(css));
    render(<Window sidebarMode="docked" inspectorMode={null} pane={<section aria-label="Warm-up" />} />);
    const main = screen.getByRole('main');
    expect(main.contains(screen.getByRole('region', { name: 'Warm-up' }))).toBe(true);
    expect(screen.queryByRole('listbox', { name: 'presets' })).toBeNull();
    expect(screen.getByRole('region', { name: 'now playing' })).toBeTruthy();
    // The column doesn't scroll or pad it: the pane does both, lining up with the hero.
    expect(getComputedStyle(main).overflowY).toBe('hidden');
    expect(getComputedStyle(main).paddingLeft).toBe('0px');
    expect(getComputedStyle(screen.getByRole('region', { name: 'Warm-up' })).minHeight).toBe('0');
  });

  it('leaves out a hidden sidebar and a closed inspector', () => {
    render(<Window sidebarMode="hidden" inspectorMode={null} />);
    expect(screen.queryByRole('navigation', { name: 'sources' })).toBeNull();
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(document.querySelector('.app.home.lay')!.getAttribute('data-sidebar')).toBe('hidden');
  });

  it('makes the sidebar’s top band and the header row the title bar, and nothing else', () => {
    render(<Window sidebarMode="docked" inspectorMode={null} />);
    const drags = [...document.querySelectorAll('[data-tauri-drag-region]')].map((el) => el.className);
    expect(drags).toEqual(['lay-side-band', 'lay-head', 'vf-header']);
  });
});

describe('the hero’s size cap', () => {
  it('keeps the main column’s height in --lay-col-h, which caps the picture alone at half of it', () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return new DOMRect(0, 0, 1184, this.classList.contains('lay-col') ? 900 : 0);
    });
    try {
      useSheets(SHEETS.map(css));
      render(<Window sidebarMode="docked" inspectorMode={null} />);
      const col = document.querySelector<HTMLElement>('.lay-col')!;
      expect(col.style.getPropertyValue('--lay-col-h')).toBe('900px');
      // The picture alone is marked so, and its cap is half that height (its centring and size: the Hero and HomeLayout stories, in Chromium).
      const hero = document.querySelector<HTMLElement>('.hero')!;
      expect(hero.hasAttribute('data-only')).toBe(true);
      expect(getComputedStyle(hero).getPropertyValue('--hero-cap').replace(/\s+/g, ' ').trim()).toBe('calc(900px / 2)');
      expect(document.querySelector('.hero-info')).toBeNull();
    } finally {
      rect.mockRestore();
    }
  });

  it('leaves the fallback until the column is laid out', () => {
    render(<Window sidebarMode="docked" inspectorMode={null} />);
    expect(document.querySelector<HTMLElement>('.lay-col')!.style.getPropertyValue('--lay-col-h')).toBe('');
  });
});

describe('a panel laid over the main column', () => {
  it('goes on Escape and on a press outside it, but not on a press inside it or on its toggle', () => {
    const onDismiss = vi.fn();
    render(<Window sidebarMode="overlay" inspectorMode="overlay" onDismiss={onDismiss} />);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Play it' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Library' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'details' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'sidebar' }));
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByRole('listbox', { name: 'presets' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Play it' }), { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it('leaves Escape to whatever inside handled it first', () => {
    const onDismiss = vi.fn();
    render(<Window sidebarMode="docked" inspectorMode="overlay" onDismiss={onDismiss} />);
    const inside = screen.getByRole('button', { name: 'Play it' });
    inside.addEventListener('keydown', (e) => e.preventDefault());
    fireEvent.keyDown(inside, { key: 'Escape' });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('is nothing to dismiss when docked', () => {
    const onDismiss = vi.fn();
    render(<Window sidebarMode="docked" inspectorMode="docked" onDismiss={onDismiss} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.pointerDown(screen.getByRole('listbox', { name: 'presets' }));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('takes focus when it opens and gives it back when it goes', () => {
    const { rerender } = render(<Window sidebarMode="docked" inspectorMode={null} />);
    const toggle = screen.getByRole('button', { name: 'details' });
    toggle.focus();
    rerender(<Window sidebarMode="docked" inspectorMode="overlay" />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Play it' }));
    rerender(<Window sidebarMode="docked" inspectorMode={null} />);
    expect(document.activeElement).toBe(toggle);

    // The sidebar laid over a narrow window, the same.
    const side = screen.getByRole('button', { name: 'sidebar' });
    rerender(<Window sidebarMode="hidden" inspectorMode={null} />);
    side.focus();
    rerender(<Window sidebarMode="overlay" inspectorMode={null} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Library' }));
    rerender(<Window sidebarMode="hidden" inspectorMode={null} />);
    expect(document.activeElement).toBe(side);
  });

  it('keeps focus where it is when a docked panel turns into one (the window narrowing), and docking again', () => {
    const { rerender } = render(<Window sidebarMode="docked" inspectorMode="docked" />);
    const grid = screen.getByRole('listbox', { name: 'presets' });
    grid.tabIndex = 0;
    grid.focus();
    rerender(<Window sidebarMode="docked" inspectorMode="overlay" />);
    expect(document.activeElement).toBe(grid);
    const inside = screen.getByRole('button', { name: 'Play it' });
    inside.focus();
    rerender(<Window sidebarMode="docked" inspectorMode="docked" />);
    expect(document.activeElement).toBe(inside);
  });
});
