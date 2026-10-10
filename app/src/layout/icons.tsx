/**
 * The macOS layout's icons (app/src/layout/): one `Icon` with a name from a
 * fixed set, drawn in `currentColor` on a 16-unit grid, so a row's or a
 * button's colour is the icon's too. Stub glyphs: plain shapes the icons lane
 * replaces with drawn ones, keeping the names and the props.
 */

/** Every icon the layout uses. */
export const ICON_NAMES = ['library', 'star', 'recent', 'playlist', 'smart-playlist', 'chevron-down', 'chevron-right', 'search', 'play', 'pause', 'next', 'sidebar', 'more', 'plus'] as const;
export type IconName = (typeof ICON_NAMES)[number];

export interface IconProps {
  name: IconName;
  /** Its width and height in px; 16 by default. */
  size?: number;
  /** What it says to a screen reader when it stands alone; without one it is hidden from them (the row or button names it). */
  label?: string;
  className?: string;
}

/** The stub glyphs: a path each, in a 16×16 box, stroked unless the name is in FILLED. */
const PATHS: Record<IconName, string> = {
  library: 'M2 3h12v10H2z M2 7h12 M6 3v10',
  star: 'M8 1.8l1.9 4 4.3.5-3.2 3 .9 4.3L8 11.4l-3.9 2.2.9-4.3-3.2-3 4.3-.5z',
  recent: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2z M8 5v3.5l2.5 1.5',
  playlist: 'M2 4h9 M2 8h9 M2 12h6 M13 9v4',
  'smart-playlist': 'M2 4h7 M2 8h5 M2 12h7 M12 3l1 2 2 1-2 1-1 2-1-2-2-1 2-1z',
  'chevron-down': 'M4 6l4 4 4-4',
  'chevron-right': 'M6 4l4 4-4 4',
  search: 'M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z M10.3 10.3L14 14',
  play: 'M4 2.5v11l9-5.5z',
  pause: 'M4 3h3v10H4z M9 3h3v10H9z',
  next: 'M3 3v10l7-5z M12 3v10',
  sidebar: 'M2 3h12v10H2z M6 3v10',
  more: 'M3.5 8h.01 M8 8h.01 M12.5 8h.01',
  plus: 'M8 3v10 M3 8h10',
};
const FILLED: ReadonlySet<IconName> = new Set(['play', 'pause']);

/** One icon. */
export function Icon({ name, size = 16, label, className }: IconProps) {
  const filled = FILLED.has(name);
  return (
    <svg
      className={className ? `lay-icon ${className}` : 'lay-icon'}
      data-icon={name}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={name === 'more' ? 2.4 : 1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
