// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { assemble, principlesFor, resolveLength, type Placement } from '@satoramoto/zen';
import { packs } from '@satoramoto/zen';
import { scales } from '@satoramoto/zen';
import { modesFor } from '../model/home-model';
import { HEAD_GAP, HomeLayout, homeDocks, homeSpec, TITLEBAR } from './HomeLayout';

// Home assembled under the visuals pack's own principles (roomy scale, frost materials): which
// regions dock at the original's sizes, from their needs alone (docs/assembly.md).
const pack = packs.find((p) => p.id === 'visuals')!;
const P = principlesFor(pack.facets, pack.principles);

const forms = (p: Placement) => Object.fromEntries(Object.values(p.regions).map((r) => [r.id, r.form]));

/** Every region inside the room, and none overlapping another. */
function fits(p: Placement, room: { w: number; h: number }) {
  expect(p.zoom).toBe(1);
  expect(p.overflow).toBe(false);
  const rects = Object.values(p.regions).map((r) => r.rect);
  for (const r of rects) {
    expect(r.x).toBeGreaterThanOrEqual(-0.5);
    expect(r.y).toBeGreaterThanOrEqual(-0.5);
    expect(r.x + r.w).toBeLessThanOrEqual(room.w + 0.5);
    expect(r.y + r.h).toBeLessThanOrEqual(room.h + 0.5);
  }
  for (const a of rects)
    for (const b of rects) {
      if (a === b || a.w === 0 || b.w === 0) continue;
      const apart = a.x + a.w <= b.x + 0.5 || b.x + b.w <= a.x + 0.5 || a.y + a.h <= b.y + 0.5 || b.y + b.h <= a.y + 0.5;
      expect(apart).toBe(true);
    }
}

describe('Home assembles itself at the original sizes', () => {
  const at = (w: number, h: number) => {
    const room = { w, h };
    const p = assemble(homeSpec(), room, P);
    fits(p, room);
    return p;
  };

  it('1440 × 900: both panels docked, everything at its richest', () => {
    const p = at(1440, 900);
    expect(forms(p)).toEqual({ sidebar: 'docked', header: 'full', hero: 'full', pane: 'wide', inspector: 'docked' });
    // No bar: the grid runs to the window's foot.
    expect(p.regions.pane.rect.y + p.regions.pane.rect.h).toBeCloseTo(900);
    // The sidebar's panel is 240px with its 8px inset; the inspector's 288 with its own.
    expect(p.regions.sidebar.rect.w).toBe(248);
    expect(p.regions.inspector.rect.w).toBe(296);
    // The hero at the original's cap, the grid taking the rest of the column's height.
    expect(p.regions.hero.rect.h).toBe(440);
    expect(p.regions.pane.rect.h).toBeGreaterThan(p.regions.hero.rect.h / 3);
  });

  it('1100 × 800: the sidebar docked, the inspector laid over, the tiles small (as under the original 1100)', () => {
    const p = at(1100, 800);
    expect(forms(p)).toMatchObject({ sidebar: 'docked', inspector: 'overlaid', header: 'full', hero: 'full', pane: 'small' });
    expect(p.regions.inspector.rect.w).toBe(0);
  });

  it('900 × 700: the sidebar still docks (from 900), the inspector laid over; with no bar and a tight header gap the hero keeps its full form', () => {
    const p = at(900, 700);
    expect(forms(p)).toMatchObject({ sidebar: 'docked', inspector: 'overlaid', header: 'full', hero: 'full', pane: 'small' });
  });

  it('560 × 800: both panels laid over, the header narrow', () => {
    const p = at(560, 800);
    expect(forms(p)).toMatchObject({ sidebar: 'overlaid', inspector: 'overlaid', header: 'narrow', hero: 'compact', pane: 'small' });
  });

  it('the docking widths come out of the needs: the sidebar from 900, the inspector from about 1200', () => {
    const docks = (w: number) => homeDocks({ w, h: 900 }, P);
    expect(docks(900).sidebar).toBe(true);
    expect(docks(899).sidebar).toBe(false);
    expect(docks(1100).inspector).toBe(false);
    // 248 + 296 + the hero's 588 + two 32px seams: 1196, four px short of the original's 1200.
    expect(docks(1195).inspector).toBe(false);
    expect(docks(1196).inspector).toBe(true);
    expect(docks(1200).inspector).toBe(true);
  });
});

describe('Home: the viewer’s choices over where the panels dock', () => {
  it('a docking pane shows unless hidden; one that can’t dock shows laid over only when opened', () => {
    const wide = homeDocks({ w: 1440, h: 900 }, P);
    const narrow = homeDocks({ w: 800, h: 900 }, P);
    expect(modesFor(wide, { sidebar: null, inspector: null })).toEqual({ sidebar: 'docked', inspector: 'docked' });
    expect(modesFor(wide, { sidebar: false, inspector: false })).toEqual({ sidebar: 'hidden', inspector: null });
    expect(modesFor(narrow, { sidebar: null, inspector: null })).toEqual({ sidebar: 'hidden', inspector: null });
    expect(modesFor(narrow, { sidebar: true, inspector: true })).toEqual({ sidebar: 'overlay', inspector: 'overlay' });
  });

  it('a hidden sidebar gives its room to the column: the richer forms come back', () => {
    const shown = assemble(homeSpec({ sidebar: 'docked', inspector: 'docked' }), { w: 1300, h: 900 }, P);
    const hidden = assemble(homeSpec({ sidebar: 'overlaid', inspector: 'docked' }), { w: 1300, h: 900 }, P);
    expect(shown.regions.pane.form).toBe('small');
    expect(hidden.regions.pane.form).toBe('wide');
  });
});

describe('Home: the title beside the window buttons', () => {
  const header = (w: number) => assemble(homeSpec({ sidebar: 'overlaid', inspector: 'overlaid' }), { w, h: 900 }, P).regions.header.form;

  it('with no sidebar docked the header holds the buttons’ room and the title, which folds before the header narrows', () => {
    expect(header(1440)).toBe('titled');
    expect(header(760)).toBe('full');
    expect(header(560)).toBe('narrow');
  });

  it('free to choose (the docking answer), the header needs neither: the docking widths stay', () => {
    expect(assemble(homeSpec(), { w: 1440, h: 900 }, P).regions.header.form).toBe('full');
  });
});

describe('HomeLayout on screen', () => {
  it('leaves the title to the native title bar: the band still drags the window, and neither it nor the header draws one', () => {
    for (const sidebarMode of ['docked', 'hidden'] as const) {
      const { container, unmount } = render(<HomeLayout sidebar={<p>side</p>} header={<p>head</p>} sidebarMode={sidebarMode} />);
      if (sidebarMode === 'docked') expect(container.querySelector('.vs-lay-side-band')).toHaveAttribute('data-tauri-drag-region');
      expect(container.querySelector('.vs-lay-title')).toBeNull();
      unmount();
    }
  });

  it('places each part in its slot, in the form the solver chose', () => {
    const { container } = render(
      <HomeLayout sidebar={<p>side</p>} header={<p>head</p>} hero={<p>hero</p>} inspector={<p>insp</p>} sidebarMode="docked" inspectorMode="overlay">
        <p>tiles</p>
      </HomeLayout>,
    );
    const slot = (id: string) => container.querySelector(`[data-region='${id}']`);
    expect(slot('sidebar')).toHaveAttribute('data-form', 'docked');
    expect(slot('inspector')).toHaveAttribute('data-form', 'overlaid');
    expect(slot('header')?.querySelector('.vs-lay-head')).not.toBeNull();
    expect(slot('pane')?.querySelector('main')).toHaveTextContent('tiles');
    // The inspector laid over is drawn from its empty slot, opaque.
    expect(slot('inspector')?.querySelector('.vs-lay-cell--overlay.lib-opaque')).not.toBeNull();
    // No grid of its own: the frame is the assembled screen.
    expect(container.querySelector('.lib-screen__grid')).toBeNull();
  });

  it('the grid scrolls under the pinned hero: its slot reaches up to the hero, above it', () => {
    const { container } = render(<HomeLayout sidebar={<p>side</p>} header={<p>head</p>} hero={<p>hero</p>} pane={<p>grid</p>} />);
    const pane = container.querySelector<HTMLElement>("[data-region='pane']")!;
    const hero = container.querySelector<HTMLElement>("[data-region='hero']")!;
    expect(pane).toHaveAttribute('data-under', 'hero');
    expect(pane.style.getPropertyValue('--lib-at-y')).toBe(hero.style.getPropertyValue('--lib-at-y'));
    expect(Number(pane.style.getPropertyValue('--lib-under'))).toBeGreaterThan(0);
    // After the hero in the DOM, so drawn over it.
    expect(hero.compareDocumentPosition(pane) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('no bar region: the grid reaches down behind nothing; with no hero, up behind nothing either', () => {
    const { container, unmount } = render(<HomeLayout sidebar={<p>side</p>} header={<p>head</p>} hero={<p>hero</p>} pane={<p>grid</p>} />);
    expect(container.querySelector("[data-region='bar']")).toBeNull();
    expect(container.querySelector("[data-region='pane']")).not.toHaveAttribute('data-over');
    unmount();
    const noHero = render(<HomeLayout sidebar={<p>side</p>} header={<p>head</p>} pane={<p>grid</p>} />);
    expect(noHero.container.querySelector("[data-region='pane']")).not.toHaveAttribute('data-under');
  });
});

describe('the column and the sidebar start their content on one line', () => {
  // HomeLayout.css's --vs-lay-content-top: the title bar and the tight gap under it (HEAD_GAP). The
  // sidebar's rows start there (the panel's padding); the hero must too, under every pack and scale, docked or not.
  it('the hero sits at TITLEBAR + HEAD_GAP from the window top, at every size, pack and scale', () => {
    for (const pk of packs)
      for (const scale of scales) {
        const p = principlesFor({ ...pk.facets, scale }, pk.principles);
        const line = resolveLength(TITLEBAR, p) + resolveLength(HEAD_GAP, p);
        expect(resolveLength(HEAD_GAP, p)).toBeLessThan(p.plate.gap + 1);
        for (const room of [
          { w: 1440, h: 900 },
          { w: 1100, h: 800 },
          { w: 700, h: 800 },
        ])
          for (const sidebar of ['either', 'overlaid'] as const) {
            const placed = assemble(homeSpec({ sidebar }), room, p);
            if (placed.zoom !== 1) continue;
            const { hero, sidebar: side } = placed.regions;
            expect(Math.abs(hero.rect.y - line), `${pk.id} ${scale.id} ${room.w}×${room.h} ${sidebar}`).toBeLessThanOrEqual(1);
            expect(side.rect.y).toBe(0);
          }
      }
  });
});
