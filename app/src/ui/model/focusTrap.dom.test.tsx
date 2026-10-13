// @vitest-environment happy-dom
import { useRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFocusTrap } from './focusTrap';

/** A dialog with a trap and three buttons, named `name` 1 to 3; `children` sit inside it after them. */
function Dialog({ name, modal = true, children }: { name: string; modal?: boolean; children?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);
  return (
    <div ref={ref} role="dialog" aria-modal={modal} aria-label={name} tabIndex={-1}>
      <button>{name} 1</button>
      <button>{name} 2</button>
      <button>{name} 3</button>
      {children}
    </div>
  );
}

const tab = (shift = false) => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab', shiftKey: shift });
const button = (name: string) => screen.getByRole('button', { name });

beforeEach(() => {
  // The trap leaves out what isn't laid out; happy-dom lays nothing out, so every element counts as shown.
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
});
afterEach(() => vi.restoreAllMocks());

describe('useFocusTrap', () => {
  it('moves focus into the dialog when it opens', () => {
    render(<Dialog name="Help" />);
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
  });

  it('goes round from the last control to the first with Tab, and back with ⇧Tab', () => {
    render(<Dialog name="Help" />);
    button('Help 3').focus();
    tab();
    expect(document.activeElement).toBe(button('Help 1'));
    tab(true);
    expect(document.activeElement).toBe(button('Help 3'));
  });

  it('leaves a step that stays inside to the browser', () => {
    render(<Dialog name="Help" />);
    button('Help 1').focus();
    const e = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    button('Help 1').dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(button('Help 1'));
  });

  it('gives focus back to the control that opened it', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { unmount } = render(<Dialog name="Help" />);
    expect(document.activeElement).not.toBe(opener);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  /** The settings sheet, with a warning opened over it (inside it) when `warning`. */
  function Both({ warning }: { warning: boolean }) {
    return <Dialog name="Settings">{warning && <Dialog name="Warning" />}</Dialog>;
  }

  it('lets only the topmost of nested traps handle Tab', () => {
    const { rerender } = render(<Both warning={false} />);
    rerender(<Both warning />);
    expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'Warning' }));
    button('Warning 3').focus();
    tab();
    expect(document.activeElement).toBe(button('Warning 1'));
    tab(true);
    expect(document.activeElement).toBe(button('Warning 3'));
  });

  it('hands Tab back to the trap underneath once the top one closes', () => {
    const { rerender } = render(<Both warning={false} />);
    rerender(<Both warning />);
    rerender(<Both warning={false} />);
    button('Settings 3').focus();
    tab();
    expect(document.activeElement).toBe(button('Settings 1'));
  });
});
