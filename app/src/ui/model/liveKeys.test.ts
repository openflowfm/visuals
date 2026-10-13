import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hitAction } from './fx';
import { LEAVE_HOLD_MS, liveKeys, type KeyLike, type LiveKeyTargets } from './liveKeys';

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

function targets(more: Partial<LiveKeyTargets> = {}) {
  return { editor: vi.fn(), act: vi.fn<LiveKeyTargets['act']>(), fx: vi.fn<LiveKeyTargets['fx']>(), rate: vi.fn<LiveKeyTargets['rate']>(), favourite: vi.fn(), help: vi.fn(), ...more };
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

describe('Esc held: leaving live', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('leaves once, LEAVE_HOLD_MS after the first press, its repeats not restarting the hold', () => {
    const holding = vi.fn();
    const t = targets({ holding });
    const keys = liveKeys(t);
    keys.keydown(press('Escape'));
    expect(holding).toHaveBeenLastCalledWith(true);
    expect(keys.holding).toBe(true);
    vi.advanceTimersByTime(LEAVE_HOLD_MS - 500);
    keys.keydown(press('Escape', { repeat: true }));
    keys.escapeDown();
    vi.advanceTimersByTime(499);
    expect(t.editor).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(t.editor).toHaveBeenCalledTimes(1);
    expect(holding).toHaveBeenLastCalledWith(false);
    expect(keys.holding).toBe(false);
    vi.advanceTimersByTime(LEAVE_HOLD_MS * 2);
    expect(t.editor).toHaveBeenCalledTimes(1);
  });

  it('let go early: cancelled, and the hold reported over', () => {
    const holding = vi.fn();
    const t = targets({ holding });
    const keys = liveKeys(t);
    keys.keydown(press('Escape'));
    vi.advanceTimersByTime(LEAVE_HOLD_MS - 1);
    keys.keyup({ key: 'Escape' });
    expect(holding.mock.calls).toEqual([[true], [false]]);
    vi.advanceTimersByTime(LEAVE_HOLD_MS);
    expect(t.editor).not.toHaveBeenCalled();
  });

  it('the window losing focus cancels it too, and a second press starts a fresh hold', () => {
    const t = targets();
    const keys = liveKeys(t);
    keys.keydown(press('Escape'));
    vi.advanceTimersByTime(LEAVE_HOLD_MS - 1);
    keys.blur();
    keys.keydown(press('Escape'));
    vi.advanceTimersByTime(LEAVE_HOLD_MS - 1);
    expect(t.editor).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(t.editor).toHaveBeenCalledTimes(1);
  });

  it('a sheet open when the hold runs out takes it: live stays', () => {
    let sheet = false;
    const holding = vi.fn();
    const t = targets({ holding, sheetOpen: () => sheet });
    const keys = liveKeys(t);
    keys.keydown(press('Escape'));
    sheet = true;
    vi.advanceTimersByTime(LEAVE_HOLD_MS);
    expect(t.editor).not.toHaveBeenCalled();
    expect(holding).toHaveBeenLastCalledWith(false);
  });

  it('a sheet already open takes Esc: no hold starts', () => {
    const t = targets({ sheetOpen: () => true, escape: vi.fn() });
    const keys = liveKeys(t);
    keys.keydown(press('Escape'));
    expect(keys.holding).toBe(false);
    expect(t.escape).not.toHaveBeenCalled();
  });

  it('a press tells the Stage (escape) once; one already taken (defaultPrevented) is not, but still holds', () => {
    const escape = vi.fn(() => true);
    const t = targets({ escape });
    const keys = liveKeys(t);
    keys.keydown(press('Escape'));
    keys.keydown(press('Escape', { repeat: true }));
    expect(escape).toHaveBeenCalledTimes(1);
    keys.keyup({ key: 'Escape' });
    keys.keydown(press('Escape', { defaultPrevented: true }));
    expect(escape).toHaveBeenCalledTimes(1);
    expect(keys.holding).toBe(true);
  });

  it("the output's Esc (escapeDown/escapeUp) holds the same way", () => {
    const t = targets();
    const keys = liveKeys(t);
    keys.escapeDown();
    keys.escapeUp();
    vi.advanceTimersByTime(LEAVE_HOLD_MS);
    expect(t.editor).not.toHaveBeenCalled();
    keys.escapeDown();
    vi.advanceTimersByTime(LEAVE_HOLD_MS);
    expect(t.editor).toHaveBeenCalledTimes(1);
  });

  it('dispose stops a pending hold without telling anyone', () => {
    const holding = vi.fn();
    const t = targets({ holding });
    const keys = liveKeys(t);
    keys.keydown(press('Escape'));
    keys.dispose();
    vi.advanceTimersByTime(LEAVE_HOLD_MS);
    expect(t.editor).not.toHaveBeenCalled();
    expect(holding.mock.calls).toEqual([[true]]);
  });

  it('⌘⇧L leaves at once', () => {
    const t = targets();
    const preventDefault = vi.fn();
    liveKeys(t).keydown(press('L', { metaKey: true, shiftKey: true, preventDefault }));
    expect(t.editor).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalled();
    expect(t.favourite).not.toHaveBeenCalled();
  });
});

describe('the effect keys that hold', () => {
  it('S, P, F send the effect on while down and off on release, once per press', () => {
    const t = targets();
    const keys = liveKeys(t);
    keys.keydown(press('s'));
    keys.keydown(press('s', { repeat: true }));
    keys.keyup({ key: 's' });
    keys.keyup({ key: 's' });
    expect(t.fx).toHaveBeenNthCalledWith(1, hitAction('strobe', true));
    expect(t.fx).toHaveBeenNthCalledWith(2, hitAction('strobe', false));
    expect(t.fx).toHaveBeenCalledTimes(2);
  });

  it('⇧ latches instead of holding: one toggle, nothing on release', () => {
    const t = targets();
    const keys = liveKeys(t);
    keys.keydown(press('F', { shiftKey: true }));
    keys.keyup({ key: 'F' });
    expect(t.fx.mock.calls).toEqual([[hitAction('freeze', null)]]);
  });

  it('the window losing focus lets go of every effect held', () => {
    const t = targets();
    const keys = liveKeys(t);
    keys.keydown(press('p'));
    keys.keydown(press('f'));
    vi.mocked(t.fx).mockClear();
    keys.blur();
    expect(t.fx.mock.calls).toEqual([[hitAction('punch', false)], [hitAction('freeze', false)]]);
    keys.keyup({ key: 'p' });
    keys.blur();
    expect(t.fx).toHaveBeenCalledTimes(2);
  });

  it('the other effect keys send their action once per press', () => {
    const t = targets();
    const keys = liveKeys(t);
    keys.keydown(press('b'));
    keys.keydown(press('b', { repeat: true }));
    keys.keydown(press('0'));
    expect(t.fx.mock.calls).toEqual([[{ kind: 'blackout', on: null }], [{ kind: 'fx_reset' }]]);
  });
});

describe('the keys’ mapping', () => {
  it('arrows step, R picks at random, each repeat stepping again', () => {
    const t = targets();
    const keys = liveKeys(t);
    for (const key of ['ArrowRight', 'ArrowDown']) keys.keydown(press(key));
    for (const key of ['ArrowLeft', 'ArrowUp']) keys.keydown(press(key));
    keys.keydown(press('r'));
    keys.keydown(press('R', { repeat: true }));
    expect(vi.mocked(t.act).mock.calls.map(([a]) => a.kind)).toEqual(['next', 'next', 'previous', 'previous', 'random', 'random']);
  });

  it('1–5 rate, L favourites, ? helps, \\ toggles the panels: once per press, repeats ignored', () => {
    const t = targets({ panels: vi.fn() });
    const keys = liveKeys(t);
    for (const key of ['1', '3', '5', 'l', '?', '\\']) {
      keys.keydown(press(key));
      keys.keydown(press(key, { repeat: true }));
    }
    expect(vi.mocked(t.rate).mock.calls).toEqual([[1], [3], [5]]);
    expect(t.favourite).toHaveBeenCalledTimes(1);
    expect(t.help).toHaveBeenCalledTimes(1);
    expect(t.panels).toHaveBeenCalledTimes(1);
  });

  it('6 and other keys do nothing and are left to the page', () => {
    const t = targets();
    const preventDefault = vi.fn();
    const keys = liveKeys(t);
    keys.keydown(press('6', { preventDefault }));
    keys.keydown(press('z', { preventDefault }));
    keys.keydown(press('\\', { preventDefault }));
    for (const f of [t.act, t.fx, t.rate, t.favourite, t.help]) expect(f).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('⌘, ctrl and alt keys are the system’s', () => {
    const t = targets();
    const keys = liveKeys(t);
    keys.keydown(press('ArrowRight', { metaKey: true }));
    keys.keydown(press('1', { ctrlKey: true }));
    keys.keydown(press('s', { altKey: true }));
    keys.keydown(press('Escape', { metaKey: true }));
    expect(t.act).not.toHaveBeenCalled();
    expect(t.rate).not.toHaveBeenCalled();
    expect(t.fx).not.toHaveBeenCalled();
    expect(keys.holding).toBe(false);
  });

  it('keys typed in a field, or pressed in a dialog, are theirs', () => {
    const t = targets();
    const keys = liveKeys(t);
    const inField = { closest: (s: string) => (s.includes('input') ? {} : null) } as unknown as EventTarget;
    const inDialog = { closest: (s: string) => (s.includes('dialog') ? {} : null) } as unknown as EventTarget;
    for (const target of [inField, inDialog]) {
      keys.keydown(press('r', { target }));
      keys.keydown(press('s', { target }));
      keys.keydown(press('Escape', { target }));
    }
    expect(t.act).not.toHaveBeenCalled();
    expect(t.fx).not.toHaveBeenCalled();
    expect(keys.holding).toBe(false);
  });

  it('an open sheet takes every key, ? included', () => {
    const t = targets({ sheetOpen: () => true });
    const keys = liveKeys(t);
    for (const key of ['?', 'ArrowRight', '1', 'l', 's']) keys.keydown(press(key));
    for (const f of [t.act, t.fx, t.rate, t.favourite, t.help]) expect(f).not.toHaveBeenCalled();
  });
});
