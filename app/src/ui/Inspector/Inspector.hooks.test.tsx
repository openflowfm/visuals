// @vitest-environment happy-dom
import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useEscape } from './Inspector';

/** Runs `fn` on every keydown at the document, before it bubbles to the window. */
function onDocumentKey(fn: (e: KeyboardEvent) => void) {
  document.addEventListener('keydown', fn);
  return () => document.removeEventListener('keydown', fn);
}

describe('useEscape', () => {
  it('closes on Escape, and takes the key', () => {
    const onClose = vi.fn();
    renderHook(() => useEscape(onClose));
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('ignores other keys', () => {
    const onClose = vi.fn();
    renderHook(() => useEscape(onClose));
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores an Escape typed in a text box', () => {
    const onClose = vi.fn();
    renderHook(() => useEscape(onClose));
    render(
      <>
        <input aria-label="input" />
        <textarea aria-label="textarea" />
        <select aria-label="select" />
      </>,
    );
    for (const name of ['input', 'textarea', 'select']) fireEvent.keyDown(screen.getByLabelText(name), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores an Escape something inside took first', () => {
    const onClose = vi.fn();
    renderHook(() => useEscape(onClose));
    const off = onDocumentKey((e) => e.preventDefault());
    fireEvent.keyDown(document.body, { key: 'Escape' });
    off();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls the latest onClose, and listens to nothing without one', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ close }: { close?: () => void }) => useEscape(close), { initialProps: { close: first as (() => void) | undefined } });
    rerender({ close: second });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    rerender({ close: undefined });
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('dismisses the toast first while one shows, without closing', () => {
    const onClose = vi.fn();
    const dismiss = vi.fn();
    const { rerender } = renderHook(({ toast }: { toast?: () => void }) => useEscape(onClose, toast), { initialProps: { toast: dismiss as (() => void) | undefined } });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    rerender({ toast: undefined });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dismisses a toast even with nothing to close', () => {
    const dismiss = vi.fn();
    renderHook(() => useEscape(undefined, dismiss));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('stops listening once unmounted', () => {
    const onClose = vi.fn();
    const { unmount } = renderHook(() => useEscape(onClose));
    unmount();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
