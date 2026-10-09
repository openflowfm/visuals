import { afterEach, describe, expect, it, vi } from 'vitest';
import { homeFor, openSheet, SHEET_EVENT, sheetOf, viewsFor, type Sheet } from './views.tsx';

describe('viewsFor', () => {
  it('offers the library and live, and the editor only in a lab build', () => {
    expect(viewsFor(false, false)).toEqual(['library', 'live']);
    expect(viewsFor(true, false)).toEqual(['library', 'editor', 'live']);
  });

  it('puts the home first once it is ready', () => {
    expect(viewsFor(false, true)).toEqual(['home', 'library', 'live']);
    expect(viewsFor(true, true)).toEqual(['home', 'library', 'editor', 'live']);
  });
});

describe('homeFor', () => {
  it('starts a lab build in the editor, whether or not the home is ready', () => {
    expect(homeFor(true, false)).toBe('editor');
    expect(homeFor(true, true)).toBe('editor');
  });

  it('starts in the home once it is ready, else the library', () => {
    expect(homeFor(false, true)).toBe('home');
    expect(homeFor(false, false)).toBe('library');
  });
});

describe('the sheets', () => {
  // `openSheet` dispatches on `window`, which the node test environment doesn't have.
  afterEach(() => vi.unstubAllGlobals());

  it('reach whoever listens for them, saying which sheet', () => {
    vi.stubGlobal('window', new EventTarget());
    const heard: (Sheet | null)[] = [];
    window.addEventListener(SHEET_EVENT, (e) => heard.push(sheetOf(e)));
    openSheet('settings');
    openSheet('effects');
    expect(heard).toEqual(['settings', 'effects']);
  });

  it('ignore an event that names no sheet', () => {
    expect(sheetOf(new CustomEvent(SHEET_EVENT, { detail: 'nope' }))).toBeNull();
    expect(sheetOf(new Event(SHEET_EVENT))).toBeNull();
  });
});
