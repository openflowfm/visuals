import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Popover as ZenPopover, type Dismissal } from '@satoramoto/zen';
import { Text } from '@satoramoto/zen';
import './Popover.css';

/** Three dots for a "more" button: the "···" glyph reads as a dash in Instrument Sans. */
export function MoreDots() {
  return (
    <svg className="vs-popover-dots" width="16" height="4" viewBox="0 0 16 4" aria-hidden="true" focusable="false">
      <circle cx="2" cy="2" r="1.6" fill="currentColor" />
      <circle cx="8" cy="2" r="1.6" fill="currentColor" />
      <circle cx="14" cy="2" r="1.6" fill="currentColor" />
    </svg>
  );
}

/** Room kept between a panel and the window's right edge before it flips to hang from the button's right (popover.css's 12px). */
const EDGE = 12;
/** The core popover's margin from the window's edges. */
const MARGIN = 4;

export interface PopoverProps {
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
  /**
   * Added: the panel opens across this element (its left edge and width), under the button,
   * instead of hanging from the button. The inspector's "How it plays" opens across the card;
   * the original did that with `position: static` on the wrapper, which a top-layer panel can't.
   */
  across?: RefObject<HTMLElement | null>;
  children: ReactNode | ((close: () => void) => ReactNode);
}

/**
 * A button that opens a small panel under it (the home's "how it plays ▾",
 * "···", "+ playlist ▾" and the narrow window's source menu).
 *
 * **Job.** Esc or a press outside closes it; Esc, and a choice that closes it, put focus back on
 * the button (something the choice opens, such as a rename box, may take it after). `children`
 * is the panel's contents, or a function of `close` for a menu whose items close it. `role` is
 * the panel's: `dialog` for controls, `menu` for a list of actions (each item then a
 * `menuitem`). `align` hangs the panel from the button's left or right edge.
 *
 * **Changed.** The panel is zen's `Popover` (its top-layer box, holding a `Layer level="float"`,
 * its placement and dismissal); this adds only the trigger, the right-edge hang and `across`, so it escapes every clipping ancestor and the theme's float layer draws
 * the glass, its edge and its lift (the original's --surface-float, --glass and --lift). Placement
 * is the core's: under the button, over it when only that has room, clamped in the window; the
 * original only flipped left to right. A wheel outside the panel also closes it (the core's
 * dismissal), as it can no longer follow content scrolled under it by the wheel. `across` is
 * added for the inspector's card.
 *
 * **Kept.** The API, the button's aria (`aria-expanded`, `aria-haspopup`, `aria-controls`,
 * `aria-pressed`, named by `name`), the panel's role and name, the flip to the right edge when a
 * left-hung panel would run past the window, the focus handling, and the look: type with no box,
 * underlined in the accent when open or pressed; menu items as whole-width rows.
 */
export function Popover({ label, title, name, className, role = 'dialog', align = 'left', pressed, across, children }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  // A choice made in the panel (a menu item, a source picked) closes it and gives focus back to the button, as Esc does; a press elsewhere leaves focus where it went.
  const close = useCallback(() => {
    setOpen(false);
    button.current?.focus();
  }, []);
  return (
    <span className={className ? `vs-popover ${className}` : 'vs-popover'}>
      <Text
        as="button"
        ref={button}
        type="button"
        className="vs-popover-button"
        aria-label={name}
        aria-expanded={open}
        aria-haspopup={role}
        aria-controls={open ? id : undefined}
        aria-pressed={pressed}
        title={title}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </Text>
      {open && (
        <Panel id={id} role={role} name={name} align={align} anchor={button} across={across} onClose={() => setOpen(false)} onEscape={close}>
          {typeof children === 'function' ? children(close) : children}
        </Panel>
      )}
    </span>
  );
}

/** The open panel: mounted is open. */
function Panel({
  id,
  role,
  name,
  align,
  anchor,
  across,
  onClose,
  onEscape,
  children,
}: {
  id: string;
  role: 'dialog' | 'menu';
  name: string;
  align: 'left' | 'right';
  anchor: RefObject<HTMLButtonElement | null>;
  across?: RefObject<HTMLElement | null>;
  onClose(): void;
  onEscape(): void;
  children: ReactNode;
}) {
  const onDismiss = useCallback((how: Dismissal) => (how === 'escape' ? onEscape() : onClose()), [onClose, onEscape]);
  // After the core's placement (its effects run first, and so do its listeners): hang from the right edge, or across `across`.
  // The core's positioned box is the panel's parent.
  const hang = useCallback(() => {
    const el = document.getElementById(id)?.parentElement;
    const from = anchor.current;
    if (!el || !from) return;
    const at = from.getBoundingClientRect();
    const span = across?.current?.getBoundingClientRect();
    if (span) {
      el.style.width = `${span.width}px`;
      el.style.left = `${span.left}px`;
      return;
    }
    const size = el.getBoundingClientRect();
    // Keep the panel inside the window: hung from the left, it flips to the right when it would run past the window's right edge.
    const right = align === 'right' || at.left + size.width > window.innerWidth - EDGE;
    if (right) el.style.left = `${Math.max(MARGIN, at.right - size.width)}px`;
  }, [align, anchor, across, id]);
  useLayoutEffect(hang, [hang]);
  useEffect(() => {
    window.addEventListener('resize', hang);
    document.addEventListener('scroll', hang, true);
    return () => {
      window.removeEventListener('resize', hang);
      document.removeEventListener('scroll', hang, true);
    };
  }, [hang]);
  return (
    <ZenPopover anchor={anchor} onDismiss={onDismiss} role={role} label={name} id={id} className={across ? 'vs-popover-panel vs-popover-panel--across' : 'vs-popover-panel'}>
      {children}
    </ZenPopover>
  );
}
