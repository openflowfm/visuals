import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryData, LibraryRow } from './api.ts';
import { intensityOf, keyOf, openEffects, opensOnStart, padLabel, ratingOf, starred, starsText, whenText, whereSr, whereText } from './live/live-model.ts';
import * as pl from './playlists.ts';
import { openSettings } from './Status.tsx';
import { SHEET_EVENT, sheetOf } from './views.tsx';

afterEach(() => vi.unstubAllGlobals());

/** The sheets `f` asks the page to open, through `openSheet`'s window event. */
function sheetsOpenedBy(f: () => void) {
  const page = new EventTarget();
  vi.stubGlobal('window', page);
  const opened: (string | null)[] = [];
  page.addEventListener(SHEET_EVENT, (e) => opened.push(sheetOf(e)));
  f();
  return opened;
}

const row = (key: string, path: string) => ({ key, path }) as LibraryRow;
const data: LibraryData = { version: 1, presets: { 'a/x.milk': { star: true, rating: 3 }, 'a/y.milk': { tags: ['warm'] } } };

describe('live mode', () => {
  it('reads the Intensity slider back from the sensitivity fx::intensity set', () => {
    // fx::intensity: sensitivity = ½ · 4^v.
    for (const v of [0, 0.25, 0.5, 0.75, 1]) expect(intensityOf(0.5 * 4 ** v)).toBeCloseTo(v, 9);
    expect(intensityOf(1)).toBeCloseTo(0.5, 9);
    // Set elsewhere beyond the slider's range: pinned to its ends.
    expect(intensityOf(0.25)).toBe(0);
    expect(intensityOf(4)).toBe(1);
    expect(intensityOf(0)).toBe(0.5);
    expect(intensityOf(NaN)).toBe(0.5);
  });

  it("finds the playing preset's library key, its star and its rating", () => {
    const rows = [row('a/x.milk', '/p/a/x.milk'), row('a/y.milk', '/p/a/y.milk')];
    expect(keyOf(rows, '/p/a/x.milk')).toBe('a/x.milk');
    expect(keyOf(rows, '/elsewhere.milk')).toBeNull();
    expect(keyOf(rows, null)).toBeNull();
    expect(starred(data, 'a/x.milk')).toBe(true);
    expect(starred(data, 'a/y.milk')).toBe(false);
    expect(starred(null, 'a/x.milk')).toBe(false);
    expect(ratingOf(data, 'a/x.milk')).toBe(3);
    expect(ratingOf(data, 'a/y.milk')).toBeNull();
    expect(ratingOf(data, null)).toBeNull();
    expect(starsText(3)).toBe('★★★☆☆');
    expect(starsText(5)).toBe('★★★★★');
  });

  it('opens the output by itself only when started in live mode, with another display', () => {
    const one = [{ id: 0, name: 'Built-in' }] as never[];
    const two = [
      { id: 0, name: 'Built-in' },
      { id: 1, name: 'Projector' },
    ] as never[];
    // Going live from Home, or live-windowed: never.
    expect(opensOnStart(undefined, two)).toBe(false);
    expect(opensOnStart(true, two)).toBe(false);
    expect(opensOnStart(undefined, null)).toBe(false);
    // VISUALS_LIVE=1: with another display, or displays unknown.
    expect(opensOnStart(false, two)).toBe(true);
    expect(opensOnStart(false, null)).toBe(true);
    expect(opensOnStart(false, one)).toBe(false);
    expect(opensOnStart(false, [])).toBe(false);
  });

  it('opens the Settings sheet from ⚙ and the More effects sheet from its button', () => {
    expect(sheetsOpenedBy(openSettings)).toEqual(['settings']);
    expect(sheetsOpenedBy(openEffects)).toEqual(['effects']);
  });

  it('says when the next preset comes in whole beats', () => {
    expect(whenText(null)).toBeNull();
    expect(whenText(Infinity)).toBeNull();
    expect(whenText(0.2)).toBe('in 1 beat');
    expect(whenText(1)).toBe('in 1 beat');
    expect(whenText(7.4)).toBe('in 8 beats');
    expect(whenText(8)).toBe('in 8 beats');
  });

  it("says where the next preset comes from in the Next line's tooltip, not on screen", () => {
    const list = pl.manual('m', 'Chill', []);
    expect(whereText({ playlist: list, index: 0, next: null, nextIndex: null, count: 20 }, null)).toBe('From Chill, 1 of 20');
    expect(whereText({ playlist: list, index: null, next: null, nextIndex: null, count: 20 }, null)).toBe('From Chill');
    expect(whereText(null, { ...pl.EMPTY_DECK, query: { groups: { tags: ['dark', 'warm'] }, text: '' } })).toBe('From the mood dark + warm');
    expect(whereText(null, null)).toMatch(/^From the whole library/);
    // Following the library grid's filter is "the library", never a mood.
    expect(whereText(null, { ...pl.EMPTY_DECK, query: { groups: { style: ['fractal'] }, text: '' } })).toBe('From the library');
    expect(whereText(null, { ...pl.EMPTY_DECK, query: { groups: { tags: ['dark'] }, text: 'tunnel' } })).toBe('From the library');
  });

  it('reads where the next preset comes from to screen readers, after its name', () => {
    const list = pl.manual('m', 'Chill', []);
    expect(whereSr({ playlist: list, index: 2, next: null, nextIndex: null, count: 20 }, null)).toBe(', from Chill, 3 of 20');
    expect(whereSr(null, null)).toMatch(/^, from the whole library/);
  });
});

describe("live mode's controls, to VoiceOver", () => {
  it('names a control in words, with its keys', () => {
    expect(padLabel('previous')).toBe('Previous (← ↑)');
    expect(padLabel('step')).toBe('Next (→ ↓)');
    expect(padLabel('strobe')).toBe('Strobe (hold S, ⇧S latches)');
  });
});
