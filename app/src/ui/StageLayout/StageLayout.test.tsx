// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { assemble, principlesFor, type Placement } from '@satoramoto/zen';
import { packs } from '@satoramoto/zen';
import { StageLayout, stageSpec } from './StageLayout';

// Live's Stage assembled under the visuals pack's principles: which forms the header and the
// controls take, from their needs alone (docs/assembly.md). No crate: the column is the window.
const pack = packs.find((p) => p.id === 'visuals')!;
const P = principlesFor(pack.facets, pack.principles);

const forms = (p: Placement) => Object.fromEntries(Object.values(p.regions).map((r) => [r.id, r.form]));

/** The Stage at a size (where its regions land is zen's to test; their forms are the app's). */
const stage = (w: number, h: number) => assemble(stageSpec(), { w, h }, P);

describe('the Stage assembles itself', () => {
  it('has no crate', () => {
    const p = stage(1440, 900);
    expect(Object.keys(p.regions).sort()).toEqual(['dock', 'head']);
  });

  it('1440 × 900: the header and the controls at full', () => {
    expect(forms(stage(1440, 900))).toMatchObject({ head: 'full', dock: 'full' });
  });

  it('1000 × 700: the header full, the controls stacked (Effects its glyph alone)', () => {
    expect(forms(stage(1000, 700))).toMatchObject({ head: 'full', dock: 'stacked' });
  });
  it('560 × 800: the header short, the controls stacked', () => {
    expect(forms(stage(560, 800))).toMatchObject({ head: 'short', dock: 'stacked' });
  });

  it('the controls step from full to stacked once, at about 1060px (their 996 and 32px either side)', () => {
    const dockAt = (w: number) => assemble(stageSpec(), { w, h: 900 }, P).regions.dock.form;
    let from = 0;
    for (let w = 1400; w >= 560; w--) if (dockAt(w) === 'full') from = w;
    expect(from).toBeGreaterThanOrEqual(1050);
    expect(from).toBeLessThanOrEqual(1070);
    for (let w = from; w <= 1400; w += 10) expect(dockAt(w)).toBe('full');
    expect(dockAt(from - 1)).toBe('stacked');
  });
});

// The panels' slots (warning owed, so the native preview isn't mounted: nothing reaches the app).
describe('the Stage’s panels', () => {
  const stageWith = (panel: boolean, side: boolean) =>
    render(<StageLayout warning inWindow head={<p>head</p>} dock={<p>dock</p>} panel={panel ? <aside aria-label="Effects" /> : null} side={side ? <aside aria-label="Library map" /> : null} />)
      .container;

  it('puts the effects panel and the map in their slots in the overlay, and says each is there', () => {
    const c = stageWith(true, true);
    const root = c.querySelector('.vs-stagelayout')!;
    expect(root).toHaveAttribute('data-panel');
    expect(root).toHaveAttribute('data-side');
    const reveal = c.querySelector('.vs-stagelayout-reveal')!;
    const panel = reveal.querySelector('.vs-stagelayout-panel')!;
    const side = reveal.querySelector('.vs-stagelayout-side')!;
    expect(panel.querySelector('[aria-label="Effects"]')).not.toBeNull();
    expect(side.querySelector('[aria-label="Library map"]')).not.toBeNull();
  });

  it('makes both panels inert while the warning is owed', () => {
    const c = stageWith(true, true);
    expect(c.querySelector('.vs-stagelayout-panel')).toHaveAttribute('inert');
    expect(c.querySelector('.vs-stagelayout-side')).toHaveAttribute('inert');
  });

  it('says data-side only while the map is there, and draws no empty slot', () => {
    const c = stageWith(true, false);
    expect(c.querySelector('.vs-stagelayout')).not.toHaveAttribute('data-side');
    expect(c.querySelector('.vs-stagelayout-side')).toBeNull();
    const m = stageWith(false, true);
    expect(m.querySelector('.vs-stagelayout')).toHaveAttribute('data-side');
    expect(m.querySelector('.vs-stagelayout')).not.toHaveAttribute('data-panel');
    expect(m.querySelector('.vs-stagelayout-panel')).toBeNull();
  });
});
