// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { INSPECTOR_ID, SIDEBAR_ID, useDismiss, useOverlayFocus } from './HomeLayout';

/** Both panels, a toggle for each and one for something else, and a button outside them all. */
function DismissHarness({ open, dismiss }: { open: string[]; dismiss?: () => void }) {
  const side = useRef<HTMLElement | null>(null);
  const insp = useRef<HTMLElement | null>(null);
  useDismiss(side, insp, open, dismiss);
  return (
    <>
      <button aria-controls={SIDEBAR_ID}>sidebar toggle</button>
      <button aria-controls={INSPECTOR_ID}>
        <span>inspector toggle</span>
      </button>
      <button aria-controls="elsewhere">other toggle</button>
      <aside ref={side} id={SIDEBAR_ID}>
        <button>in the sidebar</button>
      </aside>
      <aside ref={insp} id={INSPECTOR_ID}>
        <button>in the inspector</button>
      </aside>
      <button>outside</button>
    </>
  );
}

/** Runs `fn` on every keydown at the document, before it bubbles to the window. */
function onDocumentKey(fn: (e: KeyboardEvent) => void) {
  document.addEventListener('keydown', fn);
  return () => document.removeEventListener('keydown', fn);
}

describe('useDismiss', () => {
  it('dismisses on a press outside every open panel', () => {
    const dismiss = vi.fn();
    render(<DismissHarness open={[SIDEBAR_ID]} dismiss={dismiss} />);
    fireEvent.pointerDown(screen.getByText('outside'));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('keeps the panels on a press inside either panel', () => {
    const dismiss = vi.fn();
    render(<DismissHarness open={[SIDEBAR_ID, INSPECTOR_ID]} dismiss={dismiss} />);
    fireEvent.pointerDown(screen.getByText('in the sidebar'));
    fireEvent.pointerDown(screen.getByText('in the inspector'));
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('keeps them on a press on an open panel’s toggle, or inside it', () => {
    const dismiss = vi.fn();
    render(<DismissHarness open={[SIDEBAR_ID, INSPECTOR_ID]} dismiss={dismiss} />);
    fireEvent.pointerDown(screen.getByText('sidebar toggle'));
    fireEvent.pointerDown(screen.getByText('inspector toggle'));
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('dismisses on a press on a toggle for something that isn’t open', () => {
    const dismiss = vi.fn();
    render(<DismissHarness open={[SIDEBAR_ID]} dismiss={dismiss} />);
    fireEvent.pointerDown(screen.getByText('other toggle'));
    fireEvent.pointerDown(screen.getByText('inspector toggle'));
    expect(dismiss).toHaveBeenCalledTimes(2);
  });

  it('dismisses on Escape', () => {
    const dismiss = vi.fn();
    render(<DismissHarness open={[INSPECTOR_ID]} dismiss={dismiss} />);
    fireEvent.keyDown(screen.getByText('in the inspector'), { key: 'Escape' });
    expect(dismiss).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('ignores an Escape something took first', () => {
    const dismiss = vi.fn();
    render(<DismissHarness open={[INSPECTOR_ID]} dismiss={dismiss} />);
    const off = onDocumentKey((e) => e.preventDefault());
    fireEvent.keyDown(screen.getByText('in the inspector'), { key: 'Escape' });
    off();
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('listens to nothing when no panel is laid over, and stops when they go', () => {
    const dismiss = vi.fn();
    const { rerender } = render(<DismissHarness open={[]} dismiss={dismiss} />);
    fireEvent.pointerDown(screen.getByText('outside'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(dismiss).not.toHaveBeenCalled();
    rerender(<DismissHarness open={[SIDEBAR_ID]} dismiss={dismiss} />);
    fireEvent.pointerDown(screen.getByText('outside'));
    expect(dismiss).toHaveBeenCalledTimes(1);
    rerender(<DismissHarness open={[]} dismiss={dismiss} />);
    fireEvent.pointerDown(screen.getByText('outside'));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('calls the latest dismiss without listening again', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<DismissHarness open={[SIDEBAR_ID]} dismiss={first} />);
    rerender(<DismissHarness open={[SIDEBAR_ID]} dismiss={second} />);
    fireEvent.pointerDown(screen.getByText('outside'));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

/** An opener outside, and the panel (with a button, or with nothing to focus) while `mode` isn't null. */
function FocusHarness({ mode, empty = false }: { mode: 'docked' | 'overlay' | null; empty?: boolean }) {
  const panel = useRef<HTMLElement | null>(null);
  useOverlayFocus(panel, mode);
  return (
    <>
      <button>opener</button>
      <button>elsewhere</button>
      {mode && (
        <aside ref={panel} tabIndex={-1} aria-label="panel">
          {!empty && (
            <>
              <button disabled>disabled</button>
              <button>first</button>
              <button>second</button>
            </>
          )}
        </aside>
      )}
    </>
  );
}

describe('useOverlayFocus', () => {
  it('moves focus to the first thing it can take inside an overlay as it opens', () => {
    const { rerender } = render(<FocusHarness mode={null} />);
    act(() => screen.getByText('opener').focus());
    rerender(<FocusHarness mode="overlay" />);
    expect(document.activeElement).toBe(screen.getByText('first'));
  });

  it('focuses the panel itself when nothing in it can take focus', () => {
    const { rerender } = render(<FocusHarness mode={null} empty />);
    rerender(<FocusHarness mode="overlay" empty />);
    expect(document.activeElement).toBe(screen.getByLabelText('panel'));
  });

  it('leaves focus where it is when a panel opens docked', () => {
    const { rerender } = render(<FocusHarness mode={null} />);
    act(() => screen.getByText('opener').focus());
    rerender(<FocusHarness mode="docked" />);
    expect(document.activeElement).toBe(screen.getByText('opener'));
  });

  it('leaves focus where it is when a docked panel turns into an overlay (the window narrowing)', () => {
    const { rerender } = render(<FocusHarness mode="docked" />);
    act(() => screen.getByText('opener').focus());
    rerender(<FocusHarness mode="overlay" />);
    expect(document.activeElement).toBe(screen.getByText('opener'));
  });

  it('gives focus back to the opener when the overlay closes with focus in it', () => {
    const { rerender } = render(<FocusHarness mode={null} />);
    act(() => screen.getByText('opener').focus());
    rerender(<FocusHarness mode="overlay" />);
    act(() => screen.getByText('second').focus());
    rerender(<FocusHarness mode={null} />);
    expect(document.activeElement).toBe(screen.getByText('opener'));
  });

  it('leaves focus that moved outside the overlay where it went', () => {
    const { rerender } = render(<FocusHarness mode={null} />);
    act(() => screen.getByText('opener').focus());
    rerender(<FocusHarness mode="overlay" />);
    act(() => screen.getByText('elsewhere').focus());
    rerender(<FocusHarness mode={null} />);
    expect(document.activeElement).toBe(screen.getByText('elsewhere'));
  });

  it('keeps focus in a panel that docks instead of closing (the window widening)', () => {
    const { rerender } = render(<FocusHarness mode={null} />);
    act(() => screen.getByText('opener').focus());
    rerender(<FocusHarness mode="overlay" />);
    rerender(<FocusHarness mode="docked" />);
    expect(document.activeElement).toBe(screen.getByText('first'));
  });
});
