import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { homeFor, openSheet, Preview, SHEET_EVENT, sheetOf, viewsFor, type Sheet } from './views.tsx';

describe('Preview', () => {
  it('is a picture with a name, for a screen reader', () => {
    const html = renderToStaticMarkup(createElement(Preview, { className: 'home-preview' }));
    expect(html).toMatch(/^<div class="home-preview" role="img" aria-label="preview of the playing preset/);
  });

  it('says it is loading in its name, since a picture hides what is inside it from a screen reader', () => {
    const html = renderToStaticMarkup(createElement(Preview, { className: 'home-preview' }));
    expect(html).toContain('aria-label="preview of the playing preset: Loading the display…"');
    expect(html).toMatch(/<span class="bench-loading" aria-hidden="true">Loading the display…<\/span>/);
    expect(html).not.toContain('role="status"');
  });
});

describe('viewsFor', () => {
  it('offers the home and live, with no library view of its own', () => {
    expect(viewsFor(false)).toEqual(['home', 'live']);
  });

  it('offers the editor between them only in a lab build', () => {
    expect(viewsFor(true)).toEqual(['home', 'editor', 'live']);
  });
});

describe('homeFor', () => {
  it('starts a lab build in the editor, and the app in the home', () => {
    expect(homeFor(true)).toBe('editor');
    expect(homeFor(false)).toBe('home');
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
