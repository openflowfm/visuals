import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FxAction } from './fx.ts';
import { HelpOverlay } from './HelpOverlay.tsx';
import { LEAVE_HOLD_MS, liveKeys, modalOpen, type KeyLike } from './liveKeys.ts';
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

  it('never leaves live on a press of Esc: it takes it (so nothing else does) and does nothing more; ⌘⇧L leaves at once', () => {
    const { sent, press, prevented } = setup();
    press('Escape', { metaKey: true });
    press('Escape', { altKey: true });
    press('Escape', { defaultPrevented: true });
    expect(sent).toEqual([]);
    press('Escape');
    press('Escape');
    expect(sent).toEqual([]);
    expect(prevented()).toBe(2);
    press('L', { metaKey: true, shiftKey: true });
    expect(sent).toEqual(['editor']);
  });

  it('leaves Esc to a sheet open over live mode (⚙ Settings, More effects), and still never leaves on a press once it is closed', () => {
    const sheet = { open: true };
    const { sent, press, prevented } = setup(sheet);
    press('Escape');
    expect(sent).toEqual([]);
    expect(prevented()).toBe(0);
    sheet.open = false;
    press('Escape');
    expect(sent).toEqual([]);
    expect(prevented()).toBe(1);
  });

  it('ignores ? while a sheet is open, and opens the help once it is closed', () => {
    const sheet = { open: true };
    const { sent, press } = setup(sheet);
    press('?', { shiftKey: true });
    expect(sent).toEqual([]);
    sheet.open = false;
    press('?', { shiftKey: true });
    expect(sent).toEqual(['help']);
  });

  it('by default, leaves every key to the real ⚙ or More effects sheet, even with focus outside it, but not to a status popover', () => {
    const page = { html: '' };
    // A document holding `page.html`, matching the few selectors modalOpen asks for.
    const tags = () => [...page.html.matchAll(/<[a-z]+\s[^>]*>/g)].map((m) => m[0]);
    const matches = (tag: string, sel: string) => {
      if (sel === '.vf-sheet') return /class="(vf-sheet|vf-sheet\s[^"]*)"/.test(tag);
      if (sel === '[aria-modal="true"]') return tag.includes('aria-modal="true"');
      if (sel === '[role="dialog"]:not(.live-status-pop):not(.vf-pop-panel)') return tag.includes('role="dialog"') && !tag.includes('live-status-pop') && !tag.includes('vf-pop-panel');
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
      press('r');
      expect(sent).toEqual([{ kind: 'random' }]);
      // Home's popover (the Stage's Beat and Output lights) isn't modal either.
      page.html = '<div class="vf-pop-panel" id="x" role="dialog" aria-label="x"></div>';
      press('r');
      expect(sent).toEqual([{ kind: 'random' }, { kind: 'random' }]);
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

  it("hides or shows the Stage's panels on \\, once however long it repeats; without the Stage it leaves \\ alone", () => {
    const { sent, press, prevented } = setup();
    press('\\');
    expect(sent).toEqual([]);
    expect(prevented()).toBe(0);
    const panels: string[] = [];
    let p = 0;
    const keys = liveKeys({ editor: () => panels.push('editor'), act: () => {}, fx: () => {}, rate: () => {}, favourite: () => {}, help: () => {}, panels: () => panels.push('panels') });
    const stage = (key: string, more: Partial<KeyLike> = {}) =>
      keys.keydown({ key, metaKey: false, shiftKey: false, ctrlKey: false, altKey: false, repeat: false, target: null, preventDefault: () => p++, ...more });
    stage('\\');
    stage('\\', { repeat: true });
    expect(panels).toEqual(['panels']);
    expect(p).toBe(2);
  });

  it('gives Esc to the Stage (to show hidden panels), and never leaves when the Stage had no use for it', () => {
    const sent: string[] = [];
    let hidden = true;
    const keys = liveKeys({
      editor: () => sent.push('editor'),
      act: () => {},
      fx: () => {},
      rate: () => {},
      favourite: () => {},
      help: () => {},
      escape: () => {
        if (!hidden) return false;
        hidden = false;
        sent.push('shown');
        return true;
      },
    });
    const esc = () => keys.keydown({ key: 'Escape', metaKey: false, shiftKey: false, ctrlKey: false, altKey: false, repeat: false, target: null, preventDefault: () => {} });
    esc();
    esc();
    expect(sent).toEqual(['shown']);
  });

  describe('Esc held to leave', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    function held() {
      const sent: string[] = [];
      const keys = liveKeys({
        editor: () => sent.push('leave'),
        act: () => {},
        fx: () => {},
        rate: () => {},
        favourite: () => {},
        help: () => {},
        escape: () => (sent.push('escape'), true),
        holding: (on) => sent.push(on ? 'holding' : 'let go'),
      });
      const esc = (more: Partial<KeyLike> = {}) =>
        keys.keydown({ key: 'Escape', metaKey: false, shiftKey: false, ctrlKey: false, altKey: false, repeat: false, target: null, preventDefault: () => {}, ...more });
      return { sent, keys, esc };
    }

    it('leaves after LEAVE_HOLD_MS (3 s), the press doing what it does first', () => {
      const { sent, esc } = held();
      expect(LEAVE_HOLD_MS).toBe(3000);
      esc();
      expect(sent).toEqual(['escape', 'holding']);
      vi.advanceTimersByTime(2999);
      expect(sent).not.toContain('leave');
      vi.advanceTimersByTime(1);
      expect(sent).toEqual(['escape', 'holding', 'let go', 'leave']);
    });

    it('doesn’t leave when let go early, and a later hold starts again from nothing', () => {
      const { sent, keys, esc } = held();
      esc();
      vi.advanceTimersByTime(2500);
      keys.keyup({ key: 'Escape' });
      expect(sent).toEqual(['escape', 'holding', 'let go']);
      vi.advanceTimersByTime(10_000);
      expect(sent).not.toContain('leave');
      esc();
      vi.advanceTimersByTime(2999);
      expect(sent).not.toContain('leave');
      vi.advanceTimersByTime(1);
      expect(sent.at(-1)).toBe('leave');
    });

    it('times the hold from the first press: repeats neither restart it nor press again', () => {
      const { sent, esc } = held();
      esc();
      for (let t = 0; t < 29; t++) {
        vi.advanceTimersByTime(100);
        esc({ repeat: true });
      }
      expect(sent).toEqual(['escape', 'holding']);
      vi.advanceTimersByTime(100);
      expect(sent).toEqual(['escape', 'holding', 'let go', 'leave']);
    });

    it('cancels on the window losing focus', () => {
      const { sent, keys, esc } = held();
      esc();
      vi.advanceTimersByTime(2000);
      keys.blur();
      vi.advanceTimersByTime(5000);
      expect(sent).toEqual(['escape', 'holding', 'let go']);
    });

    it('holds a taken press (the laid-over crate took it) all the same, but not one in a field, a dialog, a sheet or with a modifier', () => {
      const { sent, keys, esc } = held();
      esc({ defaultPrevented: true });
      expect(sent).toEqual(['holding']);
      keys.keyup({ key: 'Escape' });
      sent.length = 0;
      esc({ target: { closest: () => ({}) } as unknown as EventTarget });
      esc({ metaKey: true });
      vi.advanceTimersByTime(5000);
      expect(sent).toEqual([]);
    });

    it('holds Esc from the output the same way (down and up from Rust)', () => {
      const { sent, keys } = held();
      keys.escapeDown();
      keys.escapeDown();
      expect(keys.holding).toBe(true);
      vi.advanceTimersByTime(1000);
      keys.escapeUp();
      expect(keys.holding).toBe(false);
      expect(sent).toEqual(['holding', 'let go']);
      keys.escapeDown();
      vi.advanceTimersByTime(3000);
      expect(sent).toEqual(['holding', 'let go', 'holding', 'let go', 'leave']);
    });

    it('doesn’t leave when a sheet opened mid-hold (⌘, opening Settings)', () => {
      const sent: string[] = [];
      let sheet = false;
      const keys = liveKeys({
        editor: () => sent.push('leave'),
        act: () => {},
        fx: () => {},
        rate: () => {},
        favourite: () => {},
        help: () => {},
        sheetOpen: () => sheet,
        holding: (on) => sent.push(on ? 'holding' : 'let go'),
      });
      keys.escapeDown();
      vi.advanceTimersByTime(1000);
      sheet = true;
      vi.advanceTimersByTime(5000);
      expect(sent).toEqual(['holding', 'let go']);
    });

    it('stops timing when disposed, telling no one', () => {
      const { sent, keys, esc } = held();
      esc();
      keys.dispose();
      vi.advanceTimersByTime(5000);
      expect(sent).toEqual(['escape', 'holding']);
    });
  });

  it('does nothing for a key it has no use for', () => {
    const { sent, press, prevented } = setup();
    press('q');
    press('Tab');
    expect(sent).toEqual([]);
    expect(prevented()).toBe(0);
  });
});
