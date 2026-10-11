// @vitest-environment happy-dom
//
// Live's Stage shell (StageLayout) mounted in a DOM with the app's real
// stylesheets: the picture, the native preview's hole, is the whole window in
// every shape (crate docked, laid over, put away; the panels hidden; playing
// in the window) and nothing paints under it; the panels over it paint an
// opaque surface; a laid-over crate goes on Escape or a press outside it; the
// panels hidden leave only the picture and the hint; the warning owed darkens
// the window and makes the controls inert.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crateModeFor, panelsAtStart, STAGE_CRATE_ID, togglePanels, type Panels } from './stage-model.ts';
import { PANELS_HINT, StageLayout } from './StageLayout.tsx';

vi.mock('@tauri-apps/api/core', () => ({ invoke: () => Promise.resolve(null), convertFileSrc: (p: string) => p }));
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => {}) }));
// The preview's placement asks the engine every frame; here it is only a box, drawing.
vi.mock('../preview.ts', () => ({ usePreview: () => true }));

/** A stylesheet from app/src, read from disk: vitest hands a test empty CSS for an import. */
const css = (file: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', file), 'utf8');
const SHEETS = ['app.css', 'home.css', 'chrome.css', 'layout/layout.css', 'live/stage.css'];

let style: HTMLStyleElement | null = null;
function useSheets(sheets: string[]) {
  style = document.createElement('style');
  style.textContent = sheets.join('\n');
  document.head.append(style);
}

afterEach(() => {
  cleanup();
  style?.remove();
  style = null;
});

interface StageProps {
  width?: number;
  panels?: Panels;
  warning?: boolean;
  inWindow?: boolean;
  centre?: ReactNode;
  onCrateAway?(): void;
}

/** The Stage as Live composes it, the parts stand-ins: a toggle naming the crate in the header. */
function Stage({ width = 1440, panels = panelsAtStart(null), warning = false, inWindow = false, centre, onCrateAway = () => {} }: StageProps) {
  return (
    <StageLayout
      width={width}
      panels={panels}
      warning={warning}
      inWindow={inWindow}
      crate={<button type="button">Warm-up</button>}
      head={
        <div className="capsule">
          <button type="button" aria-label="crate toggle" aria-controls={STAGE_CRATE_ID} />
        </div>
      }
      dock={<button type="button">Hold</button>}
      centre={centre}
      onCrateAway={onCrateAway}
    >
      <p>notice</p>
    </StageLayout>
  );
}

const paints = (el: Element) => {
  const bg = getComputedStyle(el).backgroundColor;
  return !!bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'none';
};
const label = (el: Element) => `${el.tagName.toLowerCase()}.${el.className}`;
const alpha = (colour: string) => Number(colour.match(/rgba\([^)]*,\s*([\d.]+)\)/)?.[1] ?? 1);

/** Whatever paints under the hole: the hole itself and everything holding it. */
function paintedUnder(hole: Element): string[] {
  const painted: string[] = [];
  if (paints(hole)) painted.push(`${label(hole)} (the hole)`);
  for (let el = hole.parentElement; el; el = el.parentElement) if (paints(el)) painted.push(`${label(el)} (holds it)`);
  return painted;
}

/** The hole's box, as its rules set it: the whole window means absolute at 0 on every side, in a root the window's height. */
function box(hole: Element) {
  const s = getComputedStyle(hole);
  return { position: s.position, top: s.top, right: s.right, bottom: s.bottom, left: s.left };
}
const WHOLE = { position: 'absolute', top: '0px', right: '0px', bottom: '0px', left: '0px' };

/** The panels over the picture that aren't opaque --surface-corner, or that blur (it never reaches the native view). */
function seeThrough(): string[] {
  const root = document.querySelector('.stage')!;
  const solid = getComputedStyle(root).getPropertyValue('--surface-corner').trim();
  const bad: string[] = [];
  if (!/^#[0-9a-f]{6}$|^rgb\(/i.test(solid) || alpha(solid) < 1) bad.push(`--surface-corner (${solid})`);
  for (const panel of document.querySelectorAll('.stage-crate, .stage-dock')) {
    const s = getComputedStyle(panel);
    if (s.backgroundColor !== solid) bad.push(`${label(panel)} (${s.backgroundColor})`);
    const blur = s.backdropFilter || s.getPropertyValue('-webkit-backdrop-filter');
    if (blur && blur !== 'none') bad.push(`${label(panel)} blurs`);
  }
  return bad;
}

const hole = () => screen.getByRole('img', { name: 'preview of the playing preset' });
const root = () => document.querySelector('.stage')!;

describe('the picture, the native preview’s hole', () => {
  it.each([
    ['wide, crate docked', { width: 1440, panels: panelsAtStart(null) }, 'docked'],
    ['at the dock width', { width: 1100, panels: panelsAtStart(null) }, 'docked'],
    ['narrow, crate laid over', { width: 800, panels: panelsAtStart(true) }, 'overlay'],
    ['narrow, crate put away', { width: 800, panels: panelsAtStart(null) }, 'hidden'],
    ['wide, crate put away', { width: 1440, panels: panelsAtStart(false) }, 'hidden'],
    ['panels hidden', { width: 1440, panels: togglePanels(panelsAtStart(true)) }, 'hidden'],
    ['in the window', { width: 1440, panels: panelsAtStart(null), inWindow: true, centre: <button type="button">Go full screen</button> }, 'docked'],
  ] as const)('is the whole window, nothing painted under it: %s', (_, props, crate) => {
    useSheets(SHEETS.map(css));
    render(<Stage {...props} />);
    expect(root().getAttribute('data-crate')).toBe(crate);
    expect(box(hole())).toEqual(WHOLE);
    expect(getComputedStyle(root()).height).toBe('100%');
    expect(paintedUnder(hole())).toEqual([]);
    expect(seeThrough()).toEqual([]);
    // Nothing between the root and the hole: it is the window's, not a cell's.
    expect(hole().parentElement).toBe(root());
  });

  it('would catch the root painting under it (the check itself)', () => {
    const stage = css('live/stage.css');
    const painting = stage.replace(/(\.app\.home\.lay\.stage \{[^}]*?)background: none;/, '$1background: var(--surface-0);');
    expect(painting).not.toBe(stage);
    useSheets(SHEETS.map((f) => (f === 'live/stage.css' ? painting : css(f))));
    render(<Stage />);
    expect(paintedUnder(hole())).toContain('div.app home lay stage (holds it)');
  });

  it('would catch a docked crate pushing the picture aside (the check itself)', () => {
    const stage = css('live/stage.css');
    const aside = `${stage}\n.app.home.lay.stage[data-crate='docked'] > .stage-picture { left: var(--stage-crate); }`;
    useSheets(SHEETS.map((f) => (f === 'live/stage.css' ? aside : css(f))));
    render(<Stage />);
    expect(box(hole())).not.toEqual(WHOLE);
  });

  it('would catch a translucent panel (the check itself)', () => {
    const stage = css('live/stage.css').replace('--stage-panel: var(--surface-corner);', '--stage-panel: var(--surface-2);');
    useSheets(SHEETS.map((f) => (f === 'live/stage.css' ? stage : css(f))));
    render(<Stage />);
    expect(seeThrough().length).toBeGreaterThan(0);
  });
});

describe('the crate', () => {
  it('docks wide: the header and the dock keep clear of it, and Escape is left to live', () => {
    useSheets(SHEETS.map(css));
    const away = vi.fn();
    render(<Stage onCrateAway={away} />);
    const nav = screen.getByRole('navigation', { name: 'crate' });
    expect(nav.id).toBe(STAGE_CRATE_ID);
    expect(nav.textContent).toBe('Warm-up');
    expect(getComputedStyle(document.querySelector('.stage-head')!).left).not.toBe('0px');
    expect(getComputedStyle(document.querySelector('.stage-dock')!).left).not.toBe(getComputedStyle(document.querySelector('.stage-crate-cell')!).left);
    const esc = fireEvent.keyDown(window, { key: 'Escape' });
    expect(esc).toBe(true);
    fireEvent.pointerDown(hole());
    expect(away).not.toHaveBeenCalled();
  });

  it('laid over: focus goes into it, and Escape (taken) or a press outside puts it away; a press in it or on its toggle doesn’t', () => {
    useSheets(SHEETS.map(css));
    const away = vi.fn();
    const { rerender } = render(<Stage width={800} panels={panelsAtStart(false)} onCrateAway={away} />);
    expect(screen.queryByRole('navigation', { name: 'crate' })).toBeNull();
    rerender(<Stage width={800} panels={panelsAtStart(true)} onCrateAway={away} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Warm-up' }));
    expect(getComputedStyle(document.querySelector('.stage-crate-cell')!).zIndex).toBe('10');

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Warm-up' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'crate toggle' }));
    expect(away).not.toHaveBeenCalled();

    fireEvent.pointerDown(hole());
    expect(away).toHaveBeenCalledTimes(1);
    // Taken: live's own Esc (leave, or show the panels) sees it prevented.
    expect(fireEvent.keyDown(window, { key: 'Escape' })).toBe(false);
    expect(away).toHaveBeenCalledTimes(2);
  });

  it('starts put away in a narrow window', () => {
    expect(crateModeFor(800, null)).toBe('hidden');
    render(<Stage width={800} />);
    expect(screen.queryByRole('navigation', { name: 'crate' })).toBeNull();
  });
});

describe('the panels', () => {
  it('shown: the header, the dock and the crate over the picture, the title bar a drag region clear of the window buttons', () => {
    useSheets(SHEETS.map(css));
    render(<Stage width={800} />);
    const head = document.querySelector('.stage-head')!;
    expect(head.hasAttribute('data-tauri-drag-region')).toBe(true);
    expect(head.contains(screen.getByRole('button', { name: 'crate toggle' }))).toBe(true);
    // The window buttons end at x 76 (24 + 3 × 12 + 2 × 8): the capsules start past them.
    expect(parseFloat(getComputedStyle(head).paddingLeft)).toBeGreaterThanOrEqual(76);
    expect(screen.getByRole('region', { name: 'Live controls' }).textContent).toBe('Hold');
    expect(screen.getByText('notice')).toBeTruthy();
  });

  it('hidden: only the picture, the hint that \\ brings them back, and what is laid over everything', () => {
    useSheets(SHEETS.map(css));
    render(<Stage panels={togglePanels(panelsAtStart(true))} centre={<button type="button">Go full screen</button>} />);
    expect(hole()).toBeTruthy();
    expect(root().getAttribute('data-panels')).toBe('hidden');
    expect(screen.queryByRole('navigation', { name: 'crate' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Live controls' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'crate toggle' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Go full screen' })).toBeNull();
    expect(screen.getByText(PANELS_HINT, { exact: false }).textContent).toBe(`\\ ${PANELS_HINT}`);
    // Still a title bar to drag the window by.
    expect(document.querySelector('.stage-head')!.hasAttribute('data-tauri-drag-region')).toBe(true);
    expect(screen.getByText('notice')).toBeTruthy();
  });

  it('in the window: the offer over the picture, under the header', () => {
    useSheets(SHEETS.map(css));
    render(<Stage inWindow centre={<button type="button">Go full screen</button>} />);
    expect(root().hasAttribute('data-windowed')).toBe(true);
    const offer = screen.getByRole('button', { name: 'Go full screen' });
    expect(offer.parentElement!.getAttribute('data-for')).toBe('offer');
  });
});

describe('the warning owed', () => {
  it('darkens the window, the preview not mounted, the crate and the dock inert, the warning centred', () => {
    useSheets(SHEETS.map(css));
    render(<Stage warning centre={<div role="alertdialog" aria-label="flashing lights" />} />);
    expect(screen.queryByRole('img', { name: 'preview of the playing preset' })).toBeNull();
    expect(paints(document.querySelector('.stage-dark')!)).toBe(true);
    expect(document.querySelector('.stage-crate-cell')!.hasAttribute('inert')).toBe(true);
    expect(document.querySelector('.stage-dock')!.hasAttribute('inert')).toBe(true);
    expect(screen.getByRole('alertdialog', { name: 'flashing lights' }).parentElement!.getAttribute('data-for')).toBe('warning');
  });

  it('shows even with the panels hidden', () => {
    render(<Stage warning panels={togglePanels(panelsAtStart(null))} centre={<div role="alertdialog" aria-label="flashing lights" />} />);
    expect(screen.getByRole('alertdialog', { name: 'flashing lights' })).toBeTruthy();
  });
});
