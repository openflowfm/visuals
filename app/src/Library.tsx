import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { FILTERS_KEY, remember, remembered } from './home.ts';
import { PackOffer } from './PackOffer.tsx';
import * as api from './api.ts';
import type { Entry, LibraryChange, LibraryData, LibraryGroup, LibraryQuery, LibraryRow } from './api.ts';
import * as pl from './playlists.ts';
import { onChanged } from './pack.ts';
import { followGrid, forgetResumedQuery, gridKey, rereadOn, resumedQuery, stepping } from './library.ts';
import { useTauriEvent } from './hooks.ts';
import {
  GROUPS,
  GROUP_LABEL,
  SWATCH,
  activeGroups,
  browseOrder,
  STARRED,
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
} from './librarySearch.ts';
import { LibraryGrid, pickInto, rangeAnchor, type Pick } from './LibraryGrid.tsx';
import { Say, say } from './words.ts';
import { PresetDrawer, hiddenCount } from './PresetDrawer.tsx';
import { Credits } from './Credits.tsx';
import { PackBar, useCreditsMenu, useDropToAdd } from './Pack.tsx';
import './library.css';

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
  /** The narrow window's source menu, shown in place of the title. */
  menu?: ReactNode;
  /** Several presets picked in the grid (⌘ or ⇧), or one; for the Now Playing panel. */
  onChosen(chosen: Prepared[]): void;
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

/** The index rows, read again (debounced) as the presets folder changes; null until read, or when it can't be. */
function useIndex(): LibraryRow[] | null {
  const [index, setIndex] = useState<LibraryRow[] | null>(null);
  useEffect(() => {
    // One read at a time: a change during a read reads once more after it, so an older answer never lands last.
    const reader = oneAtATime(api.libraryIndex, setIndex);
    reader.run();
    const reread = debounced(reader.run, REREAD.wait, REREAD.most);
    const stop = rereadOn(onChanged, reread);
    return () => {
      reread.cancel();
      reader.stop();
      stop();
    };
  }, []);
  return index;
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
 * The preset library: a search box and group chips over a grid of thumbnails, with
 * a drawer for the selection. AND across groups, OR within one; each value counts
 * the presets it would show.
 */
export function Library({ entries, loaded, search, onSearch, current, into, onLoad, onAdd, onPress, tileMin, home }: LibraryProps) {
  const index = useIndex();
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
  const query: LibraryQuery = useMemo(() => ({ groups: starred ? { ...groups, star: [STARRED] } : groups, text: search, ...(browse ? { browse } : {}) }), [groups, search, starred, browse]);
  const rows = useMemo(() => index ?? rowsFromEntries(entries), [index, entries]);
  const prepared = useMemo(() => (browse ? browseOrder(prepare(rows, data)) : prepare(rows, data)), [rows, data, browse]);
  const faceted = useMemo(() => facet(prepared, query), [prepared, query]);
  const shown = faceted.shown;
  // What the pane holds with no filter of the viewer's: what the grid can show then (Starred's star stays picked), by the grid's own rule.
  const paneTotal = useMemo(() => facet(prepared, { groups: starred ? { star: [STARRED] } : {}, text: '', ...(browse ? { browse } : {}) }).shown.length, [prepared, starred, browse]);
  const at = active === null ? -1 : shown.findIndex((p) => p.row.key === active);
  const byKey = useMemo(() => new Map(prepared.map((p) => [p.row.key, p])), [prepared]);
  const selectedSet = useMemo(() => new Set(selection), [selection]);
  const chosen = useMemo(() => selection.map((k) => byKey.get(k)).filter((p): p is Prepared => !!p), [selection, byKey]);
  const onChosen = home?.onChosen;
  useEffect(() => onChosen?.(chosen), [chosen, onChosen]);

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

  const handlers = useRef({ onLoad, onAdd, onPress, onSearch, shown, selection, anchor, active, entryOf, query, current, indexed: !!index });
  handlers.current = { onLoad, onAdd, onPress, onSearch, shown, selection, anchor, active, entryOf, query, current, indexed: !!index };

  // Playing from the grid: open it, and have ←, → and R follow the grid (the deck keeps a loaded playlist).
  const following = useRef(false);
  const play = useCallback((p: Prepared) => {
    const h = handlers.current;
    h.onLoad(h.entryOf(p));
    // Until the index has loaded, the grid's rows are a guess Rust's resolve may not agree with: play with nothing followed.
    if (!h.indexed) return;
    following.current = true;
    followGrid(h.query, p.row.path);
  }, []);
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
    // The first ⇧ move or click runs from the highlighted tile.
    const from = rangeAnchor(h.anchor, h.active, h.shown);
    setSelection(pickInto(h.selection, h.shown, i, how, from));
    setActive(p.row.key);
    setError(null);
    if (how !== 'range') setAnchor(p.row.key);
    else if (from !== h.anchor) setAnchor(from);
    if (how === 'load') play(p);
  }, []);
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
      <div className="lib" data-drop={drop.over ? '' : undefined}>
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
    (ev.currentTarget.closest('.lib')?.querySelector('.lib-grid') as HTMLElement | null)?.focus();
  };

  const searchInputBox = (
    <input
      ref={searchInput}
      className="lib-search"
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
  // On the home the search is type on the pane: a ⌕, the text, and a ✕ to clear it.
  const searchBox = home ? (
    <div className="lib-search-field">
      <span className="lib-search-glyph" aria-hidden="true">
        ⌕
      </span>
      {searchInputBox}
      {search && (
        <button type="button" className="lib-search-clear" aria-label={say('clear search')} title={Say('clear search')} onClick={clearSearch}>
          <span aria-hidden="true">✕</span>
        </button>
      )}
    </div>
  ) : (
    searchInputBox
  );
  // On the home the chips wait behind "Filter"; the editor's column always shows them.
  const chipsShown = !empty && filters;
  const title = home && (
    <div className="lib-head">
      {home.menu}
      <h1 className="lib-title-head">{home.title}</h1>
      <span className="lib-count" title={filtered ? `${count(shown.length)} of ${count(paneTotal)} presets shown` : undefined}>
        {count(filtered ? shown.length : paneTotal)}
      </span>
      <span className="lib-fill" />
      {searchBox}
      <button
        type="button"
        className="lib-filter"
        aria-expanded={filters}
        aria-label={pickedCount ? `${say('facets')}, ${pickedCount} picked` : say('facets')}
        title={filters ? 'Hide the filter' : 'Filter by style, author, colour, speed, intensity, star or your tags'}
        onClick={flipFilters}
        disabled={empty}
      >
        {Say('facets')}
        {pickedCount > 0 && (
          <span className="lib-filter-badge" aria-hidden="true">
            {pickedCount}
          </span>
        )}
      </button>
    </div>
  );
  // Nothing to show: what didn't match, why, and the way back (decision 68).
  const noneTitle = search.trim() ? `“${search.trim()}”` : `“${picked.flatMap((g) => groups[g]!.map((v) => unstarred(valueLabel(g, v)))).join(', ')}”`;
  const emptyState = !home ? null : filtered ? (
    <div className="lib-empty">
      <span className="lib-empty-glyph" aria-hidden="true">
        ⌕
      </span>
      <h2 className="lib-empty-title">
        {say('no matches')} {noneTitle}
      </h2>
      <p className="lib-empty-why">{search.trim() ? say('no matches search why') : say('no matches filter why')}</p>
      {search.trim() ? (
        <button type="button" className="lib-empty-clear" onClick={clearSearch}>
          {Say('clear search')}
        </button>
      ) : (
        <button
          type="button"
          className="lib-empty-clear"
          onClick={() => {
            clearAll();
            searchInput.current?.focus();
          }}
        >
          {Say('clear filter')}
        </button>
      )}
    </div>
  ) : (
    <div className="lib-empty">
      <span className="lib-empty-glyph" aria-hidden="true">
        ☆
      </span>
      <h2 className="lib-empty-title">{say('starred empty')}</h2>
      <p className="lib-empty-why">{say('starred empty why')}</p>
    </div>
  );

  return (
    <div className={home ? 'lib lib-home' : 'lib'} data-drop={drop.over ? '' : undefined}>
      {title || searchBox}
      {chipsShown && (
        <div className="lib-chips" role="group" aria-label="groups">
          {GROUPS.filter((g) => !(starred && g === 'star')).map((g) => {
            const on = query.groups[g]?.length ?? 0;
            // Until the index is read there is no look to count, so these wait rather than show nothing.
            const waiting = !index && LOOK_GROUPS.includes(g);
            return (
              <button
                key={g}
                type="button"
                className="lib-chip"
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
                {home ? groupTitle(g) : GROUP_LABEL[g]}
                {on > 0 && (
                  <span className="lib-chip-count" aria-hidden="true">
                    {on}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {chipsShown && open && !(!index && LOOK_GROUPS.includes(open)) && (
        <Values group={open} values={valuesFor(open, faceted, query)} selected={query.groups[open] ?? []} find={find} onFind={setFind} onPick={(v) => pickValue(open, v)} home={!!home} />
      )}
      {/* On the home, a search alone that finds nothing has only the centred state: its line would say "0 presets" and offer to save nothing. */}
      {filtered && !(home && !picked.length && !shown.length) && (
        <div className="lib-picked">
          {picked.flatMap((g) =>
            groups[g]!.map((v) => (
              <button
                key={`${g}:${v}`}
                type="button"
                className="lib-chip lib-chip-picked"
                aria-label={`stop filtering by ${unstarred(valueLabel(g, v))}`}
                title={`Stop filtering by ${valueLabel(g, v)}`}
                onClick={() => pickValue(g, v)}
              >
                {g === 'colour' && <span className="lib-swatch" aria-hidden="true" style={{ background: SWATCH[v as Colour] }} />}
                {valueLabel(g, v)}{' '}
                <span className="lib-x" aria-hidden="true">
                  {home ? '✕' : '×'}
                </span>
              </button>
            )),
          )}
          {home && (
            <>
              <span className="lib-picked-count" role="status">
                {summary}
              </span>
              <span className="lib-fill" />
            </>
          )}
          <button type="button" className="lib-link" aria-label="clear the filter" onClick={clearAll} title="Show every preset">
            {home ? 'Clear' : 'clear'}
          </button>
          {naming === null ? (
            <button type="button" className="lib-link" onClick={() => setNaming(queryName(query))} title="Keep this filter as a playlist that fills itself">
              {home ? Say('save query') : say('save query')}
            </button>
          ) : (
            <input
              className="lib-name-input"
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
        </div>
      )}
      {home ? (
        <>
          {(saveNote || drop.note) && (
            <div className="lib-summary" role="status" data-error={drop.note?.error ? '' : undefined}>
              {[saveNote, drop.note?.text].filter(Boolean).join(' · ')}
            </div>
          )}
          {!empty && !starred && <PackOffer />}
        </>
      ) : (
        (summary || saveNote) && (
          <div className="lib-summary" role="status">
            {[summary, saveNote].filter(Boolean).join(' · ')}
          </div>
        )
      )}
      {!loaded && !index ? (
        <p className="lib-note" role="status">
          {home ? 'Loading presets…' : 'loading presets…'}
        </p>
      ) : empty ? (
        <p className="lib-note lib-first-run">No presets yet. Drop .milk files or a folder of them here, or use Add a folder… {home ? 'in Settings (⚙)' : 'below'}.</p>
      ) : home && !shown.length && (filtered || starred) ? (
        emptyState
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

/** An open group's values, each with the count of presets it would show. */
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
        className="lib-chip lib-value"
        aria-pressed={selected.includes(value)}
        // A sub-style shows only its own name; read aloud, it says which style it is under.
        aria-label={valueSays(valueLabel(group, value), n)}
        data-sub={sub ? '' : undefined}
        onClick={() => onPick(value)}
      >
        {group === 'colour' && <span className="lib-swatch" aria-hidden="true" style={{ background: SWATCH[value as Colour] }} />}
        <span className="lib-value-name">{sub ? value.slice(value.indexOf('/') + 1) : valueLabel(group, value)}</span>
        <span className="lib-value-count">{count(n)}</span>
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
    <div className="lib-values" role="group" aria-label={`${groupSays(group)} values`}>
      {values.length > FIND_FROM && (
        <input className="lib-values-find" type="search" aria-label={findSays(group)} placeholder={findSays(group)} value={find} onChange={(ev) => onFind(ev.target.value)} />
      )}
      {all.length === 0 && <p className="lib-note">{group === 'tags' && !values.length ? 'No tags yet. Select a preset to tag it.' : 'none'}</p>}
      {levels ? (
        <>
          <div className="lib-values-list">{tops.map(button)}</div>
          {[...subsOf].map(([parent, subs]) => (
            <div key={parent} className="lib-values-subs" role="group" aria-label={`in ${parent}`}>
              <span className="lib-values-in">{`In ${parent}`}</span>
              {subs.map(button)}
            </div>
          ))}
        </>
      ) : (
        <div className="lib-values-list">
          {list.flatMap((v, i) => [
            // Each style starts a line, with its sub-styles after it.
            group === 'style' && i > 0 && !v.value.includes('/') ? <span key={`break:${v.value}`} className="lib-break" /> : null,
            button(v),
          ])}
        </div>
      )}
      {more > 0 && <p className="lib-note">{count(more)} more: type to find one</p>}
    </div>
  );
}
