/**
 * What the inspector options (app/src/layout/inspector/) read about a preset:
 * its character, from the preset index's analysis (`LibraryRow.look`) with the
 * user's overrides laid over it (`Prepared`), as words, marks and a sentence.
 * Every option shows the same facts; only how differs.
 */
import type { LibraryChange, LibraryRow, Level } from '../../api.ts';
import { colourOf, SWATCH, valueLabel, type Colour, type Prepared } from '../../librarySearch.ts';
import type { Playlist } from '../../playlists.ts';
import { tileBy, tileName } from '../../PresetTile.tsx';

/** What every option takes: the preset it is about, and what it can do to it. */
export interface InspectorProps {
  /** The preset shown: the one playing, or a tile picked in a section; null when nothing plays and nothing is picked. */
  subject: Prepared | null;
  /** The subject is a tile picked in a section, not the preset playing: a way back to now playing shows. */
  picked: boolean;
  /** Its picture: the preview's for the preset playing, the thumbnail for a tile picked. */
  picture: string | null;
  /** Where the preset playing plays from ("from Warm-up · 3 of 10"); '' for a tile picked or when nothing plays. */
  from: string;
  /** Every playlist (for "add to a playlist" and "in"); null until read. */
  playlists: Playlist[] | null;
  /** The library, for an option that places the preset among the rest. */
  library?: readonly LibraryRow[];
  /** Change star / never play / tags on these preset keys. */
  onSet(keys: string[], change: LibraryChange): void;
  /** Add these preset paths to a manual playlist, by id. */
  onAddTo(playlist: string, paths: string[]): void;
  /** Back to the preset playing (shown while `picked`). */
  onBack(): void;
  /** Play the picked preset (shown while `picked`). */
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

/** The swatch for a colour name, as the library's chips draw it. */
export const swatchOf = (c: Colour) => SWATCH[c];

/** "a" or "an" before `word`. */
const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

/** "x", "x and y", "x, y and z". */
export function listed(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** Its colours' names, each once, the strongest first. */
export const colourNames = (c: Character): string[] => [...new Set(c.hues.map((h) => h.colour))];

/**
 * A short line about the preset, built from its analysis in plain words:
 * "A slow, dark, calm hypnotic piece by geiss & rovastar. Mostly purple and red."
 * Only what was measured is said; an undrawn preset is its style and authors.
 */
export function describe(c: Character): string {
  const adjectives = [c.speed.word, c.brightness.word, c.intensity.word].filter((w): w is string => !!w);
  const kind = `${c.style.toLowerCase()} piece`;
  const lead = adjectives.length ? `${adjectives.join(', ')} ${kind}` : kind;
  const first = `${article(lead)} ${lead}${c.by ? ` by ${c.by}` : ''}.`;
  const colours = colourNames(c);
  const second = colours.length ? `Mostly ${listed(colours)}.` : c.grey ? 'Grey, without a colour of its own.' : '';
  const line = `${first} ${second}`.trim();
  return line.charAt(0).toUpperCase() + line.slice(1);
}
