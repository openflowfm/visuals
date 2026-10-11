import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { LibraryData } from './api.ts';
import * as pl from './playlists.ts';
import { plural } from './controls.ts';
import { Icon } from './layout/icons.tsx';
import { nameOf } from './shell.ts';
import { say } from './words.ts';
import './live/stage-crate.css';

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
 * The rows after the deck's Next line: `rows` without the preset the Next line
 * already names (`next`, by path), wherever it is among them — usually first,
 * but not when the play order put it later. Only its first row goes: a preset
 * in a playlist twice still shows its later turn.
 */
export function afterNext(rows: readonly Upcoming[], next: string | null): Upcoming[] {
  const at = next === null ? -1 : rows.findIndex((r) => r.path === next);
  return at < 0 ? [...rows] : [...rows.slice(0, at), ...rows.slice(at + 1)];
}

/**
 * Whether `items` (what `deckItems` gave) still agrees with the deck: the preset
 * after `playing` in them is the deck's `next`. Stepping keeps it true, so a new
 * playing preset needs no fetch; a playlist loaded again (shuffled afresh) makes
 * it false. Nothing to check against counts as agreeing.
 */
export function itemsAgree(items: readonly string[] | null, playing: string | null, next: string | null): boolean {
  if (!items?.length || next === null) return true;
  const pos = playing ? items.indexOf(playing) : -1;
  return items[(pos + 1) % items.length] === next;
}

/** Which row a drag holds: its playlist index and path, so it is found again however the rows shifted under it. */
export type Held = Pick<Upcoming, 'path' | 'at'>;

/** Where `held` is among `rows` now: the row at the same playlist index with the same path, else the first with its path; -1 when it has gone (it became the Next line, or plays). */
export function findRow(rows: readonly Upcoming[], held: Held): number {
  const same = rows.findIndex((r) => r.at === held.at && r.path === held.path);
  return same >= 0 ? same : rows.findIndex((r) => r.path === held.path);
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

/** Where focus goes when "Show fewer" hides the rows past UP_NEXT: a focused hidden row hands it to the last row still shown; otherwise it stays put (null). */
export const collapseFocus = (focused: number): number | null => (focused >= UP_NEXT ? UP_NEXT - 1 : null);

/** An up-next row's accessible name, saying when its file is missing (the strike-through doesn't). */
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

/** The crate's sections, in order: each folds under its heading. */
export type CrateSection = 'playlists' | 'moods' | 'next';

/** One stop on the keyboard's walk: a section's heading, or an item under it (a playlist, a mood, an up-next row that moves, "Show all"). */
export interface Stop {
  key: string;
  section: CrateSection;
  head: boolean;
}

/** What a key does on the walk: focus another stop (`to`), fold or unfold a section (`fold`), or nothing of the walk's (null: the key isn't the walk's). */
export type Step = { to?: string; fold?: CrateSection } | null;

/**
 * The keyboard's walk over the crate, as Home's sidebar walks its own: ↓ ↑ the
 * next and previous stop, Home and End the first and the last, ← from an item
 * to its heading and on an open heading folds it, → on a folded heading
 * unfolds it and on an open one goes to its first item. `stops` are only the
 * ones shown (a folded section's items aren't); `at` is the focused one's index.
 */
export function crateStep(stops: readonly Stop[], at: number, key: string, folded: readonly CrateSection[]): Step {
  const here = stops[at];
  if (!here) return null;
  const open = !folded.includes(here.section);
  if (key === 'ArrowDown') return { to: stops[Math.min(at + 1, stops.length - 1)].key };
  if (key === 'ArrowUp') return { to: stops[Math.max(at - 1, 0)].key };
  if (key === 'Home') return { to: stops[0].key };
  if (key === 'End') return { to: stops[stops.length - 1].key };
  if (key === 'ArrowLeft') {
    if (!here.head) return { to: stops.find((s) => s.head && s.section === here.section)?.key };
    return open ? { fold: here.section } : {};
  }
  if (key === 'ArrowRight') {
    if (!here.head) return {};
    if (!open) return { fold: here.section };
    const first = stops[at + 1];
    return first && !first.head && first.section === here.section ? { to: first.key } : {};
  }
  return null;
}

/** The one tab stop: the stop focused last when it still shows, else the playlist playing, else the first heading. */
export function tabStop(stops: readonly Stop[], active: string | null, playing: string | null): string | undefined {
  return stops.find((s) => s.key === active)?.key ?? stops.find((s) => s.key === playing)?.key ?? stops[0]?.key;
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
 * Live mode's crate, in Home's sidebar look (stage-crate.css): the playlists,
 * where a tap only cues one (a mis-tap mid-set never switches the set) and its
 * Play button, Enter or a double-click plays it (the one playing the soft pill
 * with its green dot), the
 * user's tags as moods to play (and mix) once there are any, and what plays
 * after the deck's Next — four rows, the rest behind "Show all" — which, for a
 * playlist in order, can be dragged by the ≡ that shows on hover or focus (or
 * Alt+↑ ↓) into a new order. Each section folds under its quiet heading; the
 * sections scroll inside the crate.
 *
 * One tab stop, as Home's sidebar has: the arrow keys walk the headings and
 * the items shown (`crateStep`), Home and End jump to the first and the last,
 * Space cues a playlist and Enter plays it; Enter or Space plays or mixes a
 * mood, or folds a section. The cued row's Play button is outside the walk
 * (Enter on the row does the same); VoiceOver and the pointer reach it.
 */
export function Crate({ lists, data, act, onLists, onError, current }: Props) {
  const { playlists, deck } = lists;
  const fetching = needsDeckItems(lists);
  const [items, setItems] = useState<string[] | null>(null);
  const query = JSON.stringify(deck.query);
  const playing = deck.current ?? current;
  // A step only moves where "Up next" reads from in the same order, so a new playing preset isn't a reason to ask again;
  // the order is asked for again when what plays changes, its size does, or the deck's Next stops agreeing with it (a reshuffle).
  const stale = itemsAgree(items, playing, deck.next) ? null : `${playing}>${deck.next}`;
  // Counted, so the order agreeing again (stale back to null) isn't a second reason to ask: one fetch per reshuffle.
  const asked = useRef<string | null>(null);
  const reshuffles = useRef(0);
  if (stale && stale !== asked.current) {
    asked.current = stale;
    reshuffles.current += 1;
  }
  const reshuffle = reshuffles.current;
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
  }, [fetching, deck.playlist, query, deck.order, deck.count, reshuffle]);

  // The playlist cued: tapped, not yet played. Playing is its own step (Play, Enter, a double-click), so a mis-tap mid-set never switches it.
  const [cued, setCued] = useState<string | null>(null);
  const playingList = deck.query ? null : deck.playlist;
  // Once the deck plays the cued playlist (from here or anywhere), the cue is done.
  useEffect(() => {
    if (playingList !== null) setCued((c) => (c === playingList ? null : c));
  }, [playingList]);
  const cue = cued !== null && cued !== playingList && playlists.some((p) => p.id === cued) ? cued : null;
  // The playlist playing already plays: playing it again would only restart it.
  const playList = (id: string, i: number) => {
    if (id === playingList) return;
    setCued(null);
    act({ kind: 'load', playlist: i, index: null });
  };

  const all = moods(data);
  const lit = litMoods(deck);
  const list = orderable(lists);
  const [expanded, setExpanded] = useState(false);
  // One more than "Show all" lists, as the first is usually the deck's Next line.
  const every = afterNext(upcoming({ ...lists, deck: { ...deck, current: playing } }, items, UP_NEXT_ALL + 1), nextPath(lists)).slice(0, UP_NEXT_ALL);
  const rows = expanded ? every : every.slice(0, UP_NEXT);
  const more = every.length > UP_NEXT;
  const note = upNote(lists);

  const uid = useId();
  // The sections folded away, and the stop focused last (the walk's one tab stop).
  const [folded, setFolded] = useState<CrateSection[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const els = useRef(new Map<string, HTMLElement>());

  const refs = useRef<(HTMLLIElement | null)[]>([]);
  // The row held by its identity, not its index: auto-advance can move the deck mid-drag, and the rows shift under the pointer.
  const [drag, setDrag] = useState<{ held: Held; slot: number } | null>(null);
  const dragRow = drag ? findRow(every, drag.held) : -1;
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
    setDrag({ held: { path: every[row].path, at: every[row].at }, slot: row });
  };
  const drift = (e: PointerEvent) => {
    if (drag) setDrag({ ...drag, slot: slotAt(e.clientY) });
  };
  // The row and the slot are both worked out from the rows as they are at the drop, so the move lands where it was dropped.
  const drop = (e: PointerEvent) => {
    if (!drag) return;
    setDrag(null);
    if (dragRow >= 0) move(dragRow, slotAt(e.clientY));
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
    if (!drag || dragRow < 0 || drag.slot === dragRow || drag.slot === dragRow + 1) return null;
    if (drag.slot === row) return <span className="scr-drop" data-at="before" aria-hidden="true" />;
    if (drag.slot === rows.length && row === rows.length - 1) return <span className="scr-drop" data-at="after" aria-hidden="true" />;
    return null;
  };

  // The keyboard's walk, in order: each heading, then its items while it is open.
  const sections: CrateSection[] = all.length > 0 ? ['playlists', 'moods', 'next'] : ['playlists', 'next'];
  const stops: Stop[] = [];
  for (const s of sections) {
    stops.push({ key: headKey(s), section: s, head: true });
    if (folded.includes(s)) continue;
    if (s === 'playlists') for (const p of playlists) stops.push({ key: listKey(p.id), section: s, head: false });
    if (s === 'moods') for (const m of all) stops.push({ key: moodKey(m.tag), section: s, head: false });
    if (s === 'next') {
      // Only the rows that move are stops: the others do nothing.
      if (list) rows.forEach((r, i) => stops.push({ key: nextKey(r, i), section: s, head: false }));
      if (more) stops.push({ key: MORE, section: s, head: false });
    }
  }
  const stop = tabStop(stops, active, deck.playlist !== null && !deck.query ? listKey(deck.playlist) : null);
  const bind = (key: string) => ({
    ref: (el: HTMLElement | null) => {
      if (el) els.current.set(key, el);
      else els.current.delete(key);
    },
    tabIndex: key === stop ? 0 : -1,
    onFocus: () => setActive(key),
  });
  const fold = (s: CrateSection) => setFolded((f) => (f.includes(s) ? f.filter((x) => x !== s) : [...f, s]));
  const walk = (e: KeyboardEvent) => {
    // Arrows, Home and End with a modifier aren't the walk's: Alt+↑ ↓ moves an up-next row, the rest are the system's.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const at = stops.findIndex((s) => els.current.get(s.key) === e.target);
    const step = at < 0 ? null : crateStep(stops, at, e.key, folded);
    if (!step) return;
    // The walk's keys are the crate's: live mode's keys (← → step presets) never see them.
    e.preventDefault();
    e.stopPropagation();
    if (step.fold) fold(step.fold);
    if (step.to) {
      setActive(step.to);
      els.current.get(step.to)?.focus();
    }
  };
  const head = (s: CrateSection, title: string) => {
    const open = !folded.includes(s);
    return (
      <h2 className="scr-head">
        <button
          type="button"
          className="scr-toggle"
          aria-expanded={open}
          aria-controls={`${uid}-${s}`}
          title={open ? `Hide ${title.toLowerCase()}` : `Show ${title.toLowerCase()}`}
          onClick={() => fold(s)}
          {...bind(headKey(s))}
        >
          <span className="scr-title">{title}</span>
          <Icon className="scr-chevron" name={open ? 'chevron-down' : 'chevron-right'} size={12} />
        </button>
      </h2>
    );
  };
  const noteId = `${uid}-next-note`;
  const rowsId = `${uid}-next-rows`;

  return (
    <div className="scr" onKeyDown={walk}>
      <div className="scr-section">
        {head('playlists', 'Playlists')}
        <div id={`${uid}-playlists`} className="scr-body" hidden={folded.includes('playlists')}>
          {playlists.length === 0 ? (
            <p className="scr-note">No playlists yet: make one in the library, then tap it here to cue it and Play to play it.</p>
          ) : (
            <ul className="scr-rows">
              {playlists.map((p, i) => {
                const on = deck.playlist === p.id && !deck.query;
                const smart = p.kind === 'smart';
                const isCued = cue === p.id;
                const kind = smart ? ', a smart playlist (whatever matches its filter)' : '';
                return (
                  <li key={p.id} className="scr-list">
                    <button
                      type="button"
                      className="scr-row"
                      data-playing={on || undefined}
                      data-cued={isCued || undefined}
                      aria-current={on ? 'true' : undefined}
                      aria-pressed={isCued}
                      aria-keyshortcuts={on ? undefined : 'Enter'}
                      aria-label={`${p.name}${smart ? ', smart playlist' : ''}${on ? ', playing' : ''}`}
                      title={
                        on
                          ? `${p.name} is playing`
                          : isCued
                            ? `${p.name}${kind} is cued: Play, Enter or a double-click switches the set to it`
                            : `${p.name}${kind}: tap to cue it; double-click or Enter plays it`
                      }
                      onClick={() => setCued(on ? null : p.id)}
                      onDoubleClick={() => playList(p.id, i)}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
                        // Enter plays; Space (the button's click) only cues.
                        e.preventDefault();
                        e.stopPropagation();
                        playList(p.id, i);
                      }}
                      {...bind(listKey(p.id))}
                    >
                      <Icon className="scr-icon" name={smart ? 'smart-playlist' : 'playlist'} />
                      <span className="scr-name">{p.name}</span>
                      {/* The playlist playing: the green dot after its name, as Home's sidebar marks it. */}
                      {on && <span className="scr-dot" aria-hidden="true" />}
                    </button>
                    {/* Out of the walk (Enter on the row plays it); VoiceOver and the pointer reach it. */}
                    {isCued && (
                      <button type="button" className="scr-play" tabIndex={-1} aria-label={`Play ${p.name}`} title={`Switch the set to ${p.name}`} onClick={() => playList(p.id, i)}>
                        <Icon name="play" size={10} />
                        <span aria-hidden="true">Play</span>
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Moods only once there are some: the user's tags, made in the library. */}
      {all.length > 0 && (
        <div className="scr-section">
          {head('moods', 'Moods')}
          <div id={`${uid}-moods`} className="scr-body" hidden={folded.includes('moods')}>
            <ul className="scr-rows" aria-label="Moods">
              {all.map(({ tag, count }) => {
                const on = lit.includes(tag);
                return (
                  <li key={tag}>
                    <button
                      type="button"
                      className="scr-row"
                      aria-pressed={on}
                      title={`${plural(count, 'preset')} tagged ${tag}. ${on ? 'Tap to take it out' : lit.length ? 'Tap to mix it in' : 'Tap to play it'}`}
                      onClick={() => act(chipAction(lit, tag))}
                      {...bind(moodKey(tag))}
                    >
                      <Icon className="scr-icon" name="mood" />
                      <span className="scr-name">{tag}</span>
                      {on && <span className="scr-dot" aria-hidden="true" />}
                      <i className="scr-count" aria-hidden="true">
                        {count.toLocaleString('en-US')}
                      </i>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      <div className="scr-section">
        {head('next', 'Up next')}
        <div id={`${uid}-next`} className="scr-body" hidden={folded.includes('next')}>
          {note !== null && <p className="scr-note">{note}</p>}
          {list && (
            <span className="scr-sr" id={noteId}>
              {MOVE_NOTE}
            </span>
          )}
          {rows.length > 0 && (
            <ol className="scr-rows" id={rowsId} aria-label="Up next, in play order">
              {rows.map((r, i) => {
                const b = list ? bind(nextKey(r, i)) : null;
                return (
                  <li
                    // A row that can be dragged is keyed by its playlist index, so it stays the same element (and keeps the pointer) when the rows shift mid-drag.
                    key={nextKey(r, i)}
                    ref={(el) => {
                      refs.current[i] = el;
                      b?.ref(el);
                    }}
                    className="scr-next"
                    data-missing={r.missing || undefined}
                    data-moves={list ? '' : undefined}
                    data-dragging={(drag !== null && dragRow === i) || undefined}
                    tabIndex={b?.tabIndex}
                    onFocus={b?.onFocus}
                    aria-keyshortcuts={list ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
                    aria-label={rowLabel(r)}
                    aria-describedby={list ? noteId : undefined}
                    onKeyDown={list ? nudge(i) : undefined}
                    title={r.missing ? `${r.name}: the file is missing` : r.name}
                  >
                    {marker(i)}
                    <span className="scr-name">{r.missing ? <s>{r.name}</s> : r.name}</span>
                    {list && (
                      <span
                        className="scr-handle"
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
                );
              })}
            </ol>
          )}
          {more && (
            <button type="button" className="scr-more" aria-expanded={expanded} aria-controls={rowsId} onClick={toggle} {...bind(MORE)}>
              {expanded ? 'Show fewer' : 'Show all'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The walk's keys: a heading's, a playlist's, a mood's, an up-next row's (as React keys it) and "Show all"'s. */
const headKey = (s: CrateSection) => `head:${s}`;
const listKey = (id: string) => `list:${id}`;
const moodKey = (tag: string) => `mood:${tag}`;
const nextKey = (r: Upcoming, i: number) => (r.at !== null ? `${r.at}:${r.path}` : `x:${i}:${r.path}`);
const MORE = 'more';
