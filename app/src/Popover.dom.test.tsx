// @vitest-environment happy-dom
//
// The home's small popovers: Esc and a choice made in one close it and give
// focus back to its button; a press outside closes it too.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Popover } from './Popover.tsx';

afterEach(cleanup);

function menu(onPick = vi.fn()) {
  render(
    <Popover name="more" label="···" role="menu">
      {(close) => (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            close();
            onPick();
          }}
        >
          rename
        </button>
      )}
    </Popover>,
  );
  return onPick;
}

describe('Popover', () => {
  it('opens its panel under the button, named like it', () => {
    menu();
    const button = screen.getByRole('button', { name: 'more' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu', { name: 'more' })).toBeTruthy();
  });

  it('gives focus back to its button when a menu item is chosen', () => {
    const picked = menu();
    fireEvent.click(screen.getByRole('button', { name: 'more' }));
    const item = screen.getByRole('menuitem', { name: 'rename' });
    item.focus();
    fireEvent.click(item);
    expect(picked).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'more' }));
  });

  it('gives focus back to its button on Esc', () => {
    menu();
    fireEvent.click(screen.getByRole('button', { name: 'more' }));
    screen.getByRole('menuitem', { name: 'rename' }).focus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'more' }));
  });

  it('is type with no box, underlined while open, over a raised panel with no border (decision 68)', () => {
    const style = document.createElement('style');
    // Read from disk: vitest hands a test empty CSS for an import, even `?raw`.
    style.textContent = ':root { --surface-2: rgb(2, 2, 2); }\n' + readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'popover.css'), 'utf8');
    document.head.append(style);
    try {
      menu();
      const button = screen.getByRole('button', { name: 'more' });
      // happy-dom reads `border: 0` back as "initial".
      expect(['', 'none', 'initial']).toContain(getComputedStyle(button).borderTopStyle);
      expect(['', 'none', 'transparent', 'rgba(0, 0, 0, 0)']).toContain(getComputedStyle(button).backgroundColor);
      fireEvent.click(button);
      expect(getComputedStyle(button).textDecoration).toContain('underline');
      const panel = screen.getByRole('menu');
      expect(getComputedStyle(panel).backgroundColor).toBe('rgb(2, 2, 2)');
      expect(['', 'none', 'initial']).toContain(getComputedStyle(panel).borderTopStyle);
    } finally {
      style.remove();
    }
  });

  it('closes on a press outside, leaving focus where it went', () => {
    render(
      <>
        <Popover name="more" label="···">
          <p>inside</p>
        </Popover>
        <button type="button">elsewhere</button>
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'more' }));
    const elsewhere = screen.getByRole('button', { name: 'elsewhere' });
    fireEvent.pointerDown(elsewhere);
    elsewhere.focus();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
  });
});
