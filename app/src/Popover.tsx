import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** Three dots for a "more" button: the "···" glyph reads as a dash in Instrument Sans. */
export function MoreDots() {
  return (
    <svg className="vf-more-dots" width="16" height="4" viewBox="0 0 16 4" aria-hidden="true" focusable="false">
      <circle cx="2" cy="2" r="1.6" fill="currentColor" />
      <circle cx="8" cy="2" r="1.6" fill="currentColor" />
      <circle cx="14" cy="2" r="1.6" fill="currentColor" />
    </svg>
  );
}
import './popover.css';

/**
 * A button that opens a small panel under it (the home's "how it plays ▾",
 * "···", "+ playlist ▾" and the narrow window's source menu). Esc or a press
 * outside closes it; Esc, and a choice that closes it, put focus back on the
 * button (something the choice opens, such as a rename box, may take it after). `children` is the
 * panel's contents, or a function of `close` for a menu whose items close it.
 * `role` is the panel's: `dialog` for controls, `menu` for a list of actions
 * (each item then a `menuitem`). `align` hangs the panel from the button's left
 * or right edge.
 */
export function Popover({
  label,
  title,
  name,
  className,
  role = 'dialog',
  align = 'left',
  pressed,
  children,
}: {
  /** What the button shows. */
  label: ReactNode;
  title?: string;
  /** The button's and the panel's accessible name. */
  name: string;
  /** Placed on the wrapper, for the caller's styles. */
  className?: string;
  role?: 'dialog' | 'menu';
  align?: 'left' | 'right';
  /** A button that also shows a state (aria-pressed) while closed. */
  pressed?: boolean;
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState(align);
  // Keep the panel inside the window: hung from the left, it flips to the right when it would run past the window's right edge.
  useLayoutEffect(() => {
    if (!open) {
      setSide(align);
      return;
    }
    const r = panel.current?.getBoundingClientRect();
    if (align === 'left' && r && r.right > window.innerWidth - 12) setSide('right');
  }, [open, align]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    const press = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', key, { capture: true });
    window.addEventListener('pointerdown', press, { capture: true });
    return () => {
      window.removeEventListener('keydown', key, { capture: true });
      window.removeEventListener('pointerdown', press, { capture: true });
    };
  }, [open]);
  // A choice made in the panel (a menu item, a source picked) closes it and gives focus back to the button, as Esc does; a press elsewhere leaves focus where it went.
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  return (
    <span className={className ? `vf-pop ${className}` : 'vf-pop'} ref={root}>
      <button
        ref={button}
        type="button"
        className="vf-pop-button"
        aria-label={name}
        aria-expanded={open}
        aria-haspopup={role}
        aria-controls={open ? id : undefined}
        aria-pressed={pressed}
        title={title}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
      {open && (
        <div ref={panel} className="vf-pop-panel" id={id} role={role} aria-label={name} data-align={side}>
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </span>
  );
}
