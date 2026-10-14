/**
 * What the inspector (Inspector.tsx) takes and reads about a preset: its
 * character, from the preset index's analysis (`LibraryRow.look`) with the
 * user's overrides laid over it (`Prepared`), as words and marks.
 */
import type { ReactNode } from 'react';
import { TUNE_MAX, TUNE_MIN, type LibraryChange, type LibraryRow, type Level, type Look, type Mine, type Overrides } from './api';
import { colourOf, valueLabel, type Colour, type Prepared } from './librarySearch';
import type { Playlist } from './playlists';
import type { AxisId } from './field';
// UI import: PresetTile.tsx (pure helpers), where the screen port puts it.
import { tileBy, tileName } from '../PresetTile/PresetTile';

/** What the inspector takes: the preset it is about, the library around it, and what it can do to them. */
export interface InspectorProps {
  /** The preset the details show, with the user's star, never play and tags on it: the one playing, or one picked (a tile in a section); null when nothing plays and nothing is picked. */
  subject: Prepared | null;
  /** The index key of the preset playing, or null when nothing plays (or it isn't in the index). A subject that isn't it is "picked": the way back to now playing and Play show. Its dot is the one the library map lights. */
  playing: string | null;
  /** The preset playing, with the user's data on it, for the library map's lit dot (its hue and ring), whatever the details show; null when nothing plays. Left out, the map lights the subject when it is the one playing, and none otherwise. */
  playingPreset?: Prepared | null;
  /** Where the preset playing plays from ("from Warm-up · 3 of 10"). Not shown: the transport bar says it, and the inspector's top is the name. */
  from: string;
  /** Every playlist (for "add to a playlist" and "in"); null until read. */
  playlists: Playlist[] | null;
  /** The library's rows, for the library map: every one the index has measured is a dot. */
  library: readonly LibraryRow[];
  /** What the user keeps about each preset, by key (`library.json`'s presets): their speed and brightness overrides move its dot on the map. */
  mine?: Readonly<Record<string, Mine>>;
  /** Change star / never play / tags on these preset keys. */
  onSet(keys: string[], change: LibraryChange): void;
  /** Add these preset paths to a manual playlist, by id. */
  onAddTo(playlist: string, paths: string[]): void;
  /** A dot in the library map picked (click, or Enter on the keyboard's cursor): play this preset. A pick of the dot playing calls `onBack` instead while the details show something else, and nothing while they show it. */
  onPick(row: LibraryRow): void;
  /** Back to the preset playing, from one picked. */
  onBack(): void;
  /** Play the one picked; without it no Play shows. */
  onPlay?(): void;
  /** Open it in the preset editor: lab builds only; without it no such action shows. */
  onEdit?(): void;
  /** Several presets picked together: with two or more the inspector is about them ("n selected": star, add, never play and tags over all), whatever `subject` is; one or none is ignored. */
  chosen?: Prepared[];
  /** The source (a playlist's head, `PlaylistHead variant='inspector'`), shown in the details when `subject` is null and fewer than two are chosen (the library map stays under it). */
  source?: ReactNode;
  /** Something that failed: one alert line under whatever the details show. */
  error?: string | null;
  /** Close the inspector: with it a ✕ shows, and Escape anywhere in the window (not typed in a text box, nor taken by a popover or the tag box) calls it; pass it only when laid over. */
  onClose?(): void;
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

/** Where a measure sits, 0–1: its raw value on its scale, or its level's middle when there is no raw value; null with neither. */
const atOf = (level: Level | null | undefined, raw: number | null | undefined, scale: (v: number) => number): number | null =>
  raw === null || raw === undefined ? (level ? { low: 1 / 6, mid: 1 / 2, high: 5 / 6 }[level] : null) : scale(raw);
// An override changes the level only; the raw value then no longer says where it sits.
const raw = <T>(over: unknown, v: T) => (over === undefined ? v : null);

/** Where a preset sits by speed and brightness, 0–1, as `characterOf` reads it (the user's overrides applied); null for one not measured. */
export function placeOf(look: Look | null, o: Overrides = {}): { speed: number | null; brightness: number | null } {
  return {
    speed: atOf(o.speed ?? look?.speed_level, raw(o.speed, look?.speed), scaleOf.speed),
    brightness: atOf(o.brightness ?? look?.brightness_level, raw(o.brightness, look?.brightness), scaleOf.brightness),
  };
}

/** The preset's character, from its index row and the user's overrides. */
export function characterOf(p: Prepared): Character {
  const o = p.mine?.overrides ?? {};
  const look = p.row.look;
  const hues = (o.hues ?? look?.hues ?? []).map((hue) => ({ hue, colour: colourOf(hue), css: hueCss(hue) }));
  const measure = (level: Level | null | undefined, raw: number | null | undefined, word: (l: Level) => string, scale: (v: number) => number): Measure => ({
    level: level ?? null,
    word: level ? word(level) : null,
    at: atOf(level, raw, scale),
  });
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

/** A preset's own speed and sensitivity, each a multiplier: 1 (as made) where `library.json` keeps none. */
export interface Tune {
  speed: number;
  sensitivity: number;
}

/** What the user keeps about a preset, as its tune: 1 for either left out. */
export const tuneOf = (mine: Mine | null | undefined): Tune => ({ speed: mine?.tune?.speed ?? 1, sensitivity: mine?.tune?.sensitivity ?? 1 });

/** Played as made: neither differs from 1. */
export const asMade = (t: Tune): boolean => t.speed === 1 && t.sensitivity === 1;

/**
 * The tune sliders run on a log taper, as the live effects' speed and
 * sensitivity do: the position is the multiplier's log2, −2 (¼×) to 2 (4×),
 * 1× in the middle and every doubling the same distance. A position lands on
 * twelfths of a doubling (about 6% apart), so 1× is a detent the drag and the
 * arrow keys both stop on, and what is kept reads cleanly.
 */
export const TUNE_POSITION_MIN = Math.log2(TUNE_MIN);
export const TUNE_POSITION_MAX = Math.log2(TUNE_MAX);
export const TUNE_STEPS_PER_DOUBLING = 12;
/** How many positions the slider has, ends included. */
export const TUNE_STEPS = (TUNE_POSITION_MAX - TUNE_POSITION_MIN) * TUNE_STEPS_PER_DOUBLING + 1;

/** A slider position as the multiplier kept: clamped, on its twelfth, exactly 1 at the centre, three decimals. */
export function tuneAt(position: number): number {
  if (!Number.isFinite(position)) return 1;
  const p = Math.round(Math.min(TUNE_POSITION_MAX, Math.max(TUNE_POSITION_MIN, position)) * TUNE_STEPS_PER_DOUBLING) / TUNE_STEPS_PER_DOUBLING;
  return p === 0 ? 1 : Number((2 ** p).toFixed(3));
}

/** A multiplier's place on the slider, −2 to 2; out of range clamps, and one not a positive number is the centre. */
export function tunePosition(multiplier: number): number {
  if (!Number.isFinite(multiplier) || multiplier <= 0) return 0;
  return Math.min(TUNE_POSITION_MAX, Math.max(TUNE_POSITION_MIN, Math.log2(multiplier)));
}

/** The detents: ¼×, ½×, 1×, 2× and 4×, each a doubling apart, where a drag catches and the arrow keys stop. */
export const TUNE_DETENTS: readonly number[] = [0.25, 0.5, 1, 2, 4];
/** How near a detent (in doublings) a drag is caught by it: about a sixth of a doubling. */
export const TUNE_CATCH = 1 / 6;

const FRACTIONS: Record<number, string> = { 0.25: '¼', 0.5: '½', 1: '1', 2: '2', 4: '4' };

/** A detent's label under the rail: "¼", "½", "1", "2", "4". */
export const detentSays = (detent: number): string => FRACTIONS[detent] ?? String(detent);

/** A multiplier as the readout says it: a fraction on a detent ("½×", "1×"), two decimals between ("0.71×"). */
export function tuneSays(multiplier: number): string {
  const f = FRACTIONS[multiplier];
  return f ? `${f}×` : `${multiplier.toFixed(2)}×`;
}

/** The next detent above (`way` 1) or below (`way` −1) a multiplier; an end stays where it is. */
export function tuneStepped(multiplier: number, way: 1 | -1): number {
  const eps = 1e-9;
  if (way > 0) return TUNE_DETENTS.find((d) => d > multiplier + eps) ?? TUNE_DETENTS[TUNE_DETENTS.length - 1];
  return [...TUNE_DETENTS].reverse().find((d) => d < multiplier - eps) ?? TUNE_DETENTS[0];
}

/** A multiplier nudged one twelfth of a doubling up or down (onto the twelfths `tuneAt` keeps). */
export const tuneNudged = (multiplier: number, way: 1 | -1): number => tuneAt(tunePosition(multiplier) + way / TUNE_STEPS_PER_DOUBLING);

const TYPED_FRACTIONS: Record<string, number> = { '¼': 0.25, '½': 0.5, '¾': 0.75 };

/**
 * A multiplier typed into the readout: "0.5", ".75", "1/2", "½", "2x" or "2×";
 * clamped to ¼–4 and kept to three decimals. Null for anything else (nothing,
 * words, zero or less), which leaves the value as it was.
 */
export function tuneTyped(text: string): number | null {
  const t = text.replace(/\s*[x×]?\s*$/i, '').trim();
  let n: number;
  const frac = /^(\d*\.?\d+)\s*\/\s*(\d*\.?\d+)$/.exec(t);
  if (Object.hasOwn(TYPED_FRACTIONS, t)) n = TYPED_FRACTIONS[t];
  else if (frac) n = Number(frac[1]) / Number(frac[2]);
  else if (/^(\d+\.?\d*|\.\d+)$/.test(t)) n = Number(t);
  else return null;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Number(Math.min(TUNE_MAX, Math.max(TUNE_MIN, n)).toFixed(3));
}

/** The one value several presets share for `which`, or null when they differ ("Mixed"); 1 for none. */
export function tuneShared(tunes: readonly Tune[], which: keyof Tune): number | null {
  if (!tunes.length) return 1;
  const first = tunes[0][which];
  return tunes.every((t) => t[which] === first) ? first : null;
}

/** How the field's words name an axis ("by speed and brightness"). */
const AXIS_NAMES: Record<AxisId, string> = { speed: 'speed', brightness: 'brightness', intensity: 'intensity', hue: 'hue', colourfulness: 'colourfulness', rating: 'my rating', style: 'style' };
/** A preset's word on an axis ("slow", "dark", "red"), or null where it has none (rating; colourfulness unless grey). */
const AXIS_WORD: Record<AxisId, (c: Character) => string | null> = {
  speed: (c) => c.speed.word,
  brightness: (c) => c.brightness.word,
  intensity: (c) => c.intensity.word,
  hue: (c) => c.hues[0]?.colour ?? null,
  colourfulness: (c) => (c.grey ? 'grey' : null),
  rating: () => null,
  style: (c) => c.style || null,
};

/**
 * What the field says about the preset playing on its axes (`axes`, across then up; speed and
 * brightness when left out): "Slow and dark, among 9,791 presets"; an axis with no word for the
 * preset is left out, and with neither it says "On the map".
 * `count` is how many presets the field draws (those measured) and `total` how
 * many the library holds: the count is said only when the field draws them all,
 * so a library of 9,791 with 250 measured never reads "among 250 presets".
 */
export function fieldSays(c: Character | null, count: number, total: number = count, axes: readonly [AxisId, AxisId] = ['speed', 'brightness']): string {
  const n = count.toLocaleString('en-US');
  const all = count >= total;
  const among = all ? `, among ${n} presets` : '';
  const by = axes.map((a) => AXIS_NAMES[a]).join(' and ');
  if (!c) return all ? `The library: ${n} presets by ${by}` : `The library by ${by}: ${n} of its ${total.toLocaleString('en-US')} presets drawn so far`;
  if (c.unmeasured) return `Not drawn yet${among}`;
  const words = axes.map((a) => AXIS_WORD[a](c)).filter((w): w is string => !!w);
  if (!words.length) return `On the map${among}`;
  const said = listed(words);
  return `${said.charAt(0).toUpperCase()}${said.slice(1)}${among}`;
}
