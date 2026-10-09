import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import * as api from './api.ts';
import type { Entry, LibraryChange, LibraryData, LibraryGroup, LibraryQuery, LibraryRow } from './api.ts';
import * as pl from './playlists.ts';
import { onChanged } from './pack.ts';
import { rereadOn } from './library.ts';
import {
  GROUPS,
  GROUP_LABEL,
  SWATCH,
  activeGroups,
  debounced,
  facet,
  facetSummary,
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
import { LibraryGrid, pickInto, type Pick } from './LibraryGrid.tsx';
import { PresetDrawer } from './PresetDrawer.tsx';
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
}

const count = (n: number) => n.toLocaleString('en-US');
const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** How long the folder has to be quiet before the index is read again, and the longest it waits while it isn't. */
const REREAD = { wait: 500, most: 4000 };

/** A group with more values than this gets a box to find one. */
const FIND_FROM = 12;
/** The most values an open group lists at once (authors run to thousands); the find box reaches the rest. */
const VALUES_CAP = 150;

/** The index rows, read again (debounced) as the presets folder changes; null until read, or when it can't be. */
function useIndex(): LibraryRow[] | null {
  const [index, setIndex] = useState<LibraryRow[] | null>(null);
  useEffect(() => {
    const read = () => void api.libraryIndex().then(setIndex, () => {});
    read();
    const reread = debounced(read, REREAD.wait, REREAD.most);
    const stop = rereadOn(onChanged, reread);
    return () => {
      reread.cancel();
      stop();
    };
  }, []);
  return index;
}

/** The user's library data, followed through `library-changed`; null until read. */
function useLibraryData(): [LibraryData | null, (d: LibraryData) => void] {
  const [data, setData] = useState<LibraryData | null>(null);
  useEffect(() => {
    api.libraryData().then(setData, () => {});
    return rereadOnData(setData);
  }, []);
  return [data, setData];
}

function rereadOnData(set: (d: LibraryData) => void): () => void {
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
export function Library({ entries, loaded, search, onSearch, current, into, onLoad, onAdd }: LibraryProps) {
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

  const handlers = useRef({ onLoad, onAdd, shown, selection, anchor, entryOf });
  handlers.current = { onLoad, onAdd, shown, selection, anchor, entryOf };
  const pick = useCallback((i: number, how: Pick) => {
    const h = handlers.current;
    const p = h.shown[i];
    if (!p) return;
    setSelection(pickInto(h.selection, h.shown, i, how, h.anchor));
    setActive(p.row.key);
    setError(null);
    if (how !== 'range') setAnchor(p.row.key);
    if (how === 'load') h.onLoad(h.entryOf(p));
  }, []);
  const add = useCallback((i: number) => {
    const h = handlers.current;
    if (h.shown[i]) h.onAdd(h.entryOf(h.shown[i]));
  }, []);
  const moveTo = useCallback((i: number) => setActive(handlers.current.shown[i]?.row.key ?? null), []);
  const clear = useCallback(() => setSelection([]), []);

  const set = (keys: string[], change: LibraryChange) => {
    setError(null);
    api.librarySet(keys, change).then(setData, (e) => setError(`Couldn't save that: ${why(e)}`));
  };

  const pickValue = (g: LibraryGroup, v: string) => {
    setGroups((gs) => toggle({ groups: gs, text: '' }, g, v).groups);
    setSaveNote(null);
  };
  const clearAll = () => {
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
        onChange={(ev) => onSearch(ev.target.value)}
        onKeyDown={onSearchKey}
        disabled={empty}
      />
      {!empty && (
        <div className="lib-chips" role="group" aria-label="groups">
          {GROUPS.map((g) => {
            const on = query.groups[g]?.length ?? 0;
            return (
              <button
                key={g}
                type="button"
                className="lib-chip"
                aria-expanded={open === g}
                data-on={on ? '' : undefined}
                title={`Show only presets with these ${GROUP_LABEL[g]} values; pick several to see any of them`}
                onClick={() => {
                  setOpen((o) => (o === g ? null : g));
                  setFind('');
                }}
              >
                {GROUP_LABEL[g]}
                {on > 0 && <span className="lib-chip-count">{on}</span>}
              </button>
            );
          })}
        </div>
      )}
      {open && <Values group={open} values={valuesFor(open, faceted, query)} selected={query.groups[open] ?? []} find={find} onFind={setFind} onPick={(v) => pickValue(open, v)} />}
      {filtered && (
        <div className="lib-picked">
          {activeGroups(query).flatMap((g) =>
            query.groups[g]!.map((v) => (
              <button key={`${g}:${v}`} type="button" className="lib-chip lib-chip-picked" title={`Stop filtering by ${valueLabel(g, v)}`} onClick={() => pickValue(g, v)}>
                {g === 'colour' && <span className="lib-swatch" style={{ background: SWATCH[v as Colour] }} />}
                {valueLabel(g, v)} ×
              </button>
            )),
          )}
          <button type="button" className="lib-link" onClick={clearAll} title="Show every preset">
            clear
          </button>
          {naming === null ? (
            <button type="button" className="lib-link" onClick={() => setNaming(queryName(query))} title="Keep this filter as a playlist that fills itself">
              save as smart playlist
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
        <p className="lib-note">loading presets…</p>
      ) : empty ? (
        <p className="lib-note lib-first-run">No presets yet. Drop .milk files or a folder of them here, or use Add a folder… below.</p>
      ) : (
        <LibraryGrid rows={shown} active={at} selected={selectedSet} current={current} into={into} onMove={moveTo} onPick={pick} onAdd={add} onClear={clear} reveal={reveal} />
      )}
      {chosen.length > 0 && !empty && (
        <PresetDrawer key={selection.join('\n')} chosen={chosen} playlists={lists} current={current} onSet={set} onLoad={(p) => onLoad(entryOf(p))} onClose={clear} error={error} />
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
function Values({ group, values, selected, find, onFind, onPick }: ValuesProps) {
  const f = find.trim().toLowerCase();
  const all = f ? values.filter((v) => valueLabel(group, v.value).toLowerCase().includes(f)) : values;
  const list = all.slice(0, VALUES_CAP);
  return (
    <div className="lib-values" role="group" aria-label={`${GROUP_LABEL[group]} values`}>
      {values.length > FIND_FROM && (
        <input
          className="lib-values-find"
          type="search"
          aria-label={`find a ${GROUP_LABEL[group]}`}
          placeholder={`find a ${GROUP_LABEL[group].replace(/^my /, '')}`}
          value={find}
          onChange={(ev) => onFind(ev.target.value)}
        />
      )}
      {list.length === 0 && <p className="lib-note">{group === 'tags' && !values.length ? 'No tags yet. Select a preset to tag it.' : 'none'}</p>}
      <div className="lib-values-list">
        {list.flatMap(({ value, count: n }, i) => [
          // Each style starts a line, with its sub-styles after it.
          group === 'style' && i > 0 && !value.includes('/') ? <span key={`break:${value}`} className="lib-break" /> : null,
          <button
            key={value}
            type="button"
            className="lib-chip lib-value"
            aria-pressed={selected.includes(value)}
            data-sub={group === 'style' && value.includes('/') ? '' : undefined}
            onClick={() => onPick(value)}
          >
            {group === 'colour' && <span className="lib-swatch" style={{ background: SWATCH[value as Colour] }} />}
            <span className="lib-value-name">{group === 'style' && value.includes('/') ? value.slice(value.indexOf('/') + 1) : valueLabel(group, value)}</span>
            <span className="lib-value-count">{count(n)}</span>
          </button>,
        ])}
      </div>
      {all.length > list.length && <p className="lib-note">{count(all.length - list.length)} more: type to find one</p>}
    </div>
  );
}
