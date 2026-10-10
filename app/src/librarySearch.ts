import type { Entry, LibraryData, LibraryGroup, LibraryQuery, LibraryRow, Level, Mine } from './api.ts';
import { say } from './words.ts';

/*
 * The library's search and groups (facets): rows from `library_index` with the
 * user's own data laid over them, filtered by a `LibraryQuery` (AND across groups,
 * OR within one, and every word of the text), with live counts for each group's values.
 */

export interface Found {
  shown: Entry[];
  matched: number;
  total: number;
}

const wordsOf = (text: string) => text.toLowerCase().split(/\s+/).filter(Boolean);

/** Entries matching every word of `query` (case-insensitive, against `${group} ${name}`); the App steps through these. */
export function searchLibrary(entries: Entry[], query: string): Found {
  const words = wordsOf(query);
  const hits = words.length
    ? entries.filter((e) => {
        const text = `${e.group} ${e.name}`.toLowerCase();
        return words.every((w) => text.includes(w));
      })
    : entries;
  return { shown: hits, matched: hits.length, total: entries.length };
}

/** The groups in the order their chips show. */
export const GROUPS: readonly LibraryGroup[] = ['style', 'author', 'colour', 'speed', 'intensity', 'star', 'tags'];

/** What each group's chip says. */
export const GROUP_LABEL: Record<LibraryGroup, string> = {
  style: 'style',
  author: 'author',
  colour: 'colour',
  speed: 'speed',
  intensity: 'intensity',
  star: '★',
  tags: say('user tags'),
};

/** The groups read from the index's look, which the rows made from entries don't have. */
export const LOOK_GROUPS: readonly LibraryGroup[] = ['colour', 'speed', 'intensity'];

/** The colour group's values, in hue order; `grey` is a drawn preset with no dominant hue. */
export const COLOURS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink', 'grey'] as const;
export type Colour = (typeof COLOURS)[number];

/** The colour name for a hue in degrees. */
export function colourOf(hue: number): Colour {
  const h = ((hue % 360) + 360) % 360;
  if (h < 15 || h >= 345) return 'red';
  if (h < 45) return 'orange';
  if (h < 75) return 'yellow';
  if (h < 165) return 'green';
  if (h < 195) return 'cyan';
  if (h < 255) return 'blue';
  if (h < 285) return 'purple';
  return 'pink';
}

/** A swatch for each colour value, for its chip. */
export const SWATCH: Record<Colour, string> = {
  red: 'hsl(0 75% 55%)',
  orange: 'hsl(30 85% 55%)',
  yellow: 'hsl(55 85% 55%)',
  green: 'hsl(120 55% 45%)',
  cyan: 'hsl(180 65% 45%)',
  blue: 'hsl(220 75% 60%)',
  purple: 'hsl(270 60% 60%)',
  pink: 'hsl(315 70% 62%)',
  grey: 'hsl(0 0% 55%)',
};

const LEVELS: readonly Level[] = ['low', 'mid', 'high'];
// The stored values stay low / mid / high; these are what the chips and the drawer say.
const SPEED: Record<Level, string> = { low: say('speed low'), mid: say('speed mid'), high: say('speed high') };
const INTENSITY: Record<Level, string> = { low: say('intensity low'), mid: say('intensity mid'), high: say('intensity high') };

/** A sub-style's value in the style group: `Style/Sub` (folder names hold no `/`). */
export const subStyleValue = (style: string, sub: string) => `${style}/${sub}`;

/** The value the star group has. */
export const STARRED = 'starred';

/** What a group's value reads as on its chip. */
export function valueLabel(group: LibraryGroup, value: string): string {
  switch (group) {
    case 'style': {
      const at = value.indexOf('/');
      return at < 0 ? value : `${value.slice(0, at)} › ${value.slice(at + 1)}`;
    }
    case 'speed':
      return SPEED[value as Level] ?? value;
    case 'intensity':
      return INTENSITY[value as Level] ?? value;
    case 'star':
      return '★ starred';
    default:
      return value;
  }
}

/** A row with the user's data laid over it: what the grid, the groups and the drawer read. */
export interface Prepared {
  row: LibraryRow;
  mine: Mine | undefined;
  style: string;
  subStyle: string | null;
  authors: string[];
  title: string;
  star: boolean;
  hidden: boolean;
  tags: string[];
  /** Each group's values for this row. */
  values: Record<LibraryGroup, string[]>;
  /** Lower-cased words the search text is matched against. */
  text: string;
}

/** One row, with `mine` (the user's data for it) laid over the index's values. */
export function prepareRow(row: LibraryRow, mine: Mine | undefined): Prepared {
  const o = mine?.overrides ?? {};
  const style = o.style ?? row.style;
  const subStyle = o.sub_style ?? row.sub_style;
  const authors = o.authors ?? row.authors;
  const title = o.title ?? row.title;
  const hues = o.hues ?? row.look?.hues ?? null;
  const drawn = row.look !== null || o.hues !== undefined;
  const speed = o.speed ?? row.look?.speed_level ?? null;
  const intensity = o.intensity ?? row.look?.intensity_level ?? null;
  const tags = mine?.tags ?? [];
  const star = mine?.star ?? false;
  const colours: string[] = [];
  if (hues && hues.length) {
    for (const h of hues) {
      const c = colourOf(h);
      if (!colours.includes(c)) colours.push(c);
    }
  } else if (drawn) {
    colours.push('grey');
  }
  return {
    row,
    mine,
    style,
    subStyle,
    authors,
    title,
    star,
    hidden: mine?.hidden ?? false,
    tags,
    values: {
      style: subStyle ? [style, subStyleValue(style, subStyle)] : [style],
      author: authors,
      colour: colours,
      speed: speed ? [speed] : [],
      intensity: intensity ? [intensity] : [],
      star: star ? [STARRED] : [],
      tags,
    },
    text: `${row.key} ${style} ${subStyle ?? ''} ${authors.join(' ')} ${title} ${tags.join(' ')}`.toLowerCase(),
  };
}

/** Every row prepared with the user's data. */
export const prepare = (rows: readonly LibraryRow[], data: LibraryData | null): Prepared[] => rows.map((r) => prepareRow(r, data?.presets[r.key]));

/**
 * Library rows for entries no index has read (outside the app, or when the index
 * fails), by the index's rules: style from the folder under the pack's, sub-style from the next,
 * curated when from the starter set, no look or thumbnail.
 */
export function rowsFromEntries(entries: readonly Entry[]): LibraryRow[] {
  return entries.map((e) => {
    // The index keys a preset by its path under the presets folder, `/`-joined (`{pack}/{path}`).
    const group = e.group.replace(/\\/g, '/');
    const file = e.path.split(/[\\/]/).pop() || `${e.name}.milk`;
    // As the index does: within a pack (`{pack}/{style}/{sub}/…`) the style is the folder under the pack's;
    // a preset straight in its pack's folder takes the pack as its style.
    const folders = group ? group.split('/') : [];
    const [style = '', sub] = folders.length > 1 ? folders.slice(1) : folders;
    // Curated as Rust marks it: from the bundled starter set (its folder is `…/presets/starter`).
    const starter = /[\\/]presets[\\/]starter[\\/]/.test(e.path);
    return {
      key: group ? `${group}/${file}` : file,
      path: e.path,
      hash: '',
      style,
      sub_style: sub ?? null,
      authors: [],
      title: e.name,
      thumbnail: null,
      look: null,
      starter,
      curated: starter,
    };
  });
}

/**
 * Answers applied in the order they were asked for: `ticket()` before asking,
 * `take(t)` with the answer, which is false for one older than the newest applied.
 */
export function inOrder() {
  let issued = 0;
  let applied = 0;
  return {
    ticket: () => ++issued,
    take: (t: number) => (t > applied ? ((applied = t), true) : false),
  };
}

/**
 * `read` with at most one call in flight: a `run()` while one is out marks it dirty,
 * and it reads exactly once more when that one ends. Answers older than the last applied are dropped.
 */
export function oneAtATime<T>(read: () => Promise<T>, apply: (value: T) => void) {
  let busy = false;
  let dirty = false;
  let stopped = false;
  const order = inOrder();
  const run = (): void => {
    if (stopped) return;
    if (busy) {
      dirty = true;
      return;
    }
    busy = true;
    dirty = false;
    const t = order.ticket();
    const done = () => {
      busy = false;
      if (dirty) run();
    };
    read().then((v) => {
      if (!stopped && order.take(t)) apply(v);
      done();
    }, done);
  };
  return { run, stop: () => void (stopped = true) };
}

export const emptyQuery = (text = ''): LibraryQuery => ({ groups: {}, text });

/** The groups `query` filters by (with at least one value). */
export const activeGroups = (query: LibraryQuery): LibraryGroup[] => GROUPS.filter((g) => (query.groups[g]?.length ?? 0) > 0);

/** True when `query` filters by nothing. */
export const isEmpty = (query: LibraryQuery) => !activeGroups(query).length && !query.text.trim();

/** `query` with `value` turned on or off in `group`. */
export function toggle(query: LibraryQuery, group: LibraryGroup, value: string): LibraryQuery {
  const now = query.groups[group] ?? [];
  const next = now.includes(value) ? now.filter((v) => v !== value) : [...now, value];
  const groups = { ...query.groups };
  if (next.length) groups[group] = next;
  else delete groups[group];
  return { ...query, groups };
}

/** One value of a group and how many rows it would show. */
export interface Count {
  value: string;
  count: number;
}

export interface Faceted {
  /** The rows that match, in index order. */
  shown: Prepared[];
  total: number;
  /**
   * For each group, how many rows each of its values would show: the rows matching
   * the text and every other group (so OR-ing in another value of a group counts
   * what it would add).
   */
  counts: Record<LibraryGroup, Map<string, number>>;
}

/** A utility preset: its style (the user's, else the index's) starts with "!", like `! Transition`. */
export const isUtility = (style: string) => style.startsWith('!');

/**
 * Whether `query` reaches utility presets: any query that isn't browsing does (a
 * saved smart playlist, as before decision 68); a browsing one when it picks
 * values in the style group (a utility preset still shows only if one is its
 * style) or has search text (which it must still match). Rust's `query::reaches_utility` keeps the same rule.
 */
export const reachesUtility = (query: LibraryQuery) => !query.browse || (query.groups.style?.length ?? 0) > 0 || wordsOf(query.text).length > 0;

/** `rows` in the order the library's grid browses them (decision 68): the curated picks first, then the rest, each part in the order given (by key). As Rust's `query::resolve` does for a browsing query. */
export function browseOrder<T extends { row: Pick<LibraryRow, 'curated'> }>(rows: readonly T[]): T[] {
  return [...rows.filter((p) => p.row.curated), ...rows.filter((p) => !p.row.curated)];
}

/** What the library's grid can show of `rows` with nothing filtered: all but the utility presets, which only a filter reaches. */
export const browsable = <T extends { style: string }>(rows: readonly T[]): T[] => rows.filter((p) => !isUtility(p.style));

/**
 * The rows matching `query`, and the live counts for every group's values. A
 * utility preset the query doesn't ask for ({@link reachesUtility}) is left out as
 * though it failed the style group, so the style group still counts (and offers) its style.
 */
export function facet(rows: readonly Prepared[], query: LibraryQuery): Faceted {
  const words = wordsOf(query.text);
  const active = activeGroups(query);
  const wanted = active.map((g) => new Set(query.groups[g]));
  const utility = reachesUtility(query);
  const counts = Object.fromEntries(GROUPS.map((g) => [g, new Map<string, number>()])) as Record<LibraryGroup, Map<string, number>>;
  const shown: Prepared[] = [];
  const bump = (g: LibraryGroup, values: string[]) => {
    const m = counts[g];
    for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  };

  for (const p of rows) {
    if (words.length && !words.every((w) => p.text.includes(w))) continue;
    // The one group this row fails, if only one: it still counts there.
    let failed: LibraryGroup | null = null;
    let fails = 0;
    if (!utility && isUtility(p.style)) {
      // The style group isn't active here (picking a style reaches utility presets).
      failed = 'style';
      fails++;
    }
    for (let i = 0; i < active.length && fails < 2; i++) {
      const want = wanted[i];
      if (!p.values[active[i]].some((v) => want.has(v))) {
        failed = active[i];
        fails++;
      }
    }
    if (fails === 0) {
      shown.push(p);
      for (const g of GROUPS) bump(g, p.values[g]);
    } else if (fails === 1 && failed) {
      bump(failed, p.values[failed]);
    }
  }
  return { shown, total: rows.length, counts };
}

/**
 * A group's values to list, with their counts: the selected ones always (even at 0),
 * then the rest with any rows. Styles go by name, each sub-style after its style;
 * colours and levels keep their own order; authors and tags go by count, then name.
 */
export function valuesFor(group: LibraryGroup, faceted: Faceted, query: LibraryQuery): Count[] {
  const counts = faceted.counts[group];
  const selected = query.groups[group] ?? [];
  const values = new Set<string>([...counts.keys(), ...selected]);
  const list = [...values].map((value) => ({ value, count: counts.get(value) ?? 0 })).filter((c) => c.count > 0 || selected.includes(c.value));
  const byName = (a: Count, b: Count) => a.value.localeCompare(b.value);
  switch (group) {
    case 'style':
      return list.sort((a, b) => {
        const [as, asub = ''] = a.value.split('/');
        const [bs, bsub = ''] = b.value.split('/');
        return as.localeCompare(bs) || asub.localeCompare(bsub);
      });
    case 'colour':
      return list.sort((a, b) => COLOURS.indexOf(a.value as Colour) - COLOURS.indexOf(b.value as Colour));
    case 'speed':
    case 'intensity':
      return list.sort((a, b) => LEVELS.indexOf(a.value as Level) - LEVELS.indexOf(b.value as Level));
    default:
      return list.sort((a, b) => b.count - a.count || byName(a, b));
  }
}

const count = (n: number) => n.toLocaleString('en-US');

/** The summary line under the search box, or null when nothing needs saying. */
export function facetSummary(faceted: Faceted, query: LibraryQuery): string | null {
  if (isEmpty(query)) return null;
  const n = faceted.shown.length;
  if (n === 0) return 'no presets match';
  return `${count(n)} of ${count(faceted.total)} presets`;
}

/** A name for a smart playlist saved from `query`: its values, in group order. */
export function queryName(query: LibraryQuery): string {
  const parts = activeGroups(query).map((g) => (g === 'star' ? '★' : query.groups[g]!.map((v) => valueLabel(g, v)).join(' or ')));
  if (query.text.trim()) parts.push(`“${query.text.trim()}”`);
  return parts.join(', ') || 'all presets';
}

/** Tags typed into the tag box: split on commas, trimmed, lower-cased, without repeats. */
export function parseTags(text: string): string[] {
  const out: string[] = [];
  for (const t of text.split(',')) {
    const tag = t.trim().replace(/\s+/g, ' ').toLowerCase();
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

/**
 * The entry `by` steps from the one at `currentPath` in `list`, wrapping round;
 * `by` 0 picks one at random. Null for an empty list.
 */
export function stepIn(list: Entry[], currentPath: string | null, by: number, random: () => number = Math.random): Entry | null {
  if (!list.length) return null;
  const at = currentPath ? list.findIndex((e) => e.path === currentPath) : -1;
  const next = by === 0 ? Math.floor(random() * list.length) : (at + by + list.length) % list.length;
  return list[next];
}

/**
 * Next tile index for a key in a grid of `length` tiles, `columns` wide, from `at`
 * (-1 = none): arrows move one tile or one row, Home/End jump to the ends,
 * PageUp/PageDown move `page` rows; null for any other key. From -1 every movement
 * lands on a real tile; an empty grid gives -1.
 */
export function tileFor(key: string, at: number, length: number, columns: number, page = 4): number | null {
  const cols = Math.max(1, columns);
  let next: number;
  switch (key) {
    case 'ArrowRight':
      next = at + 1;
      break;
    case 'ArrowLeft':
      next = at < 0 ? 0 : at - 1;
      break;
    case 'ArrowDown':
      next = at < 0 ? 0 : at + cols;
      break;
    case 'ArrowUp':
      next = at < 0 ? 0 : at - cols;
      break;
    case 'PageDown':
      next = at < 0 ? 0 : at + cols * Math.max(1, page);
      break;
    case 'PageUp':
      next = at - cols * Math.max(1, page);
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = length - 1;
      break;
    default:
      return null;
  }
  if (length <= 0) return -1;
  return Math.max(0, Math.min(length - 1, next));
}

/** What `debounced` needs of the clock, so a test can drive it. */
export interface Clock {
  now(): number;
  setTimeout(f: () => void, ms: number): unknown;
  clearTimeout(t: unknown): void;
}

const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (f, ms) => setTimeout(f, ms),
  clearTimeout: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
};

/**
 * `f`, called `wait` ms after the last of a burst of calls, and at least every
 * `most` ms while the burst goes on (the pack download changes the folder many
 * times a second). `cancel` drops a pending call.
 */
export function debounced(f: () => void, wait: number, most: number, clock: Clock = realClock) {
  let timer: unknown = null;
  let first = 0;
  const run = () => {
    timer = null;
    first = 0;
    f();
  };
  const call = () => {
    const now = clock.now();
    if (!first) first = now;
    if (timer !== null) clock.clearTimeout(timer);
    timer = clock.setTimeout(run, Math.max(0, Math.min(wait, first + most - now)));
  };
  call.cancel = () => {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
    first = 0;
  };
  return call;
}
