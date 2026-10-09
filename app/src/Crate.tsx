import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { LibraryData } from './api.ts';
import * as pl from './playlists.ts';
import { plural } from './controls.ts';
import { nameOf } from './shell.ts';
import { say } from './words.ts';

/** How many presets "Up next" shows until "Show all" is open. */
export const UP_NEXT = 4;

/** The most "Show all" lists: a smart playlist or a mood can match thousands. */
export const UP_NEXT_ALL = 100;

/** One mood: a tag of the user's own, and how many presets carry it. */
export interface Mood {
  tag: string;
  count: number;
}

/** The user's tags as moods, the most used first, then by name. Hidden presets count too: a mood never plays them, but they were tagged. */
export function moods(data: LibraryData | null): Mood[] {
  const counts = new Map<string, number>();
  for (const mine of Object.values(data?.presets ?? {})) for (const tag of new Set(mine.tags ?? [])) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * Whether `query` is a mood: what the chips play, the user's tags and nothing
 * else. Any other filter (the library grid's, followed when a preset is played
 * from it) is "the library", never a mood.
 */
export function isMood(query: pl.Deck['query']): boolean {
  if (!query || query.text.trim() !== '') return false;
  const groups = Object.entries(query.groups).filter(([, v]) => (v?.length ?? 0) > 0);
  return groups.length === 1 && groups[0][0] === 'tags';
}

/** The moods playing: the tags of the deck's filter, when a mood (not a playlist, nor the library grid's filter) plays. */
export function litMoods(deck: pl.Deck): string[] {
  if (deck.playlist !== null || !isMood(deck.query)) return [];
  return deck.query?.groups.tags ?? [];
}

/** The filter that plays the presets tagged with any of `tags`. */
export const moodQuery = (tags: string[]) => ({ groups: { tags }, text: '' });

/**
 * What tapping the chip for `tag` does, with `lit` playing: an unlit chip plays
 * its mood, or joins the ones playing (presets with any of the tags); a lit one
 * leaves, and when it was the last, nothing new plays.
 */
export function chipAction(lit: readonly string[], tag: string): pl.Action {
  if (!lit.includes(tag)) return { kind: 'query', query: moodQuery([...lit, tag]) };
  const rest = lit.filter((t) => t !== tag);
  return rest.length ? { kind: 'query', query: moodQuery(rest) } : { kind: 'unload' };
}

/** The playlist playing, when it is a manual one played in order: the only kind whose next presets can be dragged into a new order. */
export function orderable(lists: pl.Lists): pl.Playlist | null {
  const { deck } = lists;
  if (!deck.playlist || deck.query) return null;
  const list = lists.playlists.find((p) => p.id === deck.playlist);
  return list && list.kind === 'manual' && deck.order === 'in_order' ? list : null;
}

/** Whether "Up next" needs `deckItems` to know the play order: anything playing but a manual playlist in order. */
export const needsDeckItems = (lists: pl.Lists): boolean => (lists.deck.playlist !== null || lists.deck.query !== null) && !orderable(lists);

/** One row of "Up next". */
export interface Upcoming {
  path: string;
  name: string;
  /** The file is not there (any more). */
  missing: boolean;
  /** The row's index in the playlist's items, when it can be dragged; null otherwise. */
  at: number | null;
}

/**
 * The next `n` presets, in play order, never the one playing and never the whole
 * list twice. A manual playlist in order reads its own items from the deck's
 * `next_index` on, round past the end; anything else reads `items` (what
 * `deckItems` gave) from after the playing preset. Nothing plays: none.
 */
export function upcoming(lists: pl.Lists, items: readonly string[] | null, n = UP_NEXT): Upcoming[] {
  const { deck } = lists;
  const list = orderable(lists);
  if (list) {
    const len = list.items.length;
    if (len === 0) return [];
    const index = deck.index !== null && deck.index < len ? deck.index : null;
    const start = deck.next_index !== null && deck.next_index < len ? deck.next_index : index === null ? 0 : (index + 1) % len;
    const out: Upcoming[] = [];
    for (let k = 0; k < Math.min(n, index === null ? len : len - 1); k++) {
      const at = (start + k) % len;
      const item = list.items[at];
      out.push({ path: item.path, name: item.name, missing: item.missing, at });
    }
    return out;
  }
  if (!items?.length || (deck.playlist === null && deck.query === null)) return [];
  const playing = deck.playlist ? lists.playlists.find((p) => p.id === deck.playlist) : undefined;
  const known = new Map((playing?.items ?? []).map((i) => [i.path, i]));
  const pos = deck.current ? items.indexOf(deck.current) : -1;
  const out: Upcoming[] = [];
  for (let k = 0; k < Math.min(n, pos >= 0 ? items.length - 1 : items.length); k++) {
    const path = items[(pos + 1 + k) % items.length];
    const item = known.get(path);
    out.push({ path, name: item?.name ?? nameOf(path), missing: item?.missing ?? false, at: null });
  }
  return out;
}

/**
 * The rows after the deck's Next line: `rows` without its first when that is
 * the preset the Next line already names (`next`, by path).
 */
export function afterNext(rows: readonly Upcoming[], next: string | null): Upcoming[] {
  return next !== null && rows[0]?.path === next ? rows.slice(1) : [...rows];
}

/** The path the deck's Next line names, or null when it names none. */
export function nextPath(lists: pl.Lists): string | null {
  const says = pl.nextSays(lists, false);
  return says.kind === 'item' || says.kind === 'filter' ? says.item.path : null;
}

/** What VoiceOver hears on a row that can move: how to move it (the ≡ handle only shows on hover or focus). */
export const MOVE_NOTE = 'Alt+↑ or Alt+↓ moves it earlier or later.';

/** The line under "Up next" saying how its order works; null for a playlist in order, whose rows show their own ≡ handle. */
export function upNote(lists: pl.Lists): string | null {
  const { deck } = lists;
  if (deck.playlist === null && deck.query === null) return 'Play a playlist or a mood to see what comes next.';
  if (orderable(lists)) return null;
  if (deck.order === 'shuffle') return 'Shuffled: the order is picked as it plays.';
  if (deck.playlist === null) return isMood(deck.query) ? 'A mood plays in library order.' : `From ${say('library query')}, in its order.`;
  return 'A smart playlist plays its matches in library order.';
}

/** An up-next row's accessible name, saying when its file is missing (the strike-through doesn't). */
/** Where focus goes when "Show fewer" hides the rows past UP_NEXT: a focused hidden row hands it to the last row still shown; otherwise it stays put (null). */
export const collapseFocus = (focused: number): number | null => (focused >= UP_NEXT ? UP_NEXT - 1 : null);

export const rowLabel = (r: Pick<Upcoming, 'name' | 'missing'>): string => (r.missing ? `${r.name}, missing` : r.name);

/** Where a row dragged to `y` lands, from the rows' tops and heights: before row `slot`, or after the last when `slot` is their count. */
export function dropSlot(rows: readonly { top: number; height: number }[], y: number): number {
  return rows.filter((r) => r.top + r.height / 2 < y).length;
}

/**
 * The `moveItem` that puts row `row` before row `slot` (after the last when
 * `slot` is the row count), mapped back to the playlist's item indices — the
 * rows can wrap past its end. Null when the rows can't be dragged, or it
 * wouldn't move.
 */
export function moveFor(rows: readonly Upcoming[], row: number, slot: number): { from: number; to: number } | null {
  const from = rows[row]?.at;
  if (from === null || from === undefined || slot < 0 || slot > rows.length || slot === row || slot === row + 1) return null;
  const before = slot < rows.length ? rows[slot].at : (rows[rows.length - 1].at ?? -1) + 1;
  if (before === null || before < 0) return null;
  // `moveItem` takes the item out, then puts it back at `to`: what was after it moves up one.
  const to = from < before ? before - 1 : before;
  return to === from ? null : { from, to };
}

interface Props {
  lists: pl.Lists;
  data: LibraryData | null;
  act(action: pl.Action): void;
  onLists(lists: pl.Lists): void;
  onError(e: unknown): void;
  /** The preset on the bench, by path. */
  current: string | null;
}

/**
 * Live mode's crate: the playlists to play with one tap, the user's tags as
 * moods to play (and mix) once there are any, and what plays after the deck's
 * Next — four rows, the rest behind "Show all" — which, for a playlist in
 * order, can be dragged by the ≡ that shows on hover or focus (or Alt+↑ ↓) into
 * a new order.
 */
export function Crate({ lists, data, act, onLists, onError, current }: Props) {
  const { playlists, deck } = lists;
  const fetching = needsDeckItems(lists);
  const [items, setItems] = useState<string[] | null>(null);
  const query = JSON.stringify(deck.query);
  const playing = deck.current ?? current;
  useEffect(() => {
    if (!fetching) return setItems(null);
    let live = true;
    pl.deckItems().then((paths) => {
      if (live) setItems(paths);
    }, onError);
    return () => {
      live = false;
    };
    // `onError` is the page's; a new one each render isn't a reason to ask again.
  }, [fetching, deck.playlist, query, deck.order, playing]);

  const all = moods(data);
  const lit = litMoods(deck);
  const list = orderable(lists);
  const [expanded, setExpanded] = useState(false);
  // One more than "Show all" lists, as the first is usually the deck's Next line.
  const every = afterNext(upcoming({ ...lists, deck: { ...deck, current: playing } }, items, UP_NEXT_ALL + 1), nextPath(lists)).slice(0, UP_NEXT_ALL);
  const rows = expanded ? every : every.slice(0, UP_NEXT);
  const more = every.length > UP_NEXT;
  const note = upNote(lists);

  const refs = useRef<(HTMLLIElement | null)[]>([]);
  const [drag, setDrag] = useState<{ row: number; slot: number } | null>(null);
  // Moves map through every row, shown or not, so Alt+↓ on the last row shown still moves it (and opens the rest).
  const move = (row: number, slot: number) => {
    const m = list && moveFor(every, row, slot);
    if (list && m) pl.moveItem(list.id, m.from, m.to).then(onLists, onError);
  };
  const slotAt = (y: number) =>
    dropSlot(
      refs.current.slice(0, rows.length).map((el) => {
        const r = el?.getBoundingClientRect();
        return { top: r?.top ?? 0, height: r?.height ?? 0 };
      }),
      y,
    );
  const grab = (row: number) => (e: PointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ row, slot: row });
  };
  const drift = (e: PointerEvent) => {
    if (drag) setDrag({ ...drag, slot: slotAt(e.clientY) });
  };
  const drop = (e: PointerEvent) => {
    if (!drag) return;
    setDrag(null);
    move(drag.row, slotAt(e.clientY));
  };
  // Where keyboard focus goes once a nudged row lands: the rows are drawn again in their new order, and the moved one keeps focus.
  const refocus = useRef<number | null>(null);
  useEffect(() => {
    const at = refocus.current;
    if (at === null) return;
    refocus.current = null;
    refs.current[at]?.focus();
  }, [lists]);
  // "Show fewer" with focus on a row it hides: hand focus to the last row still shown rather than dropping it to the page.
  const toggle = () => {
    if (expanded) {
      const at = collapseFocus(refs.current.findIndex((el) => el !== null && el === document.activeElement));
      if (at !== null) refs.current[at]?.focus();
    }
    setExpanded(!expanded);
  };
  const nudge = (row: number) => (e: KeyboardEvent) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const slot = e.key === 'ArrowUp' ? row - 1 : row + 2;
    if (list && moveFor(every, row, slot)) {
      refocus.current = e.key === 'ArrowUp' ? row - 1 : row + 1;
      if (refocus.current >= rows.length) setExpanded(true);
    }
    move(row, slot);
  };
  const marker = (row: number) => {
    if (!drag || drag.slot === drag.row || drag.slot === drag.row + 1) return null;
    if (drag.slot === row) return <span className="live-crate-drop" data-at="before" aria-hidden="true" />;
    if (drag.slot === rows.length && row === rows.length - 1) return <span className="live-crate-drop" data-at="after" aria-hidden="true" />;
    return null;
  };

  return (
    <div className="live-crate">
      <section className="live-crate-section" aria-labelledby="live-crate-playlists">
        <h2 id="live-crate-playlists">Playlists</h2>
        {playlists.length === 0 ? (
          <p className="live-crate-note">No playlists yet: make one in the library, then tap it here to play it.</p>
        ) : (
          <ul className="live-crate-list">
            {playlists.map((p, i) => {
              const on = deck.playlist === p.id && !deck.query;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    className="live-crate-playlist"
                    data-on={on || undefined}
                    aria-current={on ? 'true' : undefined}
                    title={on ? `${p.name} is playing` : `Play ${p.name}`}
                    onClick={() => act({ kind: 'load', playlist: i, index: null })}
                  >
                    <span className="live-crate-name">{p.name}</span>
                    {p.kind === 'smart' && (
                      <span className="live-crate-smart" title="A smart playlist: whatever matches its filter">
                        smart
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Moods only once there are some: the user's tags, made in the library. */}
      {all.length > 0 && (
        <section className="live-crate-section" aria-labelledby="live-crate-moods">
          <h2 id="live-crate-moods">Moods</h2>
          <div className="live-crate-chips" role="group" aria-label="Moods">
            {all.map(({ tag, count }) => {
              const on = lit.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  className="live-crate-chip"
                  data-on={on || undefined}
                  aria-pressed={on}
                  title={`${plural(count, 'preset')} tagged ${tag}. ${on ? 'Tap to take it out' : lit.length ? 'Tap to mix it in' : 'Tap to play it'}`}
                  onClick={() => act(chipAction(lit, tag))}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className="live-crate-section" aria-labelledby="live-crate-next">
        <h2 id="live-crate-next">Up next</h2>
        {note !== null && <p className="live-crate-note">{note}</p>}
        {list && (
          <span className="live-sr" id="live-crate-next-note">
            {MOVE_NOTE}
          </span>
        )}
        {rows.length > 0 && (
          <ol className="live-crate-list" id="live-crate-next-rows" aria-label="Up next, in play order">
            {rows.map((r, i) => (
              <li
                key={`${r.at ?? 'x'}:${i}:${r.path}`}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                className="live-crate-row"
                data-missing={r.missing || undefined}
                data-dragging={drag?.row === i || undefined}
                tabIndex={list ? 0 : undefined}
                aria-keyshortcuts={list ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
                aria-label={rowLabel(r)}
                aria-describedby={list ? 'live-crate-next-note' : undefined}
                onKeyDown={list ? nudge(i) : undefined}
                title={r.missing ? `${r.name}: the file is missing` : r.name}
              >
                {marker(i)}
                <span className="live-crate-name">{r.missing ? <s>{r.name}</s> : r.name}</span>
                {list && (
                  <span
                    className="live-crate-handle"
                    aria-hidden="true"
                    title="Drag to change when it plays (or Alt+↑ ↓)"
                    onPointerDown={grab(i)}
                    onPointerMove={drift}
                    onPointerUp={drop}
                    onPointerCancel={() => setDrag(null)}
                  >
                    ≡
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
        {more && (
          <button type="button" className="live-crate-more" aria-expanded={expanded} aria-controls="live-crate-next-rows" onClick={toggle}>
            {expanded ? 'Show fewer' : 'Show all'}
          </button>
        )}
      </section>
    </div>
  );
}
