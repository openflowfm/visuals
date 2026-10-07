import { memo, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent } from 'react';
import { ButtonFace } from '@openflow/widgets/controls/ButtonFace.tsx';
import type { Entry } from './api.ts';
import { foundSummary, rowFor, type Found } from './librarySearch.ts';
import './library.css';

export interface LibraryProps {
  /** The whole library. */
  entries: Entry[];
  /** False until the first presets() answer arrives. */
  loaded: boolean;
  search: string;
  onSearch(next: string): void;
  /** searchLibrary(entries, search), computed by the App. */
  found: Found;
  /** Path of the preset playing. */
  current: string | null;
  /** The playlist the + adds to; null hides +. */
  into: { id: string; name: string } | null;
  onLoad(e: Entry): void;
  onAdd(e: Entry): void;
}

const count = (n: number) => n.toLocaleString('en-US');

/**
 * The preset library: a search box over a listbox of presets.
 *
 * The list is one tab stop and moves a highlighted row with `aria-activedescendant`,
 * so the rows stay plain `<li>`s and only the two rows whose highlight changes re-render.
 */
export function Library({ entries, loaded, search, onSearch, found, current, into, onLoad, onAdd }: LibraryProps) {
  const id = useId();
  const rowId = (i: number) => `${id}-row-${i}`;
  const list = useRef<HTMLUListElement>(null);
  const [active, setActive] = useState<string | null>(null);
  const shown = found.shown;
  const at = active === null ? -1 : shown.findIndex((e) => e.path === active);

  // Stable callbacks so the memoized rows don't all re-render when the App's change.
  const handlers = useRef({ onLoad, onAdd });
  handlers.current = { onLoad, onAdd };
  const load = useCallback((e: Entry) => {
    setActive(e.path);
    handlers.current.onLoad(e);
  }, []);
  const add = useCallback((e: Entry) => handlers.current.onAdd(e), []);

  const reveal = useCallback(
    (i: number) => {
      if (i >= 0) document.getElementById(`${id}-row-${i}`)?.scrollIntoView({ block: 'nearest' });
    },
    [id],
  );

  // Keep the highlighted row in view as it moves.
  useEffect(() => reveal(at), [at, reveal]);

  // Bring the playing row into view when it changes.
  useEffect(() => {
    if (current === null) return;
    reveal(shown.findIndex((e) => e.path === current));
  }, [current]); // only on a new preset, not on every search keystroke

  const move = (to: number) => setActive(to >= 0 ? shown[to].path : null);

  const onListKey = (ev: KeyboardEvent<HTMLUListElement>) => {
    if (ev.target !== ev.currentTarget) return; // keys on the list itself, not a row's + button
    const to = rowFor(ev.key, at, shown.length);
    if (to !== null) {
      move(to);
    } else if ((ev.key === 'Enter' || ev.key === ' ') && at >= 0) {
      load(shown[at]);
    } else if ((ev.key === '+' || ev.key === 'a' || ev.key === 'A') && at >= 0 && into) {
      onAdd(shown[at]);
    } else {
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
  };

  const onListFocus = (ev: FocusEvent<HTMLUListElement>) => {
    if (ev.target !== ev.currentTarget || at >= 0 || !shown.length) return;
    const playing = current === null ? -1 : shown.findIndex((e) => e.path === current);
    move(playing >= 0 ? playing : 0);
  };

  const onSearchKey = (ev: KeyboardEvent<HTMLInputElement>) => {
    if (ev.key !== 'ArrowDown' || !shown.length) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (at < 0) move(0);
    list.current?.focus();
  };

  const summary = foundSummary(found, search);
  const empty = loaded && entries.length === 0;

  return (
    <div className="lib">
      <input
        className="lib-search"
        type="search"
        aria-label="search presets"
        placeholder={`search ${count(entries.length)} presets`}
        title="Every word must match the preset's group or name. ↓ moves into the list."
        value={search}
        onChange={(ev) => onSearch(ev.target.value)}
        onKeyDown={onSearchKey}
        disabled={empty}
      />
      {summary && (
        <div className="lib-summary" role="status">
          {summary}
        </div>
      )}
      {!loaded ? (
        <p className="lib-note">loading presets…</p>
      ) : empty ? (
        <p className="lib-note lib-first-run">
          No presets found. Put .milk files in ~/.openflow/visuals/presets (or point OPENFLOW_VISUALS_PRESETS at a
          folder of them) and restart.
        </p>
      ) : (
        <ul
          ref={list}
          className="lib-list"
          role="listbox"
          aria-label="presets"
          tabIndex={shown.length ? 0 : -1}
          aria-activedescendant={at >= 0 ? rowId(at) : undefined}
          data-hint={`↑ ↓ Home End PageUp PageDown move, Enter loads the preset${into ? `, + or A adds it to ${into.name}` : ''}`}
          onKeyDown={onListKey}
          onFocus={onListFocus}
        >
          {shown.map((e, i) => (
            <Row
              key={e.path}
              id={rowId(i)}
              entry={e}
              active={i === at}
              playing={e.path === current}
              intoName={into?.name ?? null}
              onLoad={load}
              onAdd={add}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface RowProps {
  id: string;
  entry: Entry;
  active: boolean;
  playing: boolean;
  intoName: string | null;
  onLoad(e: Entry): void;
  onAdd(e: Entry): void;
}

const Row = memo(function Row({ id, entry, active, playing, intoName, onLoad, onAdd }: RowProps) {
  const full = entry.group ? `${entry.group} / ${entry.name}` : entry.name;
  return (
    <li
      id={id}
      className="lib-row"
      role="option"
      aria-selected={playing}
      data-active={active ? '' : undefined}
      data-playing={playing ? '' : undefined}
      title={playing ? `${full} (playing)` : full}
      onClick={() => onLoad(entry)}
    >
      <span className="lib-name">{entry.name}</span>
      {entry.group && <span className="lib-group">{entry.group}</span>}
      {intoName !== null && (
        // Out of the tab order: the listbox is one tab stop, and + on the list adds the active row.
        <div className="wdg wdg-button lib-add">
          <ButtonFace
            tone="quiet"
            tabIndex={-1}
            aria-label={`add “${entry.name}” to ${intoName} (+ key)`}
            title={`add “${entry.name}” to ${intoName} (+ key)`}
            onClick={(ev) => {
              ev.stopPropagation();
              onAdd(entry);
            }}
          >
            +
          </ButtonFace>
        </div>
      )}
    </li>
  );
});
