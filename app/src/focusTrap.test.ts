import { describe, expect, it } from 'vitest';
import { FOCUSABLE, isTopTrap, leavesKeys, pushTrap, removeTrap, wrapFocus } from './focusTrap.ts';

describe('the stack of traps', () => {
  it('lets only the topmost act, and the one under it again once it goes', () => {
    const sheet = {};
    const warning = {};
    pushTrap(sheet);
    expect(isTopTrap(sheet)).toBe(true);
    pushTrap(warning);
    expect(isTopTrap(warning)).toBe(true);
    expect(isTopTrap(sheet)).toBe(false);
    removeTrap(warning);
    expect(isTopTrap(sheet)).toBe(true);
    removeTrap(sheet);
    expect(isTopTrap(sheet)).toBe(false);
    expect(isTopTrap(null)).toBe(false);
  });

  it('copes with traps leaving out of order', () => {
    const a = {};
    const b = {};
    pushTrap(a);
    pushTrap(b);
    removeTrap(a);
    expect(isTopTrap(b)).toBe(true);
    removeTrap(b);
    expect(isTopTrap(b)).toBe(false);
  });
});

describe('leavesKeys', () => {
  /** A stand-in element: inside the trap or not, in another dialog or not. */
  const el = (inDialog: boolean) => ({ closest: (s: string) => (inDialog && s.includes('dialog') ? {} : null) }) as unknown as Element;
  const inside = el(false);
  const trap = (modal: boolean) => ({ getAttribute: (n: string) => (n === 'aria-modal' && modal ? 'true' : null), contains: (e: Element | null) => e === inside }) as unknown as HTMLElement;
  const popover = el(true);
  const page = el(false);

  it('leaves every key alone while another trap is over it', () => {
    expect(leavesKeys(trap(true), inside, false)).toBe(true);
    expect(leavesKeys(trap(false), page, false)).toBe(true);
  });

  it('a non-modal drawer leaves focus in a popover beside it alone, but brings it back from the page', () => {
    expect(leavesKeys(trap(false), popover, true)).toBe(true);
    expect(leavesKeys(trap(false), page, true)).toBe(false);
    expect(leavesKeys(trap(false), inside, true)).toBe(false);
    expect(leavesKeys(trap(false), null, true)).toBe(false);
  });

  it('a modal one always takes its keys while on top', () => {
    expect(leavesKeys(trap(true), popover, true)).toBe(false);
    expect(leavesKeys(trap(true), page, true)).toBe(false);
  });
});

describe('wrapFocus', () => {
  const items = ['close', 'switch', 'ok'];

  it('goes round from the last control to the first on Tab', () => {
    expect(wrapFocus(items, 'ok', false, 'dialog')).toBe('close');
  });

  it('goes round from the first control to the last on Shift-Tab', () => {
    expect(wrapFocus(items, 'close', true, 'dialog')).toBe('ok');
  });

  it('leaves a step that stays inside to the browser', () => {
    expect(wrapFocus(items, 'close', false, 'dialog')).toBeNull();
    expect(wrapFocus(items, 'ok', true, 'dialog')).toBeNull();
    expect(wrapFocus(items, 'switch', false, 'dialog')).toBeNull();
  });

  it('brings focus from the dialog itself, or from outside it, back in at the near end', () => {
    expect(wrapFocus(items, null, false, 'dialog')).toBe('close');
    expect(wrapFocus(items, null, true, 'dialog')).toBe('ok');
    expect(wrapFocus(items, 'a button behind the drawer', false, 'dialog')).toBe('close');
  });

  it('keeps focus on the dialog when nothing inside can take it', () => {
    expect(wrapFocus([], null, false, 'dialog')).toBe('dialog');
    expect(wrapFocus([], 'dialog', true, 'dialog')).toBe('dialog');
  });
});

describe('FOCUSABLE', () => {
  it('takes controls and leaves out disabled ones and those taken out of the Tab order', () => {
    expect(FOCUSABLE).toContain('button:not([disabled])');
    expect(FOCUSABLE).toContain('[tabindex]:not([tabindex="-1"])');
    expect(FOCUSABLE).toContain('input:not([disabled]):not([type="hidden"])');
  });
});
