import { describe, expect, it } from 'vitest';
import type { FxAction } from './fx.ts';
import { liveKeys, type KeyLike } from './liveKeys.ts';
import type { Action } from './playlists.ts';

function setup() {
  const sent: (Action | FxAction | 'editor')[] = [];
  const keys = liveKeys({ editor: () => sent.push('editor'), act: (a) => sent.push(a), fx: (a) => sent.push(a) });
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
    expect(sent).toEqual(['editor']);
    expect(prevented()).toBe(1);
  });

  it('ignores keys typed into a field', () => {
    const { sent, press } = setup();
    press('r', { target: { closest: () => ({}) } as unknown as EventTarget });
    expect(sent).toEqual([]);
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

  it('lets go of every held key when the window loses focus', () => {
    const { sent, keys, press } = setup();
    press('s');
    press('p');
    keys.blur();
    keys.keyup({ key: 's' });
    expect(sent).toEqual([
      { kind: 'strobe', on: true },
      { kind: 'punch', on: true },
      { kind: 'strobe', on: false },
      { kind: 'punch', on: false },
    ]);
  });

  it('does nothing for a key it has no use for', () => {
    const { sent, press, prevented } = setup();
    press('q');
    press('Escape');
    expect(sent).toEqual([]);
    expect(prevented()).toBe(0);
  });
});
