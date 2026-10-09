import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { LibraryData } from './api.ts';
import * as pl from './playlists.ts';
import { plural } from './controls.ts';
import { nameOf } from './shell.ts';
import { say } from './words.ts';

/** How many presets "Up next" shows. */
export const UP_NEXT = 8;

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

/** The moods playing: the tags of the deck's filter, when a filter (not a playlist) plays. */
export function litMoods(deck: pl.Deck): string[] {
  if (deck.playlist !== null || !deck.query) return [];
  return deck.query.groups.tags ?? [];
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

/** The line under "Up next" saying how its order works, or how to change it. */
export function upNote(lists: pl.Lists): string {
  const { deck } = lists;
  if (deck.playlist === null && deck.query === null) return 'Play a playlist or a mood to see what comes next.';
  if (orderable(lists)) return 'Drag ≡ (or press Alt+↑ ↓) to change what plays when.';
  if (deck.order === 'shuffle') return 'Shuffled: the order is picked as it plays.';
  if (deck.playlist === null) return 'A mood plays in library order.';
  return 'A smart playlist plays its matches in library order.';
}

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
 * moods to play (and mix), and what plays next — which, for a playlist in
 * order, can be dragged (or Alt+↑ ↓) into a new order.
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
  const rows = upcoming({ ...lists, deck: { ...deck, current: playing } }, items, UP_NEXT);

  const refs = useRef<(HTMLLIElement | null)[]>([]);
  const [drag, setDrag] = useState<{ row: number; slot: number } | null>(null);
  const move = (row: number, slot: number) => {
    const m = list && moveFor(rows, row, slot);
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
  const nudge = (row: number) => (e: KeyboardEvent) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    move(row, e.key === 'ArrowUp' ? row - 1 : row + 2);
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
                    {p.kind === 'smart' ? (
                      <span className="live-crate-smart" title="A smart playlist: whatever matches its filter">
                        smart
                      </span>
                    ) : (
                      <span className="live-crate-count">{plural(p.items.length, 'preset')}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="live-crate-section" aria-labelledby="live-crate-moods">
        <h2 id="live-crate-moods">Moods</h2>
        {all.length === 0 ? (
          <p className="live-crate-note">Tag presets in the library and {say('user tags')} show up here as moods to play.</p>
        ) : (
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
        )}
      </section>

      <section className="live-crate-section" aria-labelledby="live-crate-next">
        <h2 id="live-crate-next">Up next</h2>
        <p className="live-crate-note">{upNote(lists)}</p>
        {rows.length > 0 && (
          <ol className="live-crate-list" aria-label="Up next, in play order">
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
                onKeyDown={list ? nudge(i) : undefined}
                title={r.missing ? `${r.name}: the file is missing` : r.name}
              >
                {marker(i)}
                {list && (
                  <span
                    className="live-crate-handle"
                    aria-hidden="true"
                    title="Drag to change when it plays"
                    onPointerDown={grab(i)}
                    onPointerMove={drift}
                    onPointerUp={drop}
                    onPointerCancel={() => setDrag(null)}
                  >
                    ≡
                  </span>
                )}
                <span className="live-crate-name">{r.missing ? <s>{r.name}</s> : r.name}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
