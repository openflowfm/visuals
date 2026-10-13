// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { assemble, principlesFor, type Placement } from '@satoramoto/zen';
import { packs } from '@satoramoto/zen';
import { modesFor } from '../model/home-model';
import { HomeLayout, homeDocks, homeSpec } from './HomeLayout';

// Home assembled under the visuals pack's own principles (roomy scale, frost materials): which
// regions dock and which form each takes, from their needs alone (docs/assembly.md). Where they
// land and how big they are is zen's to test; the forms are the app's decisions.
const pack = packs.find((p) => p.id === 'visuals')!;
const P = principlesFor(pack.facets, pack.principles);

const forms = (p: Placement) => Object.fromEntries(Object.values(p.regions).map((r) => [r.id, r.form]));

describe('Home takes its forms at the original sizes', () => {
  const at = (w: number, h: number) => assemble(homeSpec(), { w, h }, P);

  it('1440 × 900: both panels docked, everything at its richest', () => {
    expect(forms(at(1440, 900))).toEqual({ sidebar: 'docked', header: 'full', hero: 'full', pane: 'wide', inspector: 'docked' });
  });

  it('1100 × 800: the sidebar docked, the inspector laid over, the tiles small (as under the original 1100)', () => {
    expect(forms(at(1100, 800))).toMatchObject({ sidebar: 'docked', inspector: 'overlaid', header: 'full', hero: 'full', pane: 'small' });
  });

  it('900 × 700: the sidebar still docks (from 900), the inspector laid over; the hero keeps its full form', () => {
    expect(forms(at(900, 700))).toMatchObject({ sidebar: 'docked', inspector: 'overlaid', header: 'full', hero: 'full', pane: 'small' });
  });

  it('560 × 800: both panels laid over, the header narrow', () => {
    expect(forms(at(560, 800))).toMatchObject({ sidebar: 'overlaid', inspector: 'overlaid', header: 'narrow', hero: 'compact', pane: 'small' });
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

  // Home.css reads the slots' data-form (the pane's small or wide tiles), so the forms reach the page.
  it('puts each part in its slot, saying the form chosen', () => {
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
  });
});
