import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { Text, type TextProps } from '@satoramoto/zen';
import { createPortal } from 'react-dom';
import { FILTERS_KEY, remember, remembered } from '../model/home';
import { PackOffer } from '../PackOffer/PackOffer';
import { Popover } from '../Popover/Popover';
import * as api from '../model/api';
import type { Entry, LibraryChange, LibraryData, LibraryGroup, LibraryQuery, LibraryRow } from '../model/api';
import * as pl from '../model/playlists';
import { onChanged } from '../model/pack';
import { followGrid, forgetResumedQuery, gridKey, rereadOn, resumedQuery, stepping } from '../model/library';
import { useTauriEvent } from '../model/hooks';
import {
  GROUPS,
  GROUP_LABEL,
  SWATCH,
  activeGroups,
  browseOrder,
  debounced,
  facet,
  facetSummary,
  inOrder,
  LOOK_GROUPS,
  oneAtATime,
  prepare,
  queryName,
  rowsFromEntries,
  toggle,
  valueLabel,
  valuesFor,
  type Colour,
  type Found,
  type Prepared,
} from '../model/librarySearch';
import { LibraryGrid, pickInto, rangeAnchor, type Pick } from '../LibraryGrid/LibraryGrid';
import { Say, say } from '../model/words';
import { paneQuery } from '../model/libraryView';
import { PresetDrawer, hiddenCount } from '../PresetDrawer/PresetDrawer';
import { Credits } from '../Credits/Credits';
import { PackBar, useCreditsMenu, useDropToAdd } from '../Pack/Pack';
import './Library.css';

export interface LibraryProps {
  /** The whole library. */
  entries: Entry[];
  /** False until the first presets() answer arrives. */
  loaded: boolean;
  search: string;
  onSearch(next: string): void;
  /** searchLibrary(entries, search), computed by the App, which steps through it; the grid filters the index itself. */
  found: Found;
  /** Path of the preset playing. */
  current: string | null;
  /** The playlist the + adds to; null hides +. */
  into: { id: string; name: string } | null;
  onLoad(e: Entry): void;
  onAdd(e: Entry): void;
  /** A press on a tile that may become a drag, with the tile's thumbnail; none makes tiles plain. */
  onPress?(e: Entry, thumbnail: string | null, ev: PointerEvent): void;
  /** The narrowest a tile gets, in px, for a library given more room than its column. */
  tileMin?: number;
  /** The library as the home's main pane (decision 67); without it, the lab editor's column. */
  home?: HomeLibrary;
}

/**
 * The library as the home's main pane: a title and count, the search, and the
 * group chips behind a "filter · n" button (open or closed as the viewer left
 * it); the values picked as chips on a summary line with "save as smart
 * playlist"; no drawer (the home's Now Playing panel takes the selection) and
 * no pack bar (the full library is offered on a line while only the starter set
 * is in, and in Settings).
 */
export interface HomeLibrary {
  /** `starred` shows only the starred presets (the sidebar's Starred). */
  scope: 'library' | 'starred';
  /** The pane's title: "Library", "Starred". */
  title: string;
  /** Several presets picked in the grid (⌘ or ⇧), or one; for the Now Playing panel. */
  onChosen(chosen: Prepared[]): void;
  /**
   * The inspector view's grid (decision 70): only the grid, its notes and its
   * empty states in the pane, no title, count, chips or pack offer (the sidebar
   * names the pane, the inspector's source card counts it and offers the full
   * library). A click on a tile, or Enter, plays it (decision 71); ⌘ or ⇧ picks.
   */
  bare?: boolean;
  /**
   * Quick add on: a click on a tile (or Enter) hands it to `onToggle`, which adds it
   * to the playlist `name` or takes it out when its path is in `has` (those show ✓);
   * Space or ⌥-click plays it. Null or left out: off.
   */
  adding?: { name: string; has: ReadonlySet<string>; onToggle(e: Entry): void } | null;
  /** Where the search and "Filter ▾" go (a portal into the header's toolbar); null until it mounts, when they wait. */
  toolbar?: HTMLElement | null;
  /** The presets picked, by index key, as Home holds them: the grid takes them when they differ from its own (Esc back to the source, a dot picked in the inspector, `VITE_HOME_PICK`). */
  selected?: readonly string[];
  /** The id of what the grid's picks show (the inspector), for the grid's `aria-controls`: a press in it doesn't put that panel away. */
  controls?: string;
  /** The bare pane's head row (Home's `LibraryHead`), given how many it shows: `shown` as filtered, `total` with no filter of the viewer's. */
  head?(counts: { shown: number; total: number; filtered: boolean }): ReactNode;
  /**
   * Map view: what goes in the grid's room instead of the grid, given what the grid would show
   * (the source, the search and the filter) and how to play one of them as its tile would play.
   * Left out, or null, the grid.
   */
  map?: ((rows: readonly LibraryRow[], play: (row: LibraryRow) => void) => ReactNode) | null;
}

/**
 * How a dev run starts the home's library, for headless captures of its states
 * (never in a release): `VITE_HOME_FILTER=<group>:<value>` opens the filter on
 * that group with that value picked, `VITE_HOME_SEARCH=<text>` types the text.
 */
function devStart(): { group: LibraryGroup | null; value: string; search: string } | null {
  if (!import.meta.env.DEV) return null;
  const filter = String(import.meta.env.VITE_HOME_FILTER ?? '');
  const search = String(import.meta.env.VITE_HOME_SEARCH ?? '');
  const at = filter.indexOf(':');
  const group = at > 0 && (GROUPS as readonly string[]).includes(filter.slice(0, at)) ? (filter.slice(0, at) as LibraryGroup) : null;
  return group || search ? { group, value: filter.slice(at + 1), search } : null;
}

const count = (n: number) => n.toLocaleString('en-US');
const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** `q`'s groups the chips know, each with the values picked; any other group (one from a newer app) is left out. */
export function groupsOf(q: LibraryQuery): LibraryQuery['groups'] {
  const groups: LibraryQuery['groups'] = {};
  for (const g of GROUPS) {
    const values = q.groups?.[g];
    if (values?.length) groups[g] = [...values];
  }
  return groups;
}

/** A group's name read aloud: the star group's chip shows only ★. */
export const groupSays = (g: LibraryGroup): string => (g === 'star' ? 'starred' : GROUP_LABEL[g]);

/** A group chip's spoken name, with how many of its values are picked. */
export const chipSays = (g: LibraryGroup, picked: number): string => (picked > 0 ? `${groupSays(g)}, ${picked} picked` : groupSays(g));

/** A value chip's spoken name: the value and how many presets it would show. */
export const valueSays = (name: string, n: number): string => `${unstarred(name)}, ${n === 1 ? '1 preset' : `${count(n)} presets`}`;

/** A group's name on the home's switch, in sentence case: "Style", "★ Starred", "My tags". */
export const groupTitle = (g: LibraryGroup): string => {
  const w = g === 'star' ? '★ Starred' : GROUP_LABEL[g];
  return w.charAt(0).toUpperCase() + w.slice(1);
};

/** An open group's find box: "find an author", "find a style", "find a tag". */
export const findSays = (g: LibraryGroup): string => {
  const word = groupSays(g).replace(/^my /, '').replace(/tags$/, 'tag');
  return `${say('find value')} ${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`;
};

/** A value's label without the ★ in front, which a screen reader would read as "black star". */
const unstarred = (label: string) => label.replace(/^★\s*/, '');

/** How long the folder has to be quiet before the index is read again, and the longest it waits while it isn't. */
const REREAD = { wait: 500, most: 4000 };

/** How long the filter has to be still before the deck follows the grid again, in ms (typing in the search box). */
const REFOLLOW = 300;

/** A group with more values than this gets a box to find one. */
const FIND_FROM = 12;
/** The most values an open group lists at once (authors run to thousands); the find box reaches the rest. */
const VALUES_CAP = 150;

/**
 * The index rows, read again (debounced) as the presets folder changes; null until read, or when it can't be.
 * `settled` is whether the first read has answered or failed: until then the fallback rows are a guess the deck shouldn't follow.
 */
function useIndex(): { index: LibraryRow[] | null; settled: boolean } {
  const [index, setIndex] = useState<LibraryRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    // One read at a time: a change during a read reads once more after it, so an older answer never lands last.
    const read = () =>
      api.libraryIndex().catch((e: unknown) => {
        setFailed(true);
        throw e;
      });
    const reader = oneAtATime(read, setIndex);
    reader.run();
    const reread = debounced(reader.run, REREAD.wait, REREAD.most);
    const stop = rereadOn(onChanged, reread);
    return () => {
      reread.cancel();
      reader.stop();
      stop();
    };
  }, []);
  return { index, settled: index !== null || failed };
}

/** The user's library data, followed through `library-changed`; null until read. */
function useLibraryData(): [LibraryData | null, (answer: Promise<LibraryData>) => Promise<void>] {
  const [data, setData] = useState<LibraryData | null>(null);
  // Every answer and event takes a ticket; one older than the newest applied is dropped.
  const order = useRef(inOrder()).current;
  useEffect(() => {
    const t = order.ticket();
    api.libraryData().then(
      (d) => order.take(t) && setData(d),
      () => {},
    );
    return rereadOnData((d) => order.take(order.ticket()) && setData(d));
  }, [order]);
  const apply = useCallback(
    (answer: Promise<LibraryData>) => {
      const t = order.ticket();
      return answer.then((d) => void (order.take(t) && setData(d)));
    },
    [order],
  );
  return [data, apply];
}

function rereadOnData(set: (d: LibraryData) => unknown): () => void {
  let stopped = false;
  let unlisten: Promise<() => void>;
  try {
    unlisten = api.onLibraryChanged((d) => !stopped && set(d));
  } catch {
    return () => {}; // not in the app
  }
  return () => {
    stopped = true;
    void unlisten.then(
      (u) => u(),
      () => {},
    );
  };
}

/**
 * The preset library.
 *
 * **Job.** A search box and group chips over a grid of thumbnails, with a drawer for the
 * selection. AND across groups, OR within one; each value counts the presets it would show. On
 * the home (`home`) the main pane: title and count, search as type, the filter behind "Filter",
 * what is picked on a quiet line with Clear and Save, centred empty states; bare, only the grid,
 * its search and "Filter ▾" portalled into the header's toolbar.
 *
 * **Changed.** Its own rules are `Library.css` (`vs-library-*`) on the contract's type, sizes and
 * colours; the grid and tiles are LibraryGrid's. The filter's popover is the visuals `Popover`
 * (top-layer glass, the float Layer). ↓ from the search finds the grid by its `listbox` role,
 * not its class (the grid's classes are its own). The pack offer sits in a line of the library's
 * (`vs-library-offer`) rather than the library restyling PackOffer's button. Captions on the
 * filter's glass take the lighter step (`--vs-caption-raised`). Every word is a `Text`: titles
 * in the display role, counts in the numeral role, notes and lines at caption size; a button's
 * words are a Text inside it, and the inputs take their type from the caption Text around them
 * (the app's `font: inherit` reset on controls outranks a Text on the control itself). Bare, the
 * home's `head` (its `LibraryHead`: the source, the count as filtered, Grid | Map) tops the pane,
 * and in Map view the home's `map` takes the grid's room, given the rows the grid would show (the
 * same query: `paneQuery`), a dot played as its tile would be (claimed, the deck following the
 * grid); the empty states and notes stay as they are.
 *
 * **Kept.** Every export, prop and behaviour (following the grid, the resumed filter, the index
 * re-read, the save as a smart playlist, the dev start), every accessible name, title and string.
 *
 * **Tuning knobs.** `--vs-library-caption` (its small grey text: `--text-3`, the lighter
 * `--vs-caption-raised` on a raised tint or the filter's glass) and `--vs-library-small` (library.css's
 * 11px counts and ✕, a hairline under the caption; the scale has no 11).
 */
/** A note or summary line: a caption-size Text at the page's normal leading, a `p` unless told. */
function Note({ as = 'p', className = 'vs-library-note', ...rest }: TextProps) {
  return <Text as={as} size="caption" leading="normal" className={className} {...rest} />;
}

/** The round count of values picked, on "Filter": a bold numeral Text at the ramp's smallest size. */
function FilterBadge({ n }: { n: number }) {
  return (
    <Text role="numeral" leading="normal" className="vs-library-filter-badge" aria-hidden="true">
      {n}
    </Text>
  );
}

/** The empty states' parts: the glyph at the numeral size, the strong title, why, and Clear's word. */
function EmptyGlyph({ children }: { children: string }) {
  return (
    <Text size="numeral" leading="tight" className="vs-library-empty-glyph" aria-hidden="true">
      {children}
    </Text>
  );
}
function EmptyTitle({ children }: { children: ReactNode }) {
  return (
    <Text as="h2" weight="strong" leading="normal" className="vs-library-empty-title">
      {children}
    </Text>
  );
}
function EmptyWhy({ children }: { children: ReactNode }) {
  return (
    <Text as="p" size="caption" leading="normal" className="vs-library-empty-why">
      {children}
    </Text>
  );
}
function EmptyClearLabel({ children }: { children: ReactNode }) {
  return (
    <Text size="caption" leading="normal" className="vs-library-empty-clear-label">
      {children}
    </Text>
  );
}

export function Library({ entries, loaded, search, onSearch, current, into, onLoad, onAdd, onPress, tileMin, home }: LibraryProps) {
  const { index, settled } = useIndex();
  const [data, setData] = useLibraryData();
  // A dev run on the home may start filtered, for a headless capture of the filter (`VITE_HOME_FILTER=style:Hypnotic`).
  const dev = home ? devStart() : null;
  const [groups, setGroups] = useState<LibraryQuery['groups']>(() => (dev?.group ? { [dev.group]: [dev.value] } : {}));
  const [open, setOpen] = useState<LibraryGroup | null>(dev?.group ?? null);
  const [find, setFind] = useState('');
  const [selection, setSelection] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [lists, setLists] = useState<pl.Playlist[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [reveal, setReveal] = useState(0);
  const [credits, setCredits] = useState(false);
  const drop = useDropToAdd();
  useCreditsMenu(() => setCredits(true));
  // The home's chips start as the viewer left them: closed, the first time.
  const [filters, setFilters] = useState(() => (home ? !!dev?.group || remembered(FILTERS_KEY, false) : true));
  const flipFilters = () => {
    remember(FILTERS_KEY, !filters);
    setFilters(!filters);
    if (filters) setOpen(null);
  };

  // Starred is the library with the star group always picked; its chip isn't shown, as it can't be taken off.
  const starred = home?.scope === 'starred';
  // The home's grid browses (decision 68): curated picks first, utility presets only when asked for; the
  // deck following it is sent the same query. The lab editor's column lists the library as before.
  const browse = !!home;
  const query: LibraryQuery = useMemo(() => paneQuery(starred, groups, search, browse), [groups, search, starred, browse]);
  const rows = useMemo(() => index ?? rowsFromEntries(entries), [index, entries]);
  const prepared = useMemo(() => (browse ? browseOrder(prepare(rows, data)) : prepare(rows, data)), [rows, data, browse]);
  const faceted = useMemo(() => facet(prepared, query), [prepared, query]);
  const shown = faceted.shown;
  // What the pane holds with no filter of the viewer's: what the grid can show then (Starred's star stays picked), by the grid's own rule.
  const paneTotal = useMemo(() => facet(prepared, paneQuery(starred, {}, '', browse)).shown.length, [prepared, starred, browse]);
  const at = active === null ? -1 : shown.findIndex((p) => p.row.key === active);
  const byKey = useMemo(() => new Map(prepared.map((p) => [p.row.key, p])), [prepared]);
  const selectedSet = useMemo(() => new Set(selection), [selection]);
  const chosen = useMemo(() => selection.map((k) => byKey.get(k)).filter((p): p is Prepared => !!p), [selection, byKey]);
  // Reported when the selection changes, not when the caller hands a new function (a caller's inline one would loop).
  const onChosen = useRef(home?.onChosen);
  onChosen.current = home?.onChosen;
  useEffect(() => onChosen.current?.(chosen), [chosen]);
  const bare = !!home?.bare;

  // The App's entries, by path, so a load hands it the entry it knows.
  const byPath = useMemo(() => new Map(entries.map((e) => [e.path, e])), [entries]);
  const entryOf = useCallback((p: Prepared): Entry => byPath.get(p.row.path) ?? { path: p.row.path, name: p.title, group: p.subStyle ? `${p.style}/${p.subStyle}` : p.style }, [byPath]);

  // Bring the playing tile into view when the preset changes.
  useEffect(() => setReveal((r) => r + 1), [current]);

  // The playlists the drawer's preset is in, read when it opens on a new one.
  const one = chosen.length === 1 ? chosen[0].row.path : null;
  useEffect(() => {
    if (one === null) return;
    let live = true;
    pl.lists().then(
      (l) => live && setLists(l.playlists),
      () => live && setLists([]),
    );
    return () => {
      live = false;
    };
  }, [one]);

  const adding = home?.adding ?? null;
  const handlers = useRef({ onLoad, onAdd, onPress, onSearch, shown, selection, anchor, active, entryOf, query, current, settled, adding, bare });
  handlers.current = { onLoad, onAdd, onPress, onSearch, shown, selection, anchor, active, entryOf, query, current, settled, adding, bare };

  // Home's selection, when it changes to something other than the grid's own (Esc back to the source, a dot picked in
  // the inspector): the grid takes it. What the grid reports back through onChosen is then the same, so nothing loops.
  const wanted = home?.selected;
  const wantedKey = wanted?.join('\n');
  useEffect(() => {
    if (wanted === undefined || wantedKey === handlers.current.selection.join('\n')) return;
    setSelection([...wanted]);
    const first = wanted[0];
    if (first !== undefined && handlers.current.shown.some((p) => p.row.key === first)) {
      setActive(first);
      setAnchor(first);
    }
  }, [wantedKey]);

  // Playing from the grid: open it, and have ←, → and R follow the grid (the deck keeps a loaded playlist).
  const following = useRef(false);
  const play = useCallback((p: Prepared) => {
    const h = handlers.current;
    h.onLoad(h.entryOf(p));
    // Until the index has answered (or failed), the grid's rows are a guess Rust's resolve may not agree with:
    // play with nothing followed, and follow from what plays once it has.
    if (!h.settled) {
      owed.current = p.row.path;
      return;
    }
    owed.current = null;
    following.current = true;
    followGrid(h.query, p.row.path);
  }, []);
  const owed = useRef<string | null>(null);
  useEffect(() => {
    if (!settled || owed.current === null) return;
    const h = handlers.current;
    const at = h.current ?? owed.current;
    owed.current = null;
    following.current = true;
    followGrid(h.query, at);
  }, [settled]);
  // A playlist loaded or let go: stop following until the grid opens a preset again.
  const deckPlaylist = useRef<string | null | undefined>(undefined);
  const deckMoved = (deck: pl.Deck) => {
    if (deckPlaylist.current !== undefined && deckPlaylist.current !== deck.playlist) following.current = false;
    deckPlaylist.current = deck.playlist;
  };
  // The app picked up playing a filter: the first library that shows it (while the
  // deck still plays it) takes it, and the deck, already following it, follows it
  // on as it changes. Libraries opened later start unfiltered, as before, and a
  // filter the user set first is never replaced.
  const touched = useRef(false);
  const filterChanged = () => {
    touched.current = true;
    forgetResumedQuery();
  };
  useEffect(() => {
    if (!dev) return;
    filterChanged();
    if (dev.search) handlers.current.onSearch(dev.search);
  }, []);
  useEffect(() => {
    let live = true;
    resumedQuery().then((q) => {
      if (!live || !q || touched.current) return;
      forgetResumedQuery();
      setGroups(groupsOf(q));
      if (q.text) handlers.current.onSearch(q.text);
      following.current = true;
    });
    return () => {
      live = false;
    };
  }, []);
  useTauriEvent(pl.onLive, (now) => deckMoved(now.deck));
  useTauriEvent(pl.onLists, (l) => deckMoved(l.deck));
  // The filter or the library changed what the grid shows since: follow the grid as
  // it is now, from what is playing; while a step is in flight, wait for it.
  const grid = useMemo(() => gridKey(shown.map((p) => p.row.path)), [shown]);
  // What Map view draws: the rows the grid shows.
  const mapShown = useMemo(() => shown.map((p) => p.row), [shown]);
  useEffect(() => {
    if (!following.current) return;
    let t: ReturnType<typeof setTimeout>;
    const refollow = () => {
      if (stepping()) {
        t = setTimeout(refollow, REFOLLOW);
        return;
      }
      const h = handlers.current;
      if (following.current && h.current !== null) followGrid(h.query, h.current);
    };
    t = setTimeout(refollow, REFOLLOW);
    return () => clearTimeout(t);
  }, [query, grid]);

  const pick = useCallback((i: number, how: Pick) => {
    const h = handlers.current;
    const p = h.shown[i];
    if (!p) return;
    setActive(p.row.key);
    // Quick add: into the playlist (or out of it), the picks left as they are.
    if (how === 'add') {
      setAnchor(p.row.key);
      h.adding?.onToggle(h.entryOf(p));
      return;
    }
    // The first ⇧ move or click runs from the highlighted tile.
    const from = rangeAnchor(h.anchor, h.active, h.shown);
    // On the home a click plays and lets the picks go, so the inspector shows what plays (decision 71).
    setSelection(how === 'load' && h.bare ? [] : pickInto(h.selection, h.shown, i, how, from));
    setError(null);
    if (how !== 'range') setAnchor(p.row.key);
    else if (from !== h.anchor) setAnchor(from);
    if (how === 'load') play(p);
  }, []);
  // A dot in Map view plays as its tile would: claimed, the picks let go, and the deck following what the grid shows.
  const playRow = useCallback(
    (row: LibraryRow) => {
      const h = handlers.current;
      // The dot playing does nothing, as the other maps' doesn't.
      if (row.path === h.current) return;
      const i = h.shown.findIndex((p) => p.row.key === row.key);
      if (i >= 0) pick(i, 'load');
    },
    [pick],
  );
  const add = useCallback((i: number) => {
    const h = handlers.current;
    if (h.shown[i]) h.onAdd(h.entryOf(h.shown[i]));
  }, []);
  // A plain move lets go of the anchor, so the next ⇧ move runs from where it lands.
  const moveTo = useCallback((i: number) => {
    setActive(handlers.current.shown[i]?.row.key ?? null);
    setAnchor(null);
  }, []);
  const clear = useCallback(() => setSelection([]), []);
  const press = useCallback((i: number, ev: PointerEvent) => {
    const h = handlers.current;
    const p = h.shown[i];
    if (p && h.onPress) h.onPress(h.entryOf(p), p.row.thumbnail, ev);
  }, []);

  const set = (keys: string[], change: LibraryChange) => {
    setError(null);
    setData(api.librarySet(keys, change)).catch((e) => setError(`Couldn't save that: ${why(e)}`));
  };

  const pickValue = (g: LibraryGroup, v: string) => {
    filterChanged();
    setGroups((gs) => toggle({ groups: gs, text: '' }, g, v).groups);
    setSaveNote(null);
  };
  const clearAll = () => {
    filterChanged();
    setGroups({});
    onSearch('');
    setSaveNote(null);
  };

  const save = (name: string) => {
    setNaming(null);
    // Saved without `browse`: a smart playlist resolves every match, by key, as it always has (decision 68 changes only browsing).
    api.smartPlaylistSave(name.trim() || queryName(query), { groups: query.groups, text: query.text }).then(
      () => setSaveNote(`Saved “${name.trim() || queryName(query)}”.`),
      (e) => setSaveNote(why(e)),
    );
  };

  const empty = loaded && entries.length === 0 && !rows.length;
  // The values picked by hand: Starred's own star isn't one.
  const picked = activeGroups({ groups, text: '' });
  const filtered = picked.length > 0 || search.trim() !== '';
  const summary = home ? (filtered ? `${count(shown.length)} preset${shown.length === 1 ? '' : 's'}` : null) : facetSummary(faceted, query);
  const pickedCount = picked.reduce((n, g) => n + (groups[g]?.length ?? 0), 0);
  // The title counts `paneTotal` (above), or what is shown while filtering.
  const searchInput = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const clearSearch = () => {
    filterChanged();
    onSearch('');
    setSaveNote(null);
    searchInput.current?.focus();
  };

  // The home has no pack bar: a drop's note goes on the summary line, and the full library is offered on a line of its own.
  const bar = home ? null : <PackBar presets={entries.length} dropped={drop.note} credits={credits} onCredits={() => setCredits((c) => !c)} />;
  if (credits) {
    return (
      <div className="vs-library" data-drop={drop.over ? '' : undefined}>
        <Credits entries={entries} onBack={() => setCredits(false)} />
        {bar}
      </div>
    );
  }

  const onSearchKey = (ev: KeyboardEvent<HTMLInputElement>) => {
    if (ev.key !== 'ArrowDown' || !shown.length) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (at < 0) setActive(shown[0].row.key);
    // By the pane, not the search's ancestors: on the inspector view the search is in the header's toolbar.
    root.current?.querySelector<HTMLElement>('[role="listbox"]')?.focus();
  };

  const searchInputBox = (
    <input
      ref={searchInput}
      className="vs-library-search"
      type="search"
      aria-label="search presets"
      placeholder={home ? `${Say('search box')} ${count(paneTotal)} preset${paneTotal === 1 ? '' : 's'}` : `${say('search box')} ${count(rows.length || entries.length)} presets`}
      title="Every word must match the preset's style, author, name or tags. ↓ moves into the grid."
      value={search}
      onChange={(ev) => {
        filterChanged();
        onSearch(ev.target.value);
      }}
      onKeyDown={onSearchKey}
      disabled={empty}
    />
  );
  // On the home the search is type on the pane: a ⌕, the text, and a ✕ to clear it. In the inspector view's toolbar the ⌕
  // is a button: in the header's narrow form the field folds to it (Library.css), and it opens the field again.
  // The field is a caption-size Text: the input inherits its type (the app's button and input reset is `font: inherit`).
  const searchBox = home ? (
    <Text as="div" size="caption" leading="normal" className="vs-library-search-field" data-text={search ? '' : undefined}>
      {bare ? (
        <button type="button" className="vs-library-search-glyph" aria-label="search" title="Search (⌘F)" tabIndex={-1} onClick={() => searchInput.current?.focus()}>
          <Text size="body" leading="normal" aria-hidden="true">
            ⌕
          </Text>
        </button>
      ) : (
        <Text size="body" leading="normal" className="vs-library-search-glyph" aria-hidden="true">
          ⌕
        </Text>
      )}
      {searchInputBox}
      {search && (
        <button type="button" className="vs-library-search-clear" aria-label={say('clear search')} title={Say('clear search')} onClick={clearSearch}>
          <Text leading="normal" className="vs-library-search-x" aria-hidden="true">
            ✕
          </Text>
        </button>
      )}
    </Text>
  ) : (
    searchInputBox
  );
  // On the home the chips wait behind "Filter"; the editor's column always shows them.
  const chipsShown = !empty && filters && !bare;
  const title = home && (
    <div className="vs-library-head">
      <Text as="h1" role="display" size="heading" className="vs-library-title-head">
        {home.title}
      </Text>
      <Text role="numeral" size="caption" weight="body" leading="normal" className="vs-library-count" title={filtered ? `${count(shown.length)} of ${count(paneTotal)} presets shown` : undefined}>
        {count(filtered ? shown.length : paneTotal)}
      </Text>
      <span className="vs-library-fill" />
      {searchBox}
      <button
        type="button"
        className="vs-library-filter"
        aria-expanded={filters}
        aria-label={pickedCount ? `${say('facets')}, ${pickedCount} picked` : say('facets')}
        title={filters ? 'Hide the filter' : 'Filter by style, author, colour, speed, intensity, star or your tags'}
        onClick={flipFilters}
        disabled={empty}
      >
        <Text size="caption" leading="normal" className="vs-library-filter-label">
          {Say('facets')}
        </Text>
        {pickedCount > 0 && <FilterBadge n={pickedCount} />}
      </button>
    </div>
  );
  // Nothing to show: what didn't match, why, and the way back (decision 68).
  const noneTitle = search.trim() ? `“${search.trim()}”` : `“${picked.flatMap((g) => groups[g]!.map((v) => unstarred(valueLabel(g, v)))).join(', ')}”`;
  const emptyState = !home ? null : filtered ? (
    <div className="vs-library-empty">
      <EmptyGlyph>⌕</EmptyGlyph>
      <EmptyTitle>
        {say('no matches')} {noneTitle}
      </EmptyTitle>
      <EmptyWhy>{search.trim() ? say('no matches search why') : say('no matches filter why')}</EmptyWhy>
      {search.trim() ? (
        <button type="button" className="vs-library-empty-clear" onClick={clearSearch}>
          <EmptyClearLabel>{Say('clear search')}</EmptyClearLabel>
        </button>
      ) : (
        <button
          type="button"
          className="vs-library-empty-clear"
          onClick={() => {
            clearAll();
            searchInput.current?.focus();
          }}
        >
          <EmptyClearLabel>{Say('clear filter')}</EmptyClearLabel>
        </button>
      )}
    </div>
  ) : (
    <div className="vs-library-empty">
      <EmptyGlyph>☆</EmptyGlyph>
      <EmptyTitle>{say('starred empty')}</EmptyTitle>
      <EmptyWhy>{say('starred empty why')}</EmptyWhy>
    </div>
  );

  const chips = (
    <div className="vs-library-chips" role="group" aria-label="groups">
      {GROUPS.filter((g) => !(starred && g === 'star')).map((g) => {
        const on = query.groups[g]?.length ?? 0;
        // Until the index is read there is no look to count, so these wait rather than show nothing.
        const waiting = !index && LOOK_GROUPS.includes(g);
        return (
          <button
            key={g}
            type="button"
            className="vs-library-chip"
            aria-expanded={open === g}
            aria-label={chipSays(g, on)}
            disabled={waiting}
            data-on={on ? '' : undefined}
            title={waiting ? `${GROUP_LABEL[g]} comes once the library has been read` : `Show only presets with these ${GROUP_LABEL[g]} values; pick several to see any of them`}
            onClick={() => {
              setOpen((o) => (o === g ? null : g));
              setFind('');
            }}
          >
            <Text size="caption" leading="normal" className="vs-library-chip-label">
              {home ? groupTitle(g) : GROUP_LABEL[g]}
            </Text>
            {on > 0 && (
              <Text leading="normal" tabular={home ? true : undefined} className="vs-library-chip-count" aria-hidden="true">
                {on}
              </Text>
            )}
          </button>
        );
      })}
    </div>
  );
  const values = open && !(!index && LOOK_GROUPS.includes(open)) && (
    <Values group={open} values={valuesFor(open, faceted, query)} selected={query.groups[open] ?? []} find={find} onFind={setFind} onPick={(v) => pickValue(open, v)} home={!!home} />
  );
  // On the home, a search alone that finds nothing has only the centred state: its line would say "0 presets" and offer to save nothing.
  const pickedLine = filtered && !(home && !picked.length && !shown.length) && (
    // A caption-size Text: Clear, Save and the name input inherit its type (the app's button and input reset).
    <Text as="div" size="caption" leading="normal" className="vs-library-picked">
      {picked.flatMap((g) =>
        groups[g]!.map((v) => (
          <button
            key={`${g}:${v}`}
            type="button"
            className="vs-library-chip vs-library-chip-picked"
            aria-label={`stop filtering by ${unstarred(valueLabel(g, v))}`}
            title={`Stop filtering by ${valueLabel(g, v)}`}
            onClick={() => pickValue(g, v)}
          >
            {g === 'colour' && <span className="vs-library-swatch" aria-hidden="true" style={{ background: SWATCH[v as Colour] }} />}
            <Text size="caption" leading="normal" className="vs-library-chip-label">
              {valueLabel(g, v)}{' '}
            </Text>
            <Text size="caption" leading="normal" className="vs-library-x" aria-hidden="true">
              {home ? '✕' : '×'}
            </Text>
          </button>
        )),
      )}
      {home && (
        <>
          <Text role="numeral" size="caption" weight="body" leading="normal" className="vs-library-picked-count" ariaRole="status">
            {summary}
          </Text>
          <span className="vs-library-fill" />
        </>
      )}
      <button type="button" className="vs-library-link" aria-label="clear the filter" onClick={clearAll} title="Show every preset">
        {home ? 'Clear' : 'clear'}
      </button>
      {naming === null ? (
        <button type="button" className="vs-library-link" onClick={() => setNaming(queryName(query))} title="Keep this filter as a playlist that fills itself">
          {home ? Say('save query') : say('save query')}
        </button>
      ) : (
        <input
          className="vs-library-name-input"
          aria-label="smart playlist name"
          autoFocus
          value={naming}
          onChange={(ev) => setNaming(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter') save(naming);
            else if (ev.key === 'Escape') setNaming(null);
            else return;
            ev.preventDefault();
            ev.stopPropagation();
          }}
          onBlur={() => setNaming(null)}
        />
      )}
    </Text>
  );

  // The inspector view's search and "Filter ▾", in the header's toolbar: the filter's groups, values, what is picked, Clear and Save in its popover (D4).
  const toolbar =
    bare && home?.toolbar
      ? createPortal(
          <div className="vs-library-home vs-library-toolbar">
            {searchBox}
            <Popover
              className="vs-library-filter-pop"
              name={say('facets')}
              align="right"
              pressed={pickedCount > 0}
              title="Filter by style, author, colour, speed, intensity, star or your tags"
              label={
                <>
                  {Say('facets')}
                  {pickedCount > 0 && <FilterBadge n={pickedCount} />}
                  <Text leading="normal" className="vs-library-filter-caret" aria-hidden="true">
                    ▾
                  </Text>
                </>
              }
            >
              <div className="vs-library-filter-panel">
                {chips}
                {values}
                {pickedLine || (
                  <Text as="p" role="numeral" size="caption" weight="body" leading="normal" className="vs-library-picked-count vs-library-filter-none" ariaRole="status">
                    {count(shown.length)} preset{shown.length === 1 ? '' : 's'}
                  </Text>
                )}
              </div>
            </Popover>
          </div>,
          home.toolbar,
        )
      : null;

  return (
    <div ref={root} className={bare ? 'vs-library vs-library-home vs-library-bare' : home ? 'vs-library vs-library-home' : 'vs-library'} data-drop={drop.over ? '' : undefined}>
      {toolbar}
      {bare && home?.head?.({ shown: shown.length, total: paneTotal, filtered })}
      {!bare && (title || searchBox)}
      {chipsShown && chips}
      {chipsShown && values}
      {!bare && pickedLine}
      {home ? (
        <>
          {(saveNote || drop.note) && (
            <Note as="div" ariaRole="status" className="vs-library-summary" data-error={drop.note?.error ? '' : undefined}>
              {[saveNote, drop.note?.text].filter(Boolean).join(' · ')}
            </Note>
          )}
          {!empty && !starred && !bare && (
            <Text as="div" size="caption" leading="normal" className="vs-library-offer">
              <PackOffer />
            </Text>
          )}
        </>
      ) : (
        (summary || saveNote) && (
          <Note as="div" ariaRole="status" className="vs-library-summary">
            {[summary, saveNote].filter(Boolean).join(' · ')}
          </Note>
        )
      )}
      {!loaded && !index ? (
        <Note ariaRole="status">{home ? 'Loading presets…' : 'loading presets…'}</Note>
      ) : empty ? (
        <Note className="vs-library-note vs-library-first-run">No presets yet. Drop .milk files or a folder of them here, or use Add a folder… {home ? 'in Settings (⌘,)' : 'below'}.</Note>
      ) : home && !shown.length && (filtered || starred) ? (
        emptyState
      ) : home?.map ? (
        home.map(mapShown, playRow)
      ) : (
        <LibraryGrid
          rows={shown}
          active={at}
          selected={selectedSet}
          current={current}
          into={into}
          onMove={moveTo}
          onPick={pick}
          onAdd={add}
          onClear={clear}
          reveal={reveal}
          onPress={onPress && press}
          tileMin={tileMin}
          home={bare}
          adding={adding && { name: adding.name, has: adding.has }}
          controls={home?.controls}
        />
      )}
      {!home && chosen.length > 0 && !empty && (
        <PresetDrawer
          key={selection.join('\n')}
          chosen={chosen}
          hiddenByFilter={hiddenCount(chosen, shown)}
          playlists={lists}
          current={current}
          onSet={set}
          onLoad={play}
          onClose={clear}
          error={error}
        />
      )}
      {bar}
    </div>
  );
}

interface ValuesProps {
  group: LibraryGroup;
  values: { value: string; count: number }[];
  selected: string[];
  find: string;
  onFind(next: string): void;
  onPick(value: string): void;
  /** On the home: values as type, and a picked style's sub-styles on a line of their own under "In <style>". */
  home?: boolean;
}

type Count = { value: string; count: number };

/**
 * An open group's values, each with the count of presets it would show.
 *
 * **Changed.** Its classes (`vs-library-*`). **Kept.** The cap, the find box, the home's
 * styles-then-sub-styles levels, every name and string.
 */
export function Values({ group, values, selected, find, onFind, onPick, home }: ValuesProps) {
  const f = find.trim().toLowerCase();
  const all = f ? values.filter((v) => valueLabel(group, v.value).toLowerCase().includes(f)) : values;
  const list = all.slice(0, VALUES_CAP);
  const button = ({ value, count: n }: Count) => {
    const sub = group === 'style' && value.includes('/');
    return (
      <button
        key={value}
        type="button"
        className="vs-library-chip vs-library-value"
        aria-pressed={selected.includes(value)}
        // A sub-style shows only its own name; read aloud, it says which style it is under.
        aria-label={valueSays(valueLabel(group, value), n)}
        data-sub={sub ? '' : undefined}
        onClick={() => onPick(value)}
      >
        {group === 'colour' && <span className="vs-library-swatch" aria-hidden="true" style={{ background: SWATCH[value as Colour] }} />}
        <Text size="caption" leading="normal" className="vs-library-value-name">
          {sub ? value.slice(value.indexOf('/') + 1) : valueLabel(group, value)}
        </Text>
        <Text size="caption" leading="normal" tabular className="vs-library-value-count">
          {count(n)}
        </Text>
      </button>
    );
  };
  // The home's styles: the styles first, then each picked style's sub-styles (while finding, any that match) under "In <style>".
  // The cap counts the styles alone: it never cuts off a picked style's sub-styles, which sort after every style.
  const levels = home && group === 'style';
  const allTops = levels ? all.filter((v) => !v.value.includes('/')) : [];
  // A picked style past the cap stays too, so what is picked can always be seen and let go.
  const tops = allTops.filter((v, i) => i < VALUES_CAP || selected.includes(v.value));
  const subsOf = new Map<string, Count[]>();
  if (levels) {
    let found = 0;
    for (const v of all) {
      const at = v.value.indexOf('/');
      if (at < 0) continue;
      const parent = v.value.slice(0, at);
      const picked = selected.some((s) => s === parent || s.startsWith(`${parent}/`));
      if (!picked && !f) continue;
      // Found by typing alone (its style not picked): those keep the cap, as the list did.
      if (!picked && found++ >= VALUES_CAP) continue;
      subsOf.set(parent, [...(subsOf.get(parent) ?? []), v]);
    }
  }
  const more = levels ? allTops.length - tops.length : all.length - list.length;
  return (
    // A caption-size Text: the find box inherits its type (the app's input reset is `font: inherit`).
    <Text as="div" size="caption" leading="normal" className="vs-library-values" ariaRole="group" aria-label={`${groupSays(group)} values`}>
      {values.length > FIND_FROM && (
        <input className="vs-library-values-find" type="search" aria-label={findSays(group)} placeholder={findSays(group)} value={find} onChange={(ev) => onFind(ev.target.value)} />
      )}
      {all.length === 0 && <Note>{group === 'tags' && !values.length ? 'No tags yet. Select a preset to tag it.' : 'none'}</Note>}
      {levels ? (
        <>
          <div className="vs-library-values-list">{tops.map(button)}</div>
          {[...subsOf].map(([parent, subs]) => (
            <div key={parent} className="vs-library-values-subs" role="group" aria-label={`in ${parent}`}>
              <Text size="caption" leading="normal" className="vs-library-values-in">{`In ${parent}`}</Text>
              {subs.map(button)}
            </div>
          ))}
        </>
      ) : (
        <div className="vs-library-values-list">
          {list.flatMap((v, i) => [
            // Each style starts a line, with its sub-styles after it.
            group === 'style' && i > 0 && !v.value.includes('/') ? <span key={`break:${v.value}`} className="vs-library-break" /> : null,
            button(v),
          ])}
        </div>
      )}
      {more > 0 && <Note>{count(more)} more: type to find one</Note>}
    </Text>
  );
}
