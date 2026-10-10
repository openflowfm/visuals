/**
 * What the inspector (Inspector.tsx) takes and reads about a preset: its
 * character, from the preset index's analysis (`LibraryRow.look`) with the
 * user's overrides laid over it (`Prepared`), as words and marks.
 */
import type { LibraryChange, LibraryRow, Level } from '../../api.ts';
import { colourOf, valueLabel, type Colour, type Prepared } from '../../librarySearch.ts';
import type { Playlist } from '../../playlists.ts';
import { tileBy, tileName } from '../../PresetTile.tsx';

/** What the inspector takes: the preset it is about, the library around it, and what it can do to them. */
export interface InspectorProps {
  /** The preset shown, with the user's star, never play and tags on it: the one playing, or one picked (in the field or a section); null when nothing plays and nothing is picked. */
  subject: Prepared | null;
  /** The index key of the preset playing, or null when nothing plays (or it isn't in the index). A subject that isn't it is "picked": the way back to now playing and Play show, and its dot stays marked in the field. */
  playing: string | null;
  /** Where the preset playing plays from ("from Warm-up · 3 of 10"); shown only while the subject is the one playing. */
  from: string;
  /** Every playlist (for "add to a playlist" and "in"); null until read. */
  playlists: Playlist[] | null;
  /** The library's rows, for the field: every one the index has measured is a dot. */
  library: readonly LibraryRow[];
  /** Change star / never play / tags on these preset keys. */
  onSet(keys: string[], change: LibraryChange): void;
  /** Add these preset paths to a manual playlist, by id. */
  onAddTo(playlist: string, paths: string[]): void;
  /** A dot in the field picked (click, or Enter on the keyboard's cursor): show this preset. A pick of the dot playing calls `onBack` instead. */
  onPick(row: LibraryRow): void;
  /** Back to the preset playing, from one picked. */
  onBack(): void;
  /** Play the one picked; without it no Play shows. */
  onPlay?(): void;
  /** Open it in the preset editor: lab builds only; without it no such action shows. */
  onEdit?(): void;
}

/** One of a preset's dominant hues. */
export interface Hue {
  /** In degrees. */
  hue: number;
  colour: Colour;
  /** A CSS colour for its swatch: the hue itself, at the swatches' lightness. */
  css: string;
}

/** One measure of the preset (brightness, speed, intensity): its level, its word, and where it sits on a 0–1 scale. */
export interface Measure {
  level: Level | null;
  word: string | null;
  /** 0 (least) to 1 (most); null when it wasn't measured. */
  at: number | null;
}

/** Everything the options show about one preset. */
export interface Character {
  name: string;
  /** Its authors joined with " & ", or '' when the index doesn't credit one. */
  by: string;
  style: string;
  subStyle: string | null;
  hues: Hue[];
  /** Drawn and measured, but no dominant hue. */
  grey: boolean;
  brightness: Measure;
  speed: Measure;
  intensity: Measure;
  /** Not drawn yet: no look to show. */
  unmeasured: boolean;
}

/** What brightness's levels read as (words.ts has no word for them: these are plain already). */
const BRIGHTNESS: Record<Level, string> = { low: 'dark', mid: 'dim', high: 'bright' };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * Where a measure sits on its scale. Brightness is mean luma, 0–1, as is. Speed
 * (block motion per step, about 0–8 over the pack) and intensity (frame
 * difference, 0–255 but rarely past 120) are skewed low, so they are read on a
 * square-root scale: the median preset lands near the middle.
 */
export const scaleOf = {
  brightness: (v: number) => clamp01(v),
  speed: (v: number) => clamp01(Math.sqrt(v / 8)),
  intensity: (v: number) => clamp01(Math.sqrt(v / 60)),
};

/** A hue's swatch colour, as the library's colour chips draw them. */
const hueCss = (hue: number) => `hsl(${Math.round(hue)} 72% 58%)`;

/** The preset's character, from its index row and the user's overrides. */
export function characterOf(p: Prepared): Character {
  const o = p.mine?.overrides ?? {};
  const look = p.row.look;
  const hues = (o.hues ?? look?.hues ?? []).map((hue) => ({ hue, colour: colourOf(hue), css: hueCss(hue) }));
  const measure = (level: Level | null | undefined, raw: number | null | undefined, word: (l: Level) => string, scale: (v: number) => number): Measure => ({
    level: level ?? null,
    word: level ? word(level) : null,
    at: raw === null || raw === undefined ? (level ? { low: 1 / 6, mid: 1 / 2, high: 5 / 6 }[level] : null) : scale(raw),
  });
  // An override changes the level only; the raw value then no longer says where it sits.
  const raw = <T>(over: unknown, v: T) => (over === undefined ? v : null);
  const by = tileBy(p.authors, '');
  return {
    name: tileName(p.title, p.row.path),
    by,
    style: p.style,
    subStyle: p.subStyle,
    hues,
    grey: look !== null && hues.length === 0,
    brightness: measure(o.brightness ?? look?.brightness_level, raw(o.brightness, look?.brightness), (l) => BRIGHTNESS[l], scaleOf.brightness),
    speed: measure(o.speed ?? look?.speed_level, raw(o.speed, look?.speed), (l) => valueLabel('speed', l), scaleOf.speed),
    intensity: measure(o.intensity ?? look?.intensity_level, raw(o.intensity, look?.intensity), (l) => valueLabel('intensity', l), scaleOf.intensity),
    unmeasured: look === null && o.hues === undefined,
  };
}

/** "x", "x and y", "x, y and z". */
export function listed(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** Its colours' names, each once, the strongest first. */
export const colourNames = (c: Character): string[] => [...new Set(c.hues.map((h) => h.colour))];

/** What the field says about the subject: "Slow and dark, among 250 presets". */
export function fieldSays(c: Character | null, count: number): string {
  const n = count.toLocaleString('en-US');
  const among = `among ${n} presets`;
  if (!c) return `The library: ${n} presets by speed and brightness`;
  const words = [c.speed.word, c.brightness.word].filter((w): w is string => !!w);
  if (c.unmeasured || !words.length) return `Not drawn yet, ${among}`;
  const said = listed(words);
  return `${said.charAt(0).toUpperCase()}${said.slice(1)}, ${among}`;
}
