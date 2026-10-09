import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { FxAction } from './fx.ts';
import { HelpOverlay } from './HelpOverlay.tsx';
import { liveKeys, modalOpen, type KeyLike } from './liveKeys.ts';
import { MoreEffects } from './MoreEffects.tsx';
import { Settings } from './Settings.tsx';
import type { Action } from './playlists.ts';

type Sent = Action | FxAction | 'editor' | 'favourite' | 'help' | { rate: number };

function setup(sheet = { open: false }) {
  const sent: Sent[] = [];
  const keys = liveKeys({
    sheetOpen: () => sheet.open,
    editor: () => sent.push('editor'),
    act: (a) => sent.push(a),
    fx: (a) => sent.push(a),
    rate: (stars) => sent.push({ rate: stars }),
    favourite: () => sent.push('favourite'),
    help: () => sent.push('help'),
  });
  let prevented = 0;
  const press = (key: string, more: Partial<KeyLike> = {}) =>
    keys.keydown({ key, metaKey: false, shiftKey: false, ctrlKey: false, altKey: false, repeat: false, target: null, preventDefault: () => prevented++, ...more });
  return { sent, keys, press, prevented: () => prevented };
}

describe('liveKeys', () => {
  it('steps with the arrows and R', () => {
    const { sent, press, prevented } = setup();
    press('ArrowRight');
    press('ArrowDown');
    press('ArrowLeft');
    press('ArrowUp');
    press('R');
    expect(sent).toEqual([{ kind: 'next' }, { kind: 'next' }, { kind: 'previous' }, { kind: 'previous' }, { kind: 'random' }]);
    expect(prevented()).toBe(5);
  });

  it('goes to the editor on ⌘⇧L, and leaves other modified keys alone', () => {
    const { sent, press, prevented } = setup();
    press('L', { metaKey: true, shiftKey: true });
    press('r', { metaKey: true });
    press('s', { ctrlKey: true });
    press('ArrowRight', { altKey: true });
    press('3', { metaKey: true });
    press('f', { ctrlKey: true });
    press('?', { altKey: true, shiftKey: true });
    expect(sent).toEqual(['editor']);
    expect(prevented()).toBe(1);
  });

  it('ignores keys typed into a field', () => {
    const { sent, press } = setup();
    const field = { target: { closest: () => ({}) } as unknown as EventTarget };
    press('r', field);
    press('Escape', field);
    press('3', field);
    press('f', field);
    press('l', field);
    press('?', { ...field, shiftKey: true });
    expect(sent).toEqual([]);
  });

  it('goes to the editor on Esc, unless modified or already taken by a menu', () => {
    const { sent, press, prevented } = setup();
    press('Escape', { metaKey: true });
    press('Escape', { altKey: true });
    press('Escape', { defaultPrevented: true });
    expect(sent).toEqual([]);
    press('Escape');
    expect(sent).toEqual(['editor']);
    expect(prevented()).toBe(1);
  });

  it('leaves Esc to a sheet open over live mode (⚙ Settings, More effects), and leaves again once it is closed', () => {
    const sheet = { open: true };
    const { sent, press, prevented } = setup(sheet);
    press('Escape');
    expect(sent).toEqual([]);
    expect(prevented()).toBe(0);
    sheet.open = false;
    press('Escape');
    expect(sent).toEqual(['editor']);
  });

  it('by default, leaves every key to the real ⚙ or More effects sheet, even with focus outside it, but not to a status popover', () => {
    const page = { html: '' };
    // A document holding `page.html`, matching the few selectors modalOpen asks for.
    const tags = () => [...page.html.matchAll(/<[a-z]+\s[^>]*>/g)].map((m) => m[0]);
    const matches = (tag: string, sel: string) => {
      if (sel === '.vf-sheet') return /class="(vf-sheet|vf-sheet\s[^"]*)"/.test(tag);
      if (sel === '[aria-modal="true"]') return tag.includes('aria-modal="true"');
      if (sel === '[role="dialog"]:not(.live-status-pop)') return tag.includes('role="dialog"') && !tag.includes('live-status-pop');
      throw new Error(`unexpected selector ${sel}`);
    };
    vi.stubGlobal('document', { querySelector: (s: string) => (s.split(',').some((sel) => tags().some((t) => matches(t, sel.trim()))) ? {} : null) });
    try {
      const sent: Sent[] = [];
      const keys = liveKeys({
        sheetOpen: modalOpen,
        editor: () => sent.push('editor'),
        act: (a) => sent.push(a),
        fx: (a) => sent.push(a),
        rate: (stars) => sent.push({ rate: stars }),
        favourite: () => sent.push('favourite'),
        help: () => sent.push('help'),
      });
      const outside = { closest: () => null } as unknown as EventTarget;
      const press = (key: string) => keys.keydown({ key, metaKey: false, shiftKey: false, ctrlKey: false, altKey: false, repeat: false, target: outside, preventDefault: () => {} });
      const all = ['Escape', 'r', 'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', '1', '2', '3', '4', '5', 'f', 'l', 'h'];
      for (const sheet of [
        createElement(Settings, { open: true, onClose: () => {} }),
        createElement(MoreEffects, { open: true, onClose: () => {} }),
        // The ? overlay, a modal dialog too.
        createElement(HelpOverlay, { open: true, onClose: () => {} }),
      ]) {
        page.html = renderToStaticMarkup(sheet);
        for (const key of all) press(key);
        expect(sent).toEqual([]);
      }
      page.html = '<div class="live-status-pop" data-pop="x" role="dialog" aria-label="x"></div>';
      press('Escape');
      expect(sent).toEqual(['editor']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('leaves every key pressed inside a sheet or dialog to it', () => {
    const { sent, press } = setup();
    const inSheet = { closest: (s: string) => (s.includes('dialog') ? {} : null) } as unknown as EventTarget;
    const outside = { closest: () => null } as unknown as EventTarget;
    for (const key of ['Escape', 'ArrowRight', 'r', 'b', '3', 'f', '?']) press(key, { target: inSheet });
    expect(sent).toEqual([]);
    press('ArrowRight', { target: outside });
    expect(sent).toEqual([{ kind: 'next' }]);
  });

  it('holds an effect while its key is down, once however long it repeats', () => {
    const { sent, keys, press } = setup();
    press('s');
    press('s', { repeat: true });
    keys.keyup({ key: 'S' });
    keys.keyup({ key: 's' });
    expect(sent).toEqual([
      { kind: 'strobe', on: true },
      { kind: 'strobe', on: false },
    ]);
  });

  it('latches with Shift, and sends the other effect keys as one action', () => {
    const { sent, keys, press } = setup();
    press('F', { shiftKey: true });
    keys.keyup({ key: 'f' });
    press('b');
    expect(sent).toEqual([
      { kind: 'freeze', on: null },
      { kind: 'blackout', on: null },
    ]);
    expect(keys.down.size).toBe(0);
  });

  it('freezes while F is down, and lets go on its release', () => {
    const { sent, keys, press, prevented } = setup();
    press('f');
    press('f', { repeat: true });
    keys.keyup({ key: 'l' });
    expect(keys.down.has('freeze')).toBe(true);
    keys.keyup({ key: 'F' });
    expect(sent).toEqual([
      { kind: 'freeze', on: true },
      { kind: 'freeze', on: false },
    ]);
    expect(prevented()).toBe(2);
  });

  it('lets go of every held key when the window loses focus', () => {
    const { sent, keys, press } = setup();
    press('s');
    press('p');
    press('f');
    keys.blur();
    keys.keyup({ key: 's' });
    keys.keyup({ key: 'f' });
    expect(sent).toEqual([
      { kind: 'strobe', on: true },
      { kind: 'punch', on: true },
      { kind: 'freeze', on: true },
      { kind: 'strobe', on: false },
      { kind: 'punch', on: false },
      { kind: 'freeze', on: false },
    ]);
  });

  it('rates the preset with 1 to 5, once however long the key repeats', () => {
    const { sent, press, prevented } = setup();
    for (const k of ['1', '2', '3', '4', '5']) press(k);
    press('4', { repeat: true });
    expect(sent).toEqual([{ rate: 1 }, { rate: 2 }, { rate: 3 }, { rate: 4 }, { rate: 5 }]);
    expect(prevented()).toBe(6);
  });

  it('does nothing for 6 to 9', () => {
    const { sent, press, prevented } = setup();
    for (const k of ['6', '7', '8', '9']) press(k);
    expect(sent).toEqual([]);
    expect(prevented()).toBe(0);
  });

  it('favourites with L, with or without Shift, which never freezes', () => {
    const { sent, keys, press } = setup();
    press('l');
    press('L', { shiftKey: true });
    press('l', { repeat: true });
    keys.keyup({ key: 'l' });
    expect(sent).toEqual(['favourite', 'favourite']);
    expect(keys.down.size).toBe(0);
  });

  it('does nothing on Z, which froze before decision 57', () => {
    const { sent, keys, press, prevented } = setup();
    press('z');
    press('Z', { shiftKey: true });
    keys.keyup({ key: 'z' });
    expect(sent).toEqual([]);
    expect(keys.down.size).toBe(0);
    expect(prevented()).toBe(0);
  });

  it('shows the help on ?', () => {
    const { sent, press, prevented } = setup();
    press('?', { shiftKey: true });
    press('?', { shiftKey: true, repeat: true });
    expect(sent).toEqual(['help']);
    expect(prevented()).toBe(2);
  });

  it('does nothing for a key it has no use for', () => {
    const { sent, press, prevented } = setup();
    press('q');
    press('Tab');
    expect(sent).toEqual([]);
    expect(prevented()).toBe(0);
  });
});
