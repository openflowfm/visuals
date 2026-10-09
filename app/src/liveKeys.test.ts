import { describe, expect, it } from 'vitest';
import type { FxAction } from './fx.ts';
import { liveKeys, type KeyLike } from './liveKeys.ts';
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
    press('z', field);
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
    press('Z', { shiftKey: true });
    keys.keyup({ key: 'z' });
    press('b');
    expect(sent).toEqual([
      { kind: 'freeze', on: null },
      { kind: 'blackout', on: null },
    ]);
    expect(keys.down.size).toBe(0);
  });

  it('freezes while Z is down, and lets go on its release', () => {
    const { sent, keys, press, prevented } = setup();
    press('z');
    press('z', { repeat: true });
    keys.keyup({ key: 'f' });
    expect(keys.down.has('freeze')).toBe(true);
    keys.keyup({ key: 'Z' });
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
    press('z');
    keys.blur();
    keys.keyup({ key: 's' });
    keys.keyup({ key: 'z' });
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

  it('favourites with F, which no longer freezes, with or without Shift', () => {
    const { sent, keys, press } = setup();
    press('f');
    press('F', { shiftKey: true });
    press('f', { repeat: true });
    keys.keyup({ key: 'f' });
    expect(sent).toEqual(['favourite', 'favourite']);
    expect(keys.down.size).toBe(0);
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
