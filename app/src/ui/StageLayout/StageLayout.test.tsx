// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { assemble, principlesFor, type Placement } from '@satoramoto/zen';
import { packs } from '@satoramoto/zen';
import { stageSpec } from './StageLayout';

// Live's Stage assembled under the visuals pack's principles: which forms the header and the
// controls take, from their needs alone (docs/assembly.md). No crate: the column is the window.
const pack = packs.find((p) => p.id === 'visuals')!;
const P = principlesFor(pack.facets, pack.principles);

const forms = (p: Placement) => Object.fromEntries(Object.values(p.regions).map((r) => [r.id, r.form]));

/** The Stage at a size, fitting it: no zoom, no overflow, every region inside the window. */
function stage(w: number, h: number) {
  const room = { w, h };
  const p = assemble(stageSpec(), room, P);
  expect(p.zoom).toBe(1);
  expect(p.overflow).toBe(false);
  for (const { rect: r } of Object.values(p.regions)) {
    expect(r.x + r.w).toBeLessThanOrEqual(room.w + 0.5);
    expect(r.y + r.h).toBeLessThanOrEqual(room.h + 0.5);
  }
  return p;
}

describe('the Stage assembles itself', () => {
  it('has no crate', () => {
    const p = stage(1440, 900);
    expect(Object.keys(p.regions).sort()).toEqual(['dock', 'head']);
  });

  it('1440 × 900: the header and the controls at full, the controls the whole width under the header', () => {
    const p = stage(1440, 900);
    expect(forms(p)).toMatchObject({ head: 'full', dock: 'full' });
    expect(p.regions.dock.rect).toMatchObject({ x: 0, w: 1440 });
    expect(p.regions.head.rect.h).toBe(52);
    // The controls fill the picture under the header: the transport's name at their top, the rows at their foot.
    expect(p.regions.dock.rect.h).toBeGreaterThan(780);
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
