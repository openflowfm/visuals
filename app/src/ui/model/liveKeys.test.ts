import { describe, expect, it, vi } from 'vitest';
import { liveKeys, type KeyLike, type LiveKeyTargets } from './liveKeys';

/** A key press as the handlers read it, on the page (not in a field or a dialog). */
const press = (key: string, more: Partial<KeyLike> = {}): KeyLike => ({
  key,
  metaKey: false,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  repeat: false,
  target: null,
  preventDefault: () => {},
  ...more,
});

function targets(more: Partial<LiveKeyTargets> = {}): LiveKeyTargets {
  return { editor: vi.fn(), act: vi.fn(), fx: vi.fn(), rate: vi.fn(), favourite: vi.fn(), help: vi.fn(), ...more };
}

describe('E: the Stage’s effects panel', () => {
  it('opens or closes the panel once per press, its repeats ignored', () => {
    const effects = vi.fn();
    const keys = liveKeys(targets({ effects }));
    keys.keydown(press('e'));
    keys.keydown(press('e', { repeat: true }));
    keys.keydown(press('E'));
    expect(effects).toHaveBeenCalledTimes(2);
  });

  it('sends no effect: E is no effect key', () => {
    const t = targets({ effects: vi.fn() });
    liveKeys(t).keydown(press('e'));
    expect(t.fx).not.toHaveBeenCalled();
    expect(t.act).not.toHaveBeenCalled();
  });

  it('waits while a sheet is open, and does nothing with ⌘ or without a panel', () => {
    const effects = vi.fn();
    liveKeys(targets({ effects, sheetOpen: () => true })).keydown(press('e'));
    liveKeys(targets({ effects })).keydown(press('e', { metaKey: true }));
    expect(effects).not.toHaveBeenCalled();
    const t = targets();
    expect(() => liveKeys(t).keydown(press('e'))).not.toThrow();
  });
});

describe('G: the Stage’s library map', () => {
  it('opens or closes the map once per press, its repeats ignored', () => {
    const map = vi.fn();
    const keys = liveKeys(targets({ map }));
    keys.keydown(press('g'));
    keys.keydown(press('g', { repeat: true }));
    keys.keydown(press('G'));
    expect(map).toHaveBeenCalledTimes(2);
  });

  it('sends no effect or step, and leaves the effects panel alone', () => {
    const t = targets({ map: vi.fn(), effects: vi.fn() });
    liveKeys(t).keydown(press('g'));
    expect(t.fx).not.toHaveBeenCalled();
    expect(t.act).not.toHaveBeenCalled();
    expect(t.effects).not.toHaveBeenCalled();
  });

  it('waits while a sheet is open, and does nothing with ⌘ or ⇧, or without a map', () => {
    const map = vi.fn();
    liveKeys(targets({ map, sheetOpen: () => true })).keydown(press('g'));
    liveKeys(targets({ map })).keydown(press('g', { metaKey: true }));
    liveKeys(targets({ map })).keydown(press('G', { shiftKey: true }));
    expect(map).not.toHaveBeenCalled();
    const t = targets();
    expect(() => liveKeys(t).keydown(press('g'))).not.toThrow();
  });
});
