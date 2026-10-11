import type { ReactNode } from 'react';
import { Icon, strokeFor, type IconName } from '../icons.tsx';

/**
 * Live's glyphs for the concepts (stories only): the ones Home's set
 * (`layout/icons.tsx`) doesn't have, drawn by its rules so the two read as one
 * set — a 16-unit grid, one stroke of 1.5 at 16 px (`strokeFor`), round caps
 * and joins, straight strokes on a quarter unit, containers with 2-unit
 * corners. A name Home's set has is drawn by it. If a concept is chosen, these
 * move into `icons.tsx`.
 */

export const LIVE_GLYPHS = ['random', 'hold', 'strobe', 'blackout', 'freeze', 'beat', 'link', 'output', 'fullscreen', 'help', 'settings', 'effects', 'audio', 'mood', 'intensity'] as const;
export type LiveGlyph = (typeof LIVE_GLYPHS)[number];
export type GlyphName = LiveGlyph | IconName;

const solid = { fill: 'currentColor' } as const;

const GLYPHS: Record<LiveGlyph, ReactNode> = {
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
  // Two sliders: settings.
  settings: (
    <>
      <path d="M2.25 4.75H3.75M7.25 4.75H13.75M2.25 11.25H8.75M12.25 11.25H13.75" />
      <circle cx="5.5" cy="4.75" r="1.75" />
      <circle cx="10.5" cy="11.25" r="1.75" />
    </>
  ),
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
};

const isLive = (name: GlyphName): name is LiveGlyph => (LIVE_GLYPHS as readonly string[]).includes(name);

/** One glyph: Live's own, or Home's by the same name. */
export function Glyph({ name, size = 16, label, className }: { name: GlyphName; size?: number; label?: string; className?: string }) {
  if (!isLive(name)) return <Icon name={name} size={size} label={label} className={className} />;
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
