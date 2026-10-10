/**
 * What the stories run on: the app's state as its commands would return it,
 * made from a slice of the bundled starter set (`app/src-tauri/presets/starter/
 * cream-of-the-crop/`): its real `index.json` rows and real thumbnails. Only
 * Storybook imports this (`.storybook/`, `*.stories.tsx`); the app's build never
 * sees it. `backend.ts` serves it to the page as the Tauri commands.
 */
import type * as api from '../api.ts';
import type * as fx from '../fx.ts';
import type * as link from '../link.ts';
import type * as output from '../output.ts';
import type * as pack from '../pack.ts';
import * as pl from '../playlists.ts';
import index from '../../src-tauri/presets/starter/cream-of-the-crop/index.json';

/** Where the app keeps the starter set; the rows' and entries' paths are under it. */
export const STARTER = '/Applications/visual[flow].app/Contents/Resources/presets/starter';
const PACK = 'cream-of-the-crop';

/** The starter thumbnails as URLs an `<img>` can load, by file name (the app serves them on `thumb:`). */
const thumbFiles = import.meta.glob<string>('../../src-tauri/presets/starter/cream-of-the-crop/thumbnails/*.webp', { eager: true, query: '?url', import: 'default' });
const thumbs = new Map(Object.entries(thumbFiles).map(([file, url]) => [file.split('/').pop()!, url]));
export const thumbUrl = (file: string | null): string | null => (file ? (thumbs.get(file) ?? null) : null);

interface IndexRow {
  path: string;
  hash: string;
  style: string;
  sub_style: string | null;
  authors: string[];
  title: string;
  thumbnail: string | null;
  look: api.Look | null;
}
const all = index.rows as IndexRow[];

/** Kept whichever slice is taken: the long names and the ones only a number (the tile shows the file name instead). */
const ALWAYS = ['Sparkle/Glimmer/385.milk', 'Supernova/Stars/138.milk', 'Fractal/Core Mirror/va ultramix2 - 323.milk'];
/** How many of each style the slice has. */
const PER_STYLE = 6;

const toRow = (r: IndexRow): api.LibraryRow => ({
  key: `${PACK}/${r.path}`,
  path: `${STARTER}/${PACK}/${r.path}`,
  hash: r.hash,
  style: r.style,
  sub_style: r.sub_style,
  authors: r.authors,
  title: r.title,
  thumbnail: thumbUrl(r.thumbnail),
  look: r.look,
  starter: true,
  curated: true,
});

const seen = new Map<string, number>();
/** The library: six presets of each of the ten styles, and the odd names, sorted by key as Rust sorts them. */
export const ROWS: api.LibraryRow[] = all
  .filter((r) => {
    const n = seen.get(r.style) ?? 0;
    seen.set(r.style, n + 1);
    return n < PER_STYLE || ALWAYS.includes(r.path);
  })
  .map(toRow)
  .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

/** `presets`: the files, as the app lists them. */
export const ENTRIES: api.Entry[] = ROWS.map((r) => {
  const rel = r.path.slice(STARTER.length + 1);
  return {
    path: r.path,
    name: rel
      .split('/')
      .pop()!
      .replace(/\.milk$/i, ''),
    group: rel.split('/').slice(0, -1).join('/'),
  };
});

/** The row at `n`, wrapping. */
export const row = (n: number): api.LibraryRow => ROWS[((n % ROWS.length) + ROWS.length) % ROWS.length];
/** A row found by part of its title. */
export const rowTitled = (part: string): api.LibraryRow => ROWS.find((r) => r.title.includes(part)) ?? ROWS[0];
/** The longest-named row, for the long name states. */
export const LONG = ROWS.reduce((a, b) => (b.title.length > a.title.length ? b : a));

/** A playlist item for a row. */
export const itemOf = (r: api.LibraryRow): pl.Item => {
  const rel = r.path.slice(STARTER.length + 1);
  return {
    path: r.path,
    name: rel
      .split('/')
      .pop()!
      .replace(/\.milk$/i, ''),
    group: rel.split('/').slice(-2, -1)[0] ?? '',
    missing: false,
    hash: r.hash,
  };
};

/** `library.json`: some starred, rated and tagged (the tags are live mode's moods), one never played. */
export const DATA: api.LibraryData = {
  version: 1,
  presets: {
    [row(0).key]: { star: true, rating: 5, tags: ['warm-up'] },
    [row(3).key]: { star: true, tags: ['warm-up', 'chill'] },
    [row(8).key]: { star: true, rating: 4, tags: ['peak'] },
    [row(14).key]: { tags: ['peak'] },
    [row(21).key]: { star: true, tags: ['peak', 'strobe-safe'] },
    [row(27).key]: { tags: ['chill'] },
    [row(33).key]: { rating: 3, tags: ['chill'] },
    [row(40).key]: { hidden: true },
    [row(45).key]: { star: true, tags: ['closing'] },
  },
};

/** A manual playlist: ten presets, a change every 30 s in order. */
export const WARM_UP: pl.Playlist = {
  id: 'p-warm-up',
  name: 'Warm-up',
  kind: 'manual',
  query: null,
  items: [0, 3, 7, 12, 18, 24, 30, 36, 42, 50].map((n) => itemOf(row(n))),
  settings: { ...pl.DEFAULT_SETTINGS, change: { unit: 'seconds', every: 30 }, transition: 3 },
};

/** A second manual playlist, changing on the bar lines, one of its files gone. */
export const CLOSING: pl.Playlist = {
  id: 'p-closing',
  name: 'Closing set, Saturday',
  kind: 'manual',
  query: null,
  items: [...[45, 5, 16, 28].map((n) => itemOf(row(n))), { path: `${STARTER}/${PACK}/Hypnotic/Gone/missing preset.milk`, name: 'missing preset', group: 'Gone', missing: true, hash: null }],
  settings: { ...pl.DEFAULT_SETTINGS, change: { unit: 'bars', every: 8 }, order: 'shuffle', transition: 4, trails: 0.3 },
};

/** A smart playlist of the user's own: bright and fast. */
export const BRIGHT_FAST: pl.Playlist = {
  id: 's-bright-fast',
  name: 'Bright and fast',
  kind: 'smart',
  query: { groups: { speed: ['high'], colour: [] }, text: '' },
  items: [],
  settings: { ...pl.DEFAULT_SETTINGS, change: { unit: 'seconds', every: 15 }, order: 'shuffle', transition: 1, speed: 1.5 },
};

/** The home's starter smart playlists, already made (`home.ts`'s `STARTERS`), so a story never seeds them. */
export const STARTER_LISTS: pl.Playlist[] = [
  {
    id: 's-calm',
    name: 'Calm',
    kind: 'smart',
    starter: 'calm',
    query: { groups: { speed: ['low', 'mid'], intensity: ['low'] }, text: '' },
    items: [],
    settings: { ...pl.DEFAULT_SETTINGS, change: { unit: 'seconds', every: 45 }, order: 'shuffle', transition: 5 },
  },
  {
    id: 's-peak-time',
    name: 'Peak-time',
    kind: 'smart',
    starter: 'peak-time',
    query: { groups: { speed: ['mid', 'high'], intensity: ['high'] }, text: '' },
    items: [],
    settings: { ...pl.DEFAULT_SETTINGS, change: { unit: 'seconds', every: 15 }, order: 'shuffle', transition: 1 },
  },
  {
    id: 's-recent',
    name: 'Recently played',
    kind: 'smart',
    starter: 'recently-played',
    query: { groups: {}, text: '', recent: 50 },
    items: [],
    settings: { ...pl.DEFAULT_SETTINGS },
  },
];

export const PLAYLISTS: pl.Playlist[] = [WARM_UP, CLOSING, ...STARTER_LISTS, BRIGHT_FAST];

/** The deck with nothing loaded. */
export const IDLE_DECK: pl.Deck = pl.EMPTY_DECK;

/** The deck playing Warm-up, the third of ten, auto-advancing. */
export const PLAYING_DECK: pl.Deck = {
  playlist: WARM_UP.id,
  index: 2,
  auto: true,
  seconds: 30,
  current: WARM_UP.items[2].path,
  hold: false,
  bars: 0,
  order: 'in_order',
  settings: WARM_UP.settings,
  differs: [],
  next: WARM_UP.items[3].path,
  next_index: 3,
  count: WARM_UP.items.length,
  query: null,
};

/** The deck playing a mood (an unsaved filter of the tag "peak"), held, with the speed tweaked live. */
export const MOOD_DECK: pl.Deck = {
  ...PLAYING_DECK,
  playlist: null,
  index: null,
  current: row(8).path,
  hold: true,
  settings: null,
  differs: ['speed'],
  next: row(14).path,
  next_index: 1,
  count: 3,
  query: { groups: { tags: ['peak'] }, text: '' },
};

export const LISTS: pl.Lists = { playlists: PLAYLISTS, deck: PLAYING_DECK };

/** `fx_state`: every effect as normal, at the Link session's 124 BPM. */
export const FX: fx.Fx = {
  speed: 1,
  freeze: false,
  transition: 3,
  strobe: false,
  strobe_rate: 1,
  strobe_intensity: 1,
  strobe_style: 'white',
  sync: 'tempo',
  blackout: false,
  blackout_fade: 1,
  punch: false,
  punch_on_beat: false,
  brightness: 1,
  hue: 0,
  invert: false,
  mirror: 'off',
  trails: 0,
  sensitivity: 1,
  bpm: 124,
  linked: true,
  hold: false,
  bars: 8,
};

/** Live mid-set: the speed up, the mirror on, trails, held. */
export const FX_BUSY: fx.Fx = { ...FX, speed: 1.5, mirror: 'quad', trails: 0.4, hue: 0.2, hold: true, punch_on_beat: true };

/** `link_state`: a Link session of two peers, playing, three beats into bar 17, changing every 8 bars. */
export const LINK: link.Frame = {
  enabled: true,
  tempo: 124,
  peers: 2,
  playing: true,
  beat: 66.5,
  phase: 2.5,
  quantum: 4,
  one: 0,
  bar: 17,
  beatInBar: 3,
  barPhase: 2.5,
  every: { every: 8, unit: 'bars' },
  next: 96,
  at: 0,
};

/** Link off: no session, the clock at the last tempo. */
export const LINK_OFF: link.Frame = { ...LINK, enabled: false, peers: 0, playing: false, every: { every: 0, unit: 'bars' }, next: null };

export const DISPLAYS: output.Display[] = [
  { id: 1, index: 0, name: 'Built-in Retina Display', width: 3024, height: 1964, main: true },
  { id: 2, index: 1, name: 'Projector (HDMI)', width: 1920, height: 1080, main: false },
];

/** The live output open full screen on the projector. */
export const OUTPUT_ON: output.Status = { display: DISPLAYS[1], size: [1920, 1080] };
export const OUTPUT_OFF: output.Status = { display: null, size: null };

/** The starter set only; the full pack not downloaded. */
export const PACK_STATUS: pack.PackStatus = { starter: 250, installed: 0, total: 9795, size: 187_000_000, state: 'idle', received: 0, error: null };

export const QUALITY: api.Quality = { chosen: 'auto', effective: 'high', reason: 'Auto: 60 frames a second at high on this Mac' };
export const MOTION: api.Motion = { reduced: false, system: true };

/** One crash kept, not sent. */
export const CRASHES: api.CrashReport[] = [
  {
    id: 'c-2026-10-09',
    when: 1_791_590_400,
    summary: "The renderer stopped: a preset's shader made the GPU time out",
    text: 'visual[flow] 0.5.0 (macOS 26.1, Apple M3 Pro)\n\nthread main panicked at engine/src/render.rs:812:\nGPU device lost while drawing "Tripgnosis - Wormhole.milk"\n\n0: visuals_engine::render::Renderer::draw\n1: visuals::bench::frame',
    sent: false,
  },
];

export const UPDATE: api.Update = {
  version: '0.6.0',
  date: '2026-10-08T12:00:00Z',
  notes:
    '## What’s new\n\n- Home is near borderless, an instrument rather than a form.\n- Instrument Sans everywhere, with tabular figures for numbers.\n- The main window is frosted glass.\n\n## Fixed\n\n- The playing row is no longer cut off at the top.',
};

export const SOURCES: api.AudioSources = {
  taps: true,
  sources: [
    { id: { kind: 'system' }, name: 'Everything the Mac plays', channels: 2 },
    { id: { kind: 'app', bundle: 'com.ableton.live' }, name: 'Ableton Live 12', channels: 2 },
    { id: { kind: 'device', name: 'BlackHole 16ch', size: 16 }, name: 'BlackHole 16ch', channels: 16 },
    { id: { kind: 'device', name: 'MacBook Pro Microphone', size: 1 }, name: 'MacBook Pro Microphone', channels: 1 },
  ],
};

export const HEARD: api.Heard = { choice: { name: 'Ableton Live 12', left: 1, right: 2, size: 2 }, channels: 2 };

/** The presets played lately, newest first. */
export const RECENT: string[] = [row(7).path, row(3).path, row(0).path, row(21).path, row(14).path];

/** A starter thumbnail as the native preview's stand-in: the picture the stories show where the engine would draw. */
export const STILL: string = rowTitled('Wormhole').thumbnail ?? row(0).thumbnail!;
