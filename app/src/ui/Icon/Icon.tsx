import type { CSSProperties, ReactNode } from 'react';
import { Icon as ZenIcon } from '@satoramoto/zen';

/**
 * **Job.** visual[flow]'s icons: one `Icon` with a name from a fixed set.
 *
 * **Changed.** Drawn in zen's `Icon` primitive (its square slot, `currentColor` stroke, round
 * caps and joins, the label or `aria-hidden`); only the glyph paths are this app's. The slot is
 * a `span.vs-icon` carrying `data-icon`, the `svg` inside it; `size` sets `--lib-icon-size` in px
 * and `strokeFor(size)` `--lib-icon-stroke`. A port of the old `app/src/layout/icons.tsx`
 * (retired in #257), the same exports and glyphs.
 *
 * **Kept.** Everything below, from the original:
 *
 * The macOS layout's icons: one `Icon` with a name from a
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
  'never',
  'edit',
  'gear',
  'camera',
  'import',
  // Live's (the Stage): its pads, lights and header tools.
  'random',
  'hold',
  'strobe',
  'blackout',
  'freeze',
  'beat',
  'link',
  'output',
  'fullscreen',
  'help',
  'effects',
  'audio',
  'mood',
  'intensity',
  'map',
  // Home's transport: the deck moving on by itself, preset after preset.
  'loop',
  'dice',
  'mixer',
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

/**
 * The loop's ring: from twelve o'clock clockwise round to half past ten (315°),
 * the gap left for its arrowhead. TransportBar fills along this same path
 * (`pathLength` 1), so the fill starts at the top and ends at the arrowhead.
 */
export const LOOP_RING = 'M8 2.25A5.75 5.75 0 1 1 3.93 3.93';
/** The loop's arrowhead at the ring's end, pointing on round, clockwise: its point on the ring, a leg down inside and a leg out to the left. */
export const LOOP_HEAD = 'M3.93 6.18V3.93H1.68';

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
  // The chevrons' 45° matches the macOS disclosure button's (the old app/src/macos/controls.tsx, retired in #239).
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
  // Never play: a ring with a bar through it, corner to corner where it meets the ring.
  never: (
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M3.94 12.06 12.06 3.94" />
    </>
  ),
  // Edit: a pencil, its point at the lower left, the ferrule ruled across it.
  edit: <path d="M10.25 3.25 12.75 5.75 6 12.5 3 13 3.5 10ZM8.75 4.75 11.25 7.25" />,
  // Two paths crossing, each ending in an arrowhead: shuffle.
  random: (
    <path d="M2.25 4.75H4.25C6.75 4.75 9.25 11.25 11.75 11.25H13.75M2.25 11.25H4.25C5.25 11.25 6.25 10.25 6.9 9.1M9.1 6.9C9.75 5.75 10.75 4.75 11.75 4.75H13.75M11.75 2.75 13.75 4.75 11.75 6.75M11.75 9.25 13.75 11.25 11.75 13.25" />
  ),
  // A padlock: the preset stays.
  hold: (
    <>
      <rect x="3.25" y="7.25" width="9.5" height="6.5" rx="2" />
      <path d="M5.25 7.25V5.25A2.75 2.75 0 0 1 10.75 5.25V7.25" />
    </>
  ),
  // A bolt.
  strobe: <path d="M9.25 1.75 3.75 9.25H8L6.75 14.25 12.25 6.75H8Z" />,
  // A ring half filled: the picture going dark.
  blackout: (
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path {...solid} d="M8 2.25A5.75 5.75 0 0 0 8 13.75Z" />
    </>
  ),
  // Six arms and the tips of two: frozen.
  freeze: <path d="M8 1.75V14.25M2.6 4.88 13.4 11.12M2.6 11.12 13.4 4.88M6.25 2.75 8 4.25 9.75 2.75M6.25 13.25 8 11.75 9.75 13.25" />,
  // A ring and its centre: the beat.
  beat: (
    <>
      <circle cx="8" cy="8" r="5.75" />
      <circle {...solid} cx="8" cy="8" r="2.25" />
    </>
  ),
  // Two links of a chain: Ableton Link.
  link: <path d="M6.75 9.25 9.25 6.75M7.25 4.75 8.25 3.75A2.47 2.47 0 0 1 11.75 7.25L10.75 8.25M8.75 11.25 7.75 12.25A2.47 2.47 0 0 1 4.25 8.75L5.25 7.75" />,
  // A display on its stand: the output.
  output: (
    <>
      <rect x="1.75" y="2.75" width="12.5" height="8.5" rx="2" />
      <path d="M5.75 13.75H10.25M8 11.25V13.75" />
    </>
  ),
  // Four corners opening out: full screen.
  fullscreen: <path d="M2.75 6V3.75A1 1 0 0 1 3.75 2.75H6M10 2.75H12.25A1 1 0 0 1 13.25 3.75V6M13.25 10V12.25A1 1 0 0 1 12.25 13.25H10M6 13.25H3.75A1 1 0 0 1 2.75 12.25V10" />,
  help: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M6.25 6.25A1.75 1.75 0 1 1 8.85 7.78C8.3 8.08 8 8.45 8 9V9.25" />
      <circle {...solid} stroke="none" cx="8" cy="11.5" r=".9" />
    </>
  ),
  // A gear: settings, everywhere (Home's Settings row, the Stage's header). A ring for the hub and eight short teeth around it.
  camera: (
    <>
      <rect x="1.75" y="4.25" width="8.5" height="7.5" rx="2" />
      <path d="M10.25 6.25 14.25 4.25V11.75L10.25 9.75" />
    </>
  ),

  // The canonical cog (Lucide's "settings", ISC), drawn on its 24 box scaled into 16, the stroke kept at the set's weight.
  gear: (
    <g transform="scale(0.6667)" strokeWidth="2.25">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </g>
  ),
  // An arrow down into a tray: add (import) from a file.
  import: <path d="M8 2.25V9.75M4.75 6.5 8 9.75 11.25 6.5M2.75 10.75V12.25A1 1 0 0 0 3.75 13.25H12.25A1 1 0 0 0 13.25 12.25V10.75" />,
  // A four-pointed spark: the effects.
  effects: <path d="M8 1.75Q8.5 7.5 14.25 8Q8.5 8.5 8 14.25Q7.5 8.5 1.75 8Q7.5 7.5 8 1.75Z" />,
  // A waveform's bars: what it hears.
  audio: <path d="M2.75 6.75V9.25M5.25 4.25V11.75M7.75 2.25V13.75M10.25 5.25V10.75M12.75 6.75V9.25" />,
  // A tag: a mood is one of the user's tags.
  mood: (
    <>
      <path d="M2.25 2.25H7.75L13.75 8.25 8.25 13.75 2.25 7.75Z" />
      <circle {...solid} stroke="none" cx="5.25" cy="5.25" r=".9" />
    </>
  ),
  // A fader's track and its cap.
  intensity: (
    <>
      <path d="M2.25 8H5.25M10.75 8H13.75" />
      <rect x="5.25" y="5.25" width="5.5" height="5.5" rx="1.25" />
    </>
  ),
  // Two axes with a few dots on them: the library map, presets laid out by what they look like.
  map: (
    <>
      <path d="M2.75 2.75V13.25H13.25" />
      <circle {...solid} stroke="none" cx="6" cy="9.5" r="1" />
      <circle {...solid} stroke="none" cx="9" cy="6.5" r="1" />
      <circle {...solid} stroke="none" cx="11.5" cy="9" r="1" />
      <circle {...solid} stroke="none" cx="7.5" cy="5" r="1" />
    </>
  ),
  // A ring that comes round to its start: moving on by itself, preset after preset, with no end.
  loop: <path d={LOOP_RING + LOOP_HEAD} />,
  // Three faders, their caps at different heights: the audio mixer.
  mixer: (
    <>
      <path d="M4 2.75V13.25M8 2.75V13.25M12 2.75V13.25" />
      <path strokeWidth="2.5" d="M2.75 10H5.25M6.75 5.5H9.25M10.75 8.5H13.25" />
    </>
  ),
  // A die showing five: a random preset.
  dice: (
    <>
      <rect x="2.75" y="2.75" width="10.5" height="10.5" rx="2.5" />
      <circle {...solid} stroke="none" cx="5.6" cy="5.6" r="1" />
      <circle {...solid} stroke="none" cx="10.4" cy="5.6" r="1" />
      <circle {...solid} stroke="none" cx="8" cy="8" r="1" />
      <circle {...solid} stroke="none" cx="5.6" cy="10.4" r="1" />
      <circle {...solid} stroke="none" cx="10.4" cy="10.4" r="1" />
    </>
  ),
};

/** The stroke, in the 16-unit box's units, for an icon `size` px across: 1.5 px at 16, 1/32 px more or less per px. */
export function strokeFor(size: number): number {
  const px = 1 + size / 32;
  return Math.round(((px * 16) / size) * 1000) / 1000;
}

/** One icon. */
export function Icon({ name, size = 16, label, className }: IconProps) {
  const style = { '--lib-icon-size': `${size}px`, '--lib-icon-stroke': strokeFor(size) } as CSSProperties;
  return (
    <ZenIcon className={className ? `vs-icon ${className}` : 'vs-icon'} data-icon={name} viewBox="0 0 16 16" label={label} style={style}>
      {GLYPHS[name]}
    </ZenIcon>
  );
}
