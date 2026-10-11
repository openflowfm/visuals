import { describe, expect, it } from 'vitest';
import type * as pl from '../playlists.ts';
import { nextName, nextWhenText } from './live-model.ts';
import { crateModeFor, escapeDoes, panelsAtStart, STAGE_DOCK_AT, toggleCrate, togglePanels } from './stage-model.ts';

describe("the Stage's crate", () => {
  it('docks from STAGE_DOCK_AT and starts put away below it', () => {
    expect(crateModeFor(STAGE_DOCK_AT, null)).toBe('docked');
    expect(crateModeFor(STAGE_DOCK_AT - 1, null)).toBe('hidden');
  });

  it("follows the viewer's choice: shown is laid over in a narrow window, put away is put away at any width", () => {
    expect(crateModeFor(1440, true)).toBe('docked');
    expect(crateModeFor(800, true)).toBe('overlay');
    expect(crateModeFor(1440, false)).toBe('hidden');
    expect(crateModeFor(800, false)).toBe('hidden');
  });

  it('toggles from what shows at the width', () => {
    const wide = panelsAtStart(null);
    expect(crateModeFor(1440, toggleCrate(wide, 1440).crate)).toBe('hidden');
    expect(crateModeFor(800, toggleCrate(wide, 800).crate)).toBe('overlay');
  });
});

describe("the Stage's panels", () => {
  it('start shown; \\ hides them and shows them again', () => {
    const p = panelsAtStart(true);
    expect(p).toEqual({ shown: true, crate: true });
    expect(togglePanels(p).shown).toBe(false);
    expect(togglePanels(togglePanels(p))).toEqual(p);
  });

  it('take Esc to show themselves when hidden, and leave live only when shown', () => {
    expect(escapeDoes(panelsAtStart(null))).toBe('leave');
    expect(escapeDoes(togglePanels(panelsAtStart(null)))).toBe('show');
  });
});

describe('the Next line', () => {
  const deck = { auto: true, seconds: 19.6 } as pl.Deck;

  it('says when on the beat first, else every n seconds while it moves on by itself, else nothing', () => {
    expect(nextWhenText(null, deck, 0)).toBe('every 20 s');
    expect(nextWhenText(null, { ...deck, auto: false }, 0)).toBeNull();
    expect(nextWhenText(null, null, 0)).toBeNull();
  });

  it('names the next item, or says quietly why nothing is next', () => {
    expect(nextName({ kind: 'held' })).toMatchObject({ quiet: true });
    expect(nextName({ kind: 'item', item: { name: 'Warm', path: '/w.milk', missing: true } } as pl.NextSays)).toEqual({ text: 'Warm', quiet: false, missing: true });
    expect(nextName({ kind: 'library' } as pl.NextSays)).toEqual({ text: 'the next preset in the library', quiet: true });
  });
});
