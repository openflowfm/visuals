import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
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
import { say } from './words.ts';
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
export function Library({ entries, loaded, search, onSearch, current, into, onLoad, onAdd, onPress, tileMin }: LibraryProps) {
  const index = useIndex();
  const [data, setData] = useLibraryData();
  const [groups, setGroups] = useState<LibraryQuery['groups']>({});
  const [open, setOpen] = useState<LibraryGroup | null>(null);
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

  const query: LibraryQuery = useMemo(() => ({ groups, text: search }), [groups, search]);
  const rows = useMemo(() => index ?? rowsFromEntries(entries), [index, entries]);
  const prepared = useMemo(() => prepare(rows, data), [rows, data]);
  const faceted = useMemo(() => facet(prepared, query), [prepared, query]);
  const shown = faceted.shown;
  const at = active === null ? -1 : shown.findIndex((p) => p.row.key === active);
  const byKey = useMemo(() => new Map(prepared.map((p) => [p.row.key, p])), [prepared]);
  const selectedSet = useMemo(() => new Set(selection), [selection]);
  const chosen = useMemo(() => selection.map((k) => byKey.get(k)).filter((p): p is Prepared => !!p), [selection, byKey]);

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

  const handlers = useRef({ onLoad, onAdd, onPress, onSearch, shown, selection, anchor, active, entryOf, query, current });
  handlers.current = { onLoad, onAdd, onPress, onSearch, shown, selection, anchor, active, entryOf, query, current };

  // Playing from the grid: open it, and have ←, → and R follow the grid (the deck keeps a loaded playlist).
  const following = useRef(false);
  const play = useCallback((p: Prepared) => {
    const h = handlers.current;
    h.onLoad(h.entryOf(p));
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
    api.smartPlaylistSave(name.trim() || queryName(query), query).then(
      () => setSaveNote(`Saved “${name.trim() || queryName(query)}”.`),
      (e) => setSaveNote(why(e)),
    );
  };

  const empty = loaded && entries.length === 0 && !rows.length;
  const filtered = activeGroups(query).length > 0 || search.trim() !== '';
  const summary = facetSummary(faceted, query);

  const bar = <PackBar presets={entries.length} dropped={drop.note} credits={credits} onCredits={() => setCredits((c) => !c)} />;
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

  return (
    <div className="lib" data-drop={drop.over ? '' : undefined}>
      <input
        className="lib-search"
        type="search"
        aria-label="search presets"
        placeholder={`search ${count(rows.length || entries.length)} presets`}
        title="Every word must match the preset's style, author, name or tags. ↓ moves into the grid."
        value={search}
        onChange={(ev) => {
          filterChanged();
          onSearch(ev.target.value);
        }}
        onKeyDown={onSearchKey}
        disabled={empty}
      />
      {!empty && (
        <div className="lib-chips" role="group" aria-label="groups">
          {GROUPS.map((g) => {
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
                {GROUP_LABEL[g]}
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
      {open && !(!index && LOOK_GROUPS.includes(open)) && (
        <Values group={open} values={valuesFor(open, faceted, query)} selected={query.groups[open] ?? []} find={find} onFind={setFind} onPick={(v) => pickValue(open, v)} />
      )}
      {filtered && (
        <div className="lib-picked">
          {activeGroups(query).flatMap((g) =>
            query.groups[g]!.map((v) => (
              <button
                key={`${g}:${v}`}
                type="button"
                className="lib-chip lib-chip-picked"
                aria-label={`stop filtering by ${unstarred(valueLabel(g, v))}`}
                title={`Stop filtering by ${valueLabel(g, v)}`}
                onClick={() => pickValue(g, v)}
              >
                {g === 'colour' && <span className="lib-swatch" aria-hidden="true" style={{ background: SWATCH[v as Colour] }} />}
                {valueLabel(g, v)} <span aria-hidden="true">×</span>
              </button>
            )),
          )}
          <button type="button" className="lib-link" aria-label="clear the filter" onClick={clearAll} title="Show every preset">
            clear
          </button>
          {naming === null ? (
            <button type="button" className="lib-link" onClick={() => setNaming(queryName(query))} title="Keep this filter as a playlist that fills itself">
              {say('save query')}
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
      {(summary || saveNote) && (
        <div className="lib-summary" role="status">
          {[summary, saveNote].filter(Boolean).join(' · ')}
        </div>
      )}
      {!loaded && !index ? (
        <p className="lib-note" role="status">
          loading presets…
        </p>
      ) : empty ? (
        <p className="lib-note lib-first-run">No presets yet. Drop .milk files or a folder of them here, or use Add a folder… below.</p>
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
      {chosen.length > 0 && !empty && (
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
}

/** An open group's values, each with the count of presets it would show. */
export function Values({ group, values, selected, find, onFind, onPick }: ValuesProps) {
  const f = find.trim().toLowerCase();
  const all = f ? values.filter((v) => valueLabel(group, v.value).toLowerCase().includes(f)) : values;
  const list = all.slice(0, VALUES_CAP);
  return (
    <div className="lib-values" role="group" aria-label={`${groupSays(group)} values`}>
      {values.length > FIND_FROM && (
        <input
          className="lib-values-find"
          type="search"
          aria-label={`find a ${groupSays(group).replace(/^my /, '')}`}
          placeholder={`find a ${GROUP_LABEL[group].replace(/^my /, '')}`}
          value={find}
          onChange={(ev) => onFind(ev.target.value)}
        />
      )}
      {list.length === 0 && <p className="lib-note">{group === 'tags' && !values.length ? 'No tags yet. Select a preset to tag it.' : 'none'}</p>}
      <div className="lib-values-list">
        {list.flatMap(({ value, count: n }, i) => {
          const sub = group === 'style' && value.includes('/');
          return [
            // Each style starts a line, with its sub-styles after it.
            group === 'style' && i > 0 && !value.includes('/') ? <span key={`break:${value}`} className="lib-break" /> : null,
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
            </button>,
          ];
        })}
      </div>
      {all.length > list.length && <p className="lib-note">{count(all.length - list.length)} more: type to find one</p>}
    </div>
  );
}
