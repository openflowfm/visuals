import type { ReactNode } from 'react';

/**
 * The macOS layout's icons (app/src/layout/): one `Icon` with a name from a
 * fixed set, drawn here for this app (not SF Symbols, not from any icon set),
 * in `currentColor`, so a row's or a button's colour is the icon's too.
 *
 * The line: one stroke, round caps and joins, like the markings on an
 * instrument. Every glyph sits on a 16-unit grid with a 1.5 stroke at 16 px;
 * straight strokes are centred on a quarter unit (x.25 or x.75) so their edges
 * land on whole device pixels on a Retina display. Containers have a 2-unit
 * corner, small parts 1.25; the transport keys (play, pause, next, previous,
 * stop) are solid, their corners rounded by the same stroke. The stroke
 * thickens a little as the icon grows (1.375 px at 12, 1.75 px at 24), so a
 * small one doesn't go faint and a big one doesn't turn heavy.
 */

/** Every icon the layout uses. */
export const ICON_NAMES = [
  'library',
  'star',
  'recent',
  'playlist',
  'smart-playlist',
  'chevron-down',
  'chevron-right',
  'search',
  'play',
  'pause',
  'next',
  'sidebar',
  'more',
  'plus',
  'previous',
  'stop',
  'close',
] as const;
export type IconName = (typeof ICON_NAMES)[number];

export interface IconProps {
  name: IconName;
  /** Its width and height in px; 16 by default. */
  size?: number;
  /** What it says to a screen reader when it stands alone; without one it is hidden from them (the row or button names it). */
  label?: string;
  className?: string;
}

/** A solid shape: filled, and stroked in the same colour so its corners come out round. */
const solid = { fill: 'currentColor' } as const;

/** The two long rows of a playlist; the third, short one leaves room for its mark. */
const rows = 'M2.25 3.75H13.75M2.25 7.75H13.75M2.25 11.75H7.25';

/** The glyphs, on a 16×16 box; the svg strokes them unless a shape says otherwise. */
const GLYPHS: Record<IconName, ReactNode> = {
  // The library: the grid of presets' pictures.
  library: (
    <>
      <rect x="2.25" y="2.25" width="4.5" height="4.5" rx="1.25" />
      <rect x="9.25" y="2.25" width="4.5" height="4.5" rx="1.25" />
      <rect x="2.25" y="9.25" width="4.5" height="4.5" rx="1.25" />
      <rect x="9.25" y="9.25" width="4.5" height="4.5" rx="1.25" />
    </>
  ),
  // Five points, a little fuller than a geometric star, its centre a touch low so it sits level.
  star: <path d="M8 2.2 9.7 6.05 13.9 6.48 10.76 9.3 11.64 13.42 8 11.3 4.36 13.42 5.24 9.3 2.1 6.48 6.3 6.05Z" />,
  // A dial and its hand.
  recent: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 4.75V8l2.25 1.5" />
    </>
  ),
  // Rows, and a play mark where the third ends.
  playlist: <path d={`${rows}M10.25 9.5 14 11.75 10.25 14Z`} />,
  // Rows, and a spark where the third ends: it fills itself.
  'smart-playlist': <path d={`${rows}M12 9.25Q12.25 11.5 14.5 11.75Q12.25 12 12 14.25Q11.75 12 9.5 11.75Q11.75 11.5 12 9.25Z`} />,
  // The chevrons' 45° matches the macOS disclosure button's (macos/controls.tsx).
  'chevron-down': <path d="M4.5 6.25 8 9.75 11.5 6.25" />,
  'chevron-right': <path d="M6.25 4.5 9.75 8 6.25 11.5" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.25 10.25 13.75 13.75" />
    </>
  ),
  // Shifted right of centre, where it looks centred.
  play: <path {...solid} d="M5.25 3.25 12.75 8 5.25 12.75Z" />,
  pause: (
    <>
      <rect {...solid} x="4.25" y="3.75" width="1.75" height="8.5" rx=".5" />
      <rect {...solid} x="10" y="3.75" width="1.75" height="8.5" rx=".5" />
    </>
  ),
  next: (
    <>
      <path {...solid} d="M3.25 4 9.25 8 3.25 12Z" />
      <path d="M12.25 3.75V12.25" />
    </>
  ),
  previous: (
    <>
      <path {...solid} d="M12.75 4 6.75 8 12.75 12Z" />
      <path d="M3.75 3.75V12.25" />
    </>
  ),
  stop: <rect {...solid} x="4.25" y="4.25" width="7.5" height="7.5" rx=".75" />,
  // The window, its sidebar ruled off at the left.
  sidebar: (
    <>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
      <path d="M6.25 2.75V13.25" />
    </>
  ),
  // Three dots, as the app's "more" button draws them (Popover.tsx's MoreDots): solid, no stroke.
  more: (
    <>
      <circle cx="3" cy="8" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="13" cy="8" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  plus: <path d="M8 3.25V12.75M3.25 8H12.75" />,
  close: <path d="M4.25 4.25 11.75 11.75M11.75 4.25 4.25 11.75" />,
};

/** The stroke, in the 16-unit box's units, for an icon `size` px across: 1.5 px at 16, 1/32 px more or less per px. */
export function strokeFor(size: number): number {
  const px = 1 + size / 32;
  return Math.round(((px * 16) / size) * 1000) / 1000;
}

/** One icon. */
export function Icon({ name, size = 16, label, className }: IconProps) {
  return (
    <svg
      className={className ? `lay-icon ${className}` : 'lay-icon'}
      data-icon={name}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeFor(size)}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {GLYPHS[name]}
    </svg>
  );
}
