import { describe, expect, it } from 'vitest';
import { FOCUSABLE, wrapFocus } from './focusTrap.ts';

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
