import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryData, LibraryRow } from './api.ts';
import { intensityOf, keyOf, openEffects, playsWindowed, ratingOf, starred, starsText, whenText } from './Live.tsx';
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

  it('plays in the window when asked to or with only one display', () => {
    const one = [{ id: 0, name: 'Built-in' }] as never[];
    const two = [
      { id: 0, name: 'Built-in' },
      { id: 1, name: 'Projector' },
    ] as never[];
    expect(playsWindowed(false, two)).toBe(false);
    expect(playsWindowed(true, two)).toBe(true);
    expect(playsWindowed(false, one)).toBe(true);
    expect(playsWindowed(false, [])).toBe(true);
    // Displays unknown: the old behaviour, the output opens.
    expect(playsWindowed(false, null)).toBe(false);
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
});
