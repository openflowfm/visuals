import { CameraAction } from '../Camera/Camera';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { ActionButton } from '@satoramoto/zen';
import { Layer } from '@satoramoto/zen';
import { Text } from '@satoramoto/zen';
import * as api from '../model/api';
import type { Entry, LibraryChange, LibraryData, LibraryRow } from '../model/api';
import { Library } from '../Library/Library';
import { Surface } from '@satoramoto/zen';
import { browsable, browseOrder, facet, stepIn, prepare, type Prepared } from '../model/librarySearch';
import { useLibrary, rereadOn, stepDeck } from '../model/library';
import { onChanged } from '../model/pack';
import { PackOffer } from '../PackOffer/PackOffer';
import { PlaylistHead } from '../PlaylistHead/PlaylistHead';
import { PresetTile, tileBy, tileName } from '../PresetTile/PresetTile';
import * as pl from '../model/playlists';
import type { Lists, Playlist } from '../model/playlists';
import { useNotice, useTauriEvent } from '../model/hooks';
import { isTyping, nameOf, notice, openFailed } from '../model/shell';
import { plural } from '../model/controls';
import { beginDrag, dropAction, isOver, itemTarget, nudge, runDrop, useDrag, type DragHandlers, type Payload } from '../model/drag';
import {
  keyAt,
  localMark,
  matches,
  pickTiles,
  playsFrom,
  movesByItself,
  prefsAt,
  presetLength,
  remember,
  rememberedChoice,
  saveFile,
  seedStarters,
  startPrefs,
  strip,
  tileFocus,
  type Pane,
  type Prefs,
  type StripTile,
  type TilePick,
} from '../model/home';
import { HomeLayout, homeDocks, INSPECTOR_ID, PaneTile, PanelToggle, SIDEBAR_ID, useLayoutPrinciples } from '../HomeLayout/HomeLayout';
import { useFrameRoom } from '@satoramoto/zen';
import { HelpOverlay, HOME_HELP } from '../HelpOverlay/HelpOverlay';
import { modalOpen } from '../model/liveKeys';
import { Hero, HERO_PIC } from '../Hero/Hero';
import { TransportAudio, TransportBar } from '../TransportBar/TransportBar';
import { InsetSidebar, sidebarSections } from '../InsetSidebar/InsetSidebar';
import { Inspector } from '../Inspector/Inspector';
import { LibraryHead } from '../Library/LibraryHead';
import { LibraryMapView } from '../Field/LibraryMapView';
import { ColourPicker } from '../Field/Field';
import { useMapAxes } from '../model/mapPrefs';
import { drawnOf, inspectorShowsMap, listPlace, listRows, mapRoom, NO_DOTS_NOTE, roomShowsMap, useLibraryView } from '../model/libraryView';
import { Icon } from '../Icon/Icon';
import { INSPECTOR_KEY, modesFor, offersQuickAdd, paneName, SIDEBAR_KEY, type QuickAdd, type Selection, type SidebarActions } from '../model/home-model';
import { Header, NoticeBanner, openSheet, Preview, type View } from '../Views/Views';
import { problemKey, useSettingsProblems } from '../model/survive';
import { say, Say } from '../model/words';
import { CLAIM_MS } from '../model/claim';
import { useElapsed } from '../model/useElapsed';
import './Home.css';

// A port of visual[flow]'s `app/src/Home.tsx` and the screen-level rules of `home.css`: the same
// exports, state, keys, notices and words. Classes are `vs-home-*` (the original's `home-*`).

export type { Pane } from '../model/home';

/** The window's size, followed as it is resized: the room the home assembles in (a story frame's design window inside one). */
function useWindowRoom(): { w: number; h: number } {
  const read = () => ({ w: window.innerWidth, h: window.innerHeight });
  const [room, setRoom] = useState(read);
  const frame = useFrameRoom();
  useEffect(() => {
    const resize = () => setRoom((r) => (r.w === window.innerWidth && r.h === window.innerHeight ? r : read()));
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  return frame ?? room;
}

/** No presets picked. */
const SOURCE: Selection = { kind: 'source' };

/** The keys a selection picks. */
const keysOf = (s: Selection): readonly string[] => (s.kind === 'presets' ? s.keys : NONE);
const NONE: readonly string[] = [];

/** Whether a key went to something that moves with the arrows itself (the grid, the sidebar, the inspector's field, a switch): ← → R leave it alone. */
const ownsArrows = (target: EventTarget | null): boolean => {
  const t = target as { closest?: (selector: string) => unknown } | null;
  return typeof t?.closest === 'function' && t.closest(`[role="listbox"], [role="tree"], [role="grid"], [role="radiogroup"], [role="menu"], [role="slider"], [role="dialog"], #${SIDEBAR_ID}`) != null;
};

/**
 * **Job.** The home (#96; since decision 66 the one place to browse; since decision 70
 * an inspector view, as Finder's and Photos' are): the header (the sidebar's
 * toggle, home | live, the search and "Filter ▾" while the library shows, the
 * inspector's toggle; the mark is the sidebar's, Settings is ⌘, and the
 * sidebar's foot); the inset sidebar down the left picking a source (the
 * library, starred, recently played, the playlists and the smart playlists);
 * the main column, the preview pinned over a plain grid of the source's
 * presets; the inspector down the right, its details about the preset playing,
 * or the presets picked in the grid, or a source's card ("Show info"), and the
 * library map pinned under them, lighting what plays whatever they show; and the
 * transport bar along the bottom, naming what plays (decision 71).
 *
 * A click on a tile, or Enter, plays it; ⌘ or ⇧ picks (the inspector shows
 * them); Esc goes back to the preset playing. Quick add (a manual playlist's
 * "Add presets") opens the library with a strip over it: a click adds a preset
 * to the playlist or takes it out, Space or ⌥-click plays, Esc or Done goes back
 * to the playlist. The sidebar docks from 900 px and the inspector from 1200 px;
 * narrower, each is laid over the grid when opened (⌃⌘S, ⌘I, or their header
 * buttons). Presets are dragged from the grid onto a playlist in the sidebar, and
 * about within a playlist's grid. `library` opens it on the library
 * (`VISUALS_VIEW=library`), as it opens anyway unless a playlist plays.
 *
 * **Changed.** The frame is `HomeLayout`'s (an assembled `Screen`, the panes laid over
 * the grid as `Opaque` panels); where the panes dock is `homeDocks`, the solver's answer
 * from their needs at the window's size, not 900 / 1200 px, and the tiles' size is the
 * pane's form (`PaneTile`), not a width; the hero's picture is Views' `Preview`, a measured `Hole`,
 * which rounds its own corners, so home.css's corner painting is gone from here. The
 * dragged preset is a `Layer level="float"` (the theme's glass) instead of home.css's
 * hand-rolled fill, blur and lift. Notes over the grid are tints of the contract's
 * `--danger` / `--warning` over `--surface-0`; the column's one padding is
 * `--mat-plate-inset`, tightened to `--space-4` in the pane's small form. ✕ glyphs are the icon set's
 * `close` (as Views' NoticeBanner). ⌘F finds the search inside the header's toolbar slot
 * (any input the library portals there), not by the library's class names; ← → R leave
 * the sidebar alone by its id (`SIDEBAR_ID`), not its class. The room under the hero has a head
 * row (`LibraryHead`: the source, how many it shows, **Grid | Map**); the choice is the app's
 * (`useLibraryView`, kept like the map's axes). In Map view (wireframe B) the room shows the map
 * (`LibraryMapView`) of what the grid would show: the library or Starred as searched and filtered,
 * a playlist's presets; a dot plays as its tile would (a playlist's from its place in it, past the
 * grid's last tile too: `listPlace`); the inspector leaves its map section out
 * (`inspectorShowsMap`). With no dots the map's place holds a note (`NO_DOTS_NOTE`), or an empty
 * playlist's own note, and the head no colour picker (`mapRoom`). Quick add keeps the grid. The
 * hero keeps its size; the head row stays put under the preview and the grid still reaches up
 * behind both (Home.css's `--vs-grid-head`).
 *
 * **Kept.** Every piece of state, the optimistic play and its undo, the deck's word and
 * the click's claim, the keys (⌃⌘S, ⌘I, ⌘F, Esc's order, ?, ← → R H with the isTyping and
 * arrow-owner guards), quick add's queue, drag and drop, the help overlay, the notices and
 * every word.
 *
 * **Tuning knobs** (Home.css):
 * - `--vs-home-pad`: the grid pane's side padding, `--mat-plate-inset` (home.css --pad 22px),
 *   `--space-4` in the pane's small form (HomeLayout's `PANE_FORMS`).
 * - `--vs-home-tile-min`: a playlist grid's narrowest tile, 150px (124px in the small form), on
 *   the scale.
 * - `--vs-grid-reach` (unitless px): how far the grid's scroller reaches up into the pinned
 *   preview's room, so its tiles scroll behind it: the pane slot's `--lib-under` while no note
 *   sits over the grid, else 0. The playlist grid and `LibraryGrid` read it.
 * - `--vs-grid-reach-down` (unitless px): how far the grid's scroller reaches down into the
 *   pinned transport bar's room, so its tiles scroll behind it: the pane slot's `--lib-over`,
 *   always (notes sit at the top). The playlist grid and `LibraryGrid` read it.
 */
export function Home({
  start,
  onMode,
  library: startOnLibrary = false,
  lights = false,
}: {
  start: string | null;
  onMode(view: View, path: string | null): void;
  library?: boolean;
  /** Draw the window buttons' stand-in (stories: HomeLayout's `lights`; the app's are macOS's). */
  lights?: boolean;
}) {
  const [current, setCurrent] = useState<Entry | null>(null);
  const { notice: banner, set: setNotice, fail, dismiss } = useNotice();
  const [lists, setLists] = useState<Lists | null>(null);
  const [pane, setPane] = useState<Pane | null>(startOnLibrary ? { kind: 'library' } : null);
  // The audio input's failure shows on the input itself, not as a toast.
  const { notice: audioTrouble, fail: audioFail } = useNotice();
  const audioFailed = useMemo(() => audioFail("Couldn't read the audio input."), [audioFail]);

  // How long the preset playing has played: counted from when the app last said what plays (D9), or a tile was played.
  const [since, setSince] = useState(() => Date.now());
  const lastPath = useRef<string | null>(null);
  const currentRef = useRef<Entry | null>(null);
  currentRef.current = current;
  const sinceRef = useRef(since);
  sinceRef.current = since;
  // A preset played from here, until the deck's word on it comes (or CLAIM_MS pass): live events for other paths are
  // the deck catching up on what played before (auto-advance racing the click), not news.
  const claim = useRef<{ path: string; until: number } | null>(null);
  // Shows `e` as playing at once; the returned undo puts back what actually plays if playing it fails.
  // Only a click claims: a preset opened by the app itself (at start, a step) lets the deck's word through.
  const guess = useRef<object | null>(null);
  // What actually plays: the last preset the deck's word named or an open resolved on; an undo puts this back, not a guess.
  const confirmed = useRef<{ current: Entry | null; lastPath: string | null; since: number } | null>(null);
  // An open resolved: it plays, and no live event follows it (library.rs `open`), so its claim ends here.
  // The deck may have let go of its playlist or filter for a preset outside it, and says so only when asked: read it again.
  const opened = useCallback((e: Entry) => {
    if (claim.current?.path === e.path) claim.current = null;
    if (lastPath.current === e.path) confirmed.current = { current: currentRef.current ?? e, lastPath: e.path, since: sinceRef.current };
    pl.lists().then(
      (l) => setLists((was) => (was ? { ...was, deck: l.deck } : l)),
      () => {},
    );
  }, []);
  const optimistic = useCallback((e: Entry, clicked: boolean) => {
    const before = confirmed.current ?? { current: currentRef.current, lastPath: lastPath.current, since: sinceRef.current };
    if (e.path !== lastPath.current) setSince(Date.now());
    lastPath.current = e.path;
    setCurrent(e);
    const mine = { path: e.path, until: Date.now() + CLAIM_MS };
    claim.current = clicked ? mine : null;
    guess.current = mine;
    return () => {
      // Undone only while nothing has been shown since: not a later click, nor the deck's word.
      if (guess.current !== mine) return;
      guess.current = null;
      claim.current = null;
      lastPath.current = before.lastPath;
      setSince(before.since);
      setCurrent(before.current);
    };
  }, []);

  const load = useCallback(
    async (e: Entry, clicked = false) => {
      const undo = optimistic(e, clicked);
      dismiss();
      try {
        await api.open(e.path);
        opened(e);
      } catch (err) {
        undo();
        setNotice(notice(`Couldn't open ${e.name}.`, err));
      }
    },
    [dismiss, setNotice, optimistic, opened],
  );
  // Picking up where the app left off, the preset put back stays: named in the hero (unless the deck said first), not opened again.
  const { library, loaded, search, setSearch, found } = useLibrary(start, load, fail, (e) => setCurrent((c) => c ?? e));
  const { rows, data, apply } = useLibraryRows();
  const played = usePlayed();

  // The playlists, and the starter smart playlists the first time the home opens.
  useEffect(() => {
    pl.lists().then((l) => {
      setLists(l);
      seedStarters(l.playlists, localMark(), { save: api.smartPlaylistSave, settings: pl.setSettings }).then((made) => {
        if (made) pl.lists().then(setLists, fail("Couldn't read the playlists."));
      }, fail("Couldn't make the starter smart playlists."));
    }, fail("Couldn't read the playlists."));
  }, [fail]);
  useTauriEvent(pl.onLists, setLists);
  // `VITE_HOME_PLAYLIST=<name>` (a dev run only) opens that playlist once the playlists are read, for a headless capture of it.
  const devList = import.meta.env.DEV ? String(import.meta.env.VITE_HOME_PLAYLIST ?? '') : '';
  const devListId = devList ? lists?.playlists.find((p) => p.name === devList)?.id : undefined;
  useEffect(() => {
    if (devListId) setPane({ kind: 'list', id: devListId });
  }, [devListId]);
  useTauriEvent(pl.onLive, (now) => {
    setLists((l) => (l ? { ...l, deck: now.deck } : l));
    played.reread();
    if (!now.path) return;
    const path = now.path;
    const c = claim.current;
    if (c && path !== c.path && Date.now() < c.until) return;
    claim.current = null;
    guess.current = null;
    let at = sinceRef.current;
    if (path !== lastPath.current) {
      lastPath.current = path;
      at = Date.now();
      setSince(at);
    }
    const e = library.find((e) => e.path === path) ?? { path, name: nameOf(path), group: '' };
    confirmed.current = { current: e, lastPath: path, since: at };
    setCurrent(e);
    setNotice(now.error ? openFailed(path, now.error) : null);
  });

  // The source shown: the one picked, else the playlist playing, else the library.
  const playlists = lists?.playlists ?? [];
  const deck = lists?.deck ?? pl.EMPTY_DECK;
  const shown: Pane | null = pane && (pane.kind !== 'list' || playlists.some((p) => p.id === pane.id)) ? pane : lists ? firstPane(lists) : null;
  const list = shown?.kind === 'list' ? (playlists.find((p) => p.id === shown.id) ?? null) : null;
  // The playlist the grid's + adds to: the last manual one picked, or the one playing.
  const [lastManual, setLastManual] = useState<string | null>(null);
  const into = playlists.find((p) => p.kind === 'manual' && p.id === (lastManual ?? deck.playlist)) ?? null;

  // What is picked (D1): presets by index key, or none (the inspector shows the source); in a playlist's grid, its tiles too.
  const [sel, setSel] = useState<Selection>(SOURCE);
  const [tilesPicked, setTilesPicked] = useState<string[]>([]);
  // The source's card in the inspector ("Show info"), until something is picked or Esc.
  const [info, setInfo] = useState(false);
  // Quick add: the manual playlist a click on a library tile adds to; null while off.
  const [quickAdd, setQuickAdd] = useState<QuickAdd>(null);
  const toSource = useCallback(() => {
    setSel(SOURCE);
    setTilesPicked([]);
    setInfo(false);
  }, []);
  const onChosen = useCallback((chosen: Prepared[]) => {
    const keys = chosen.map((p) => p.row.key);
    if (keys.length) setInfo(false);
    setSel((s) => (keys.length === 0 ? (s.kind === 'source' ? s : SOURCE) : keysOf(s).join('\n') === keys.join('\n') ? s : { kind: 'presets', keys }));
  }, []);

  // The panes either side (D5): docked where their needs fit beside the column (the assembled home's answer), shown or hidden as the viewer chose.
  const room = useWindowRoom();
  const principles = useLayoutPrinciples();
  const docks = useMemo(() => homeDocks(room, principles), [room, principles]);
  const [choices, setChoices] = useState(() =>
    startPrefs(
      { sidebar: rememberedChoice(SIDEBAR_KEY), inspector: rememberedChoice(INSPECTOR_KEY) },
      import.meta.env.DEV ? { panel: String(import.meta.env.VITE_HOME_PANEL ?? ''), sidebar: String(import.meta.env.VITE_HOME_SIDEBAR ?? '') } : {},
    ),
  );
  const modes = modesFor(docks, prefsAt(docks, choices.wide, choices.narrow));
  const choose = (pane: keyof Prefs, show: boolean) => {
    const docked = docks[pane];
    // Kept for next time only where the pane docks; laid over the grid, it starts closed again.
    if (docked) remember(pane === 'sidebar' ? SIDEBAR_KEY : INSPECTOR_KEY, show);
    setChoices((c) => (docked ? { ...c, wide: { ...c.wide, [pane]: show } } : { ...c, narrow: { ...c.narrow, [pane]: show } }));
  };
  const toggleSidebar = () => choose('sidebar', modes.sidebar === 'hidden');
  const toggleInspector = () => choose('inspector', modes.inspector === null);
  const overlaid = modes.sidebar === 'overlay' || modes.inspector === 'overlay';
  const dismissOverlays = () => {
    if (modes.sidebar === 'overlay') choose('sidebar', false);
    if (modes.inspector === 'overlay') choose('inspector', false);
  };

  const pick = (next: Pane) => {
    setPane(next);
    toSource();
    // Another source picked ends quick add (starting it picks the library, then turns it on).
    setQuickAdd(null);
    if (next.kind === 'list' && playlists.find((p) => p.id === next.id)?.kind === 'manual') setLastManual(next.id);
    // Laid over the grid, the sidebar goes once a source is picked.
    if (modes.sidebar === 'overlay') choose('sidebar', false);
  };

  // Quick add (issue 194): the library, with a click adding to the playlist; Esc or Done goes back to the playlist.
  const adding = quickAdd ? (playlists.find((p) => p.id === quickAdd.id) ?? null) : null;
  const startQuickAdd = (id: string) => {
    const p = playlists.find((x) => x.id === id);
    if (!p || !offersQuickAdd(p)) return;
    pick({ kind: 'library' });
    setQuickAdd({ id });
  };
  const endQuickAdd = () => {
    if (!quickAdd) return;
    pick({ kind: 'list', id: quickAdd.id });
  };
  // The playlist deleted, or no longer manual: quick add ends where it is.
  const addingOk = !quickAdd || !lists || (adding !== null && offersQuickAdd(adding));
  useEffect(() => {
    if (!addingOk) setQuickAdd(null);
  }, [addingOk]);
  const addingPaths = useMemo(() => new Set(adding?.items.map((i) => i.path) ?? []), [adding]);
  // A preset goes in at most once: a click on one already in takes it out; one still being added or taken out waits for the answer.
  // At most one change per playlist is in flight: the next waits for its answer and finds its index in the playlist as answered, never a stale one.
  const pending = useRef(new Set<string>());
  const queues = useRef(new Map<string, Promise<unknown>>());
  const latest = useRef(lists);
  latest.current = lists;
  const toggleAdded = (e: Entry) => {
    if (!adding || pending.current.has(e.path)) return;
    const { id, name } = adding;
    pending.current.add(e.path);
    const apply = async () => {
      const items = latest.current?.playlists.find((p) => p.id === id)?.items ?? [];
      const at = items.findIndex((i) => i.path === e.path);
      const what = at >= 0 ? `take ${e.name} out of ${name}` : `add ${e.name} to ${name}`;
      try {
        const l = await (at >= 0 ? pl.removeItem(id, at) : pl.add(id, e.path));
        if (l) {
          latest.current = l;
          setLists(l);
        }
      } catch (err) {
        fail(`Couldn't ${what}.`)(err);
      } finally {
        pending.current.delete(e.path);
      }
    };
    const next = (queues.current.get(id) ?? Promise.resolve()).then(apply);
    queues.current.set(id, next);
  };

  // `VITE_HOME_PICK=<path in the pack>` (a dev run only) starts with that preset picked, once the index is read.
  const devPick = import.meta.env.DEV ? String(import.meta.env.VITE_HOME_PICK ?? '') : '';
  const devPicked = useRef(false);
  useEffect(() => {
    if (!devPick || devPicked.current || !rows) return;
    devPicked.current = true;
    const key = keyAt(rows, devPick);
    if (key) setSel({ kind: 'presets', keys: [key] });
  }, [devPick, rows]);

  const playing = deck.playlist;
  // What ←, → and R step through while the deck follows nothing: the library's grid as it browses (decision
  // 68: curated picks first, utility presets only when the search reaches them), with the search typed; the
  // plain list until the index is read.
  const browsing = useMemo(() => {
    if (!rows) return null;
    const byPath = new Map(library.map((e) => [e.path, e]));
    return facet(browseOrder(rows), { groups: {}, text: search, browse: true }).shown.map(
      (p): Entry => byPath.get(p.row.path) ?? { path: p.row.path, name: p.title, group: p.subStyle ? `${p.style}/${p.subStyle}` : p.style },
    );
  }, [rows, library, search]);
  const step = useCallback(
    (by: number) => {
      // A step is news: its live event must not be dropped by an earlier click's claim.
      claim.current = null;
      if (playing || deck.query) {
        // Counted as in flight until the deck has answered and said what it opened, so the grid's follow waits for it.
        stepDeck({ kind: by === 0 ? 'random' : by > 0 ? 'next' : 'previous' }).catch(fail("Couldn't step the playlist."));
        return;
      }
      const next = stepIn(browsing?.length ? browsing : found.shown.length ? found.shown : library, current?.path ?? null, by);
      if (next) load(next);
    },
    [playing, deck.query, browsing, found.shown, library, current, load, fail],
  );

  // ⌘F: the search, which only the library has; from a playlist it opens the library first.
  // The library puts its search in the header's toolbar slot (`toolbar`): the box is the input there.
  const wantSearch = useRef(false);
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null);
  const toolbarRef = useRef<HTMLElement | null>(null);
  toolbarRef.current = toolbar;
  const focusSearch = useCallback(() => {
    const box = toolbarRef.current?.querySelector<HTMLInputElement>('input') ?? null;
    if (box) {
      wantSearch.current = false;
      box.focus();
      box.select();
    } else wantSearch.current = true;
  }, []);
  useEffect(() => {
    if (wantSearch.current) requestAnimationFrame(focusSearch);
  });

  // The ? overlay: the home's controls (HelpOverlay's HOME_HELP), from ? or the header's button.
  const [help, setHelp] = useState(false);
  const hold = useCallback(() => void pl.act({ kind: 'hold', on: null }).catch(fail("Couldn't hold the preset.")), [fail]);

  const keys = useRef({ step, toggleSidebar, toggleInspector, overlaid, dismissOverlays, sel, info, toSource, focusSearch, shown, pick, quickAdd, endQuickAdd, hold });
  keys.current = { step, toggleSidebar, toggleInspector, overlaid, dismissOverlays, sel, info, toSource, focusSearch, shown, pick, quickAdd, endQuickAdd, hold };
  useEffect(() => {
    const key = (e: globalThis.KeyboardEvent) => {
      const k = keys.current;
      const letter = e.key.toLowerCase();
      // A sheet or dialog open over the home (Settings, a popover) has the keys: no pane or search moves under it.
      if (modalOpen()) return;
      if (e.metaKey && e.ctrlKey && !e.altKey && letter === 's') {
        e.preventDefault();
        return k.toggleSidebar();
      }
      if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && letter === 'i') {
        e.preventDefault();
        return k.toggleInspector();
      }
      if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && letter === 'f') {
        e.preventDefault();
        if (k.shown?.kind === 'list') {
          wantSearch.current = true;
          return k.pick({ kind: 'library' });
        }
        return k.focusSearch();
      }
      if (e.defaultPrevented || isTyping(e)) return;
      if (e.key === 'Escape') {
        // A pane laid over the grid goes first; then the presets picked or the source's card, back to the preset playing; then quick add.
        if (k.overlaid) k.dismissOverlays();
        else if (k.sel.kind === 'presets' || k.info) k.toSource();
        else if (k.quickAdd) k.endQuickAdd();
        else return;
        e.preventDefault();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // ? opens the help wherever the focus is (the overlay's own ? closes it, before this sees it).
      if (e.key === '?') {
        e.preventDefault();
        return setHelp(true);
      }
      if (ownsArrows(e.target)) return;
      if (e.key === 'ArrowRight') k.step(1);
      else if (e.key === 'ArrowLeft') k.step(-1);
      else if (letter === 'r') k.step(0);
      else if (letter === 'h' && !e.repeat) k.hold();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const run = (p: Promise<Lists | void>, what: string) => p.then((l) => l && setLists(l), fail(`Couldn't ${what}.`));

  // A drop anywhere on the home: onto a playlist in the sidebar, or a place in a playlist's grid.
  const dropping: DragHandlers = {
    accepts: (target, payload) => dropAction(payload, target, playlists) !== null,
    onDrop: (target, payload) => {
      const a = dropAction(payload, target, playlists);
      if (!a) return;
      const name = playlists.find((p) => p.id === a.list)?.name ?? 'the playlist';
      run(runDrop(a), a.kind === 'move' ? `move ${payload.name}` : `add ${payload.name} to ${name}`);
    },
  };

  const imported = (text: string) =>
    pl.importList(text).then((got) => {
      setLists(got.lists);
      pick({ kind: 'list', id: got.id });
      // Its name was taken: the banner over the grid says what it is called instead.
      if (got.renamed) setNotice(notice(got.renamed));
    }, fail("Couldn't add that playlist file."));

  // How many presets each source holds, for the sidebar and the source card.
  const counts = useMemo(() => {
    const smart = new Map<string, number>();
    if (rows) for (const p of playlists) if (p.kind === 'smart' && p.query) smart.set(p.id, matches(p.query, rows, played.paths).length);
    return {
      // What the library's grid shows with nothing filtered: utility presets wait for a filter (decision 68).
      library: rows ? browsable(rows).length : null,
      starred: rows ? browsable(rows).filter((p) => p.star).length : null,
      list: (p: Playlist) => (p.kind === 'manual' ? p.items.length : (smart.get(p.id) ?? null)),
    };
  }, [rows, playlists, played.paths]);

  // What the sidebar's rows and their menus do (home-model.ts), from the playlists' commands.
  const actions: SidebarActions = {
    onPlay: (id) => {
      const at = playlists.findIndex((p) => p.id === id);
      const name = playlists[at]?.name ?? 'the playlist';
      if (at >= 0) run(pl.act({ kind: 'load', playlist: at, index: null }), `play ${name}`);
    },
    onStop: () => run(pl.act({ kind: 'unload' }), 'stop the playlist'),
    onCreate: () =>
      pl.create(pl.freshName(playlists)).then((l) => {
        setLists(l);
        const made = l.playlists[l.playlists.length - 1];
        if (made) pick({ kind: 'list', id: made.id });
      }, fail("Couldn't make a playlist.")),
    onImport: imported,
    onRename: (id, name) => run(pl.rename(id, name), 'rename the playlist'),
    onExport: (id) => {
      const name = playlists.find((p) => p.id === id)?.name ?? 'the playlist';
      pl.exportList(id).then((f) => saveFile(f.file_name, f.text), fail(`Couldn't save ${name} to a file.`));
    },
    onDelete: (id) => {
      if (shown?.kind === 'list' && shown.id === id) pick({ kind: 'library' });
      run(pl.remove(id), 'delete the playlist');
    },
    onQuickAdd: startQuickAdd,
    onInfo: (id) => {
      pick({ kind: 'list', id });
      setInfo(true);
      openInspector();
    },
    onSettings: openSettings,
    onHelp: () => setHelp(true),
    helpOpen: help,
    count: counts.list,
    onError: (what) => fail(`Couldn't ${what}.`),
  };

  const sections = useMemo(
    () =>
      sidebarSections(lists, { library: counts.library, starred: counts.starred }).map((s) => ({
        ...s,
        rows: s.rows.map((r) => {
          if (r.pane.kind !== 'list') return r;
          const id = r.pane.id;
          const p = playlists.find((x) => x.id === id);
          return p ? { ...r, count: counts.list(p) } : r;
        }),
      })),
    [lists, playlists, counts],
  );
  const [collapsed, setCollapsed] = useState<string[]>([]);

  // The playlist shown, as its grid shows it (the deck's own order while it plays shuffled).
  const { tiles, total } = useStrip(list, lists, rows, played.paths);

  // The inspector (decision 71): the presets picked, else the preset playing (one the index doesn't list too), else the source's card;
  // "Show info" puts the source's card there until something is picked or Esc.
  const byKey = useMemo(() => new Map((rows ?? []).map((p) => [p.row.key, p])), [rows]);
  const byPath = useMemo(() => new Map((rows ?? []).map((p) => [p.row.path, p])), [rows]);
  const playingRow = current ? byPath.get(current.path) : undefined;
  const playingShown = useMemo(() => playingRow ?? (current ? prepare([unindexed(current)], data)[0] : null), [playingRow, current, data]);
  const picked = useMemo(() => keysOf(sel).flatMap((k) => byKey.get(k) ?? []), [sel, byKey]);
  // Presets picked that aren't in the index any more fall back to the preset playing, never a blank inspector.
  const onSource = info || (picked.length === 0 && !playingShown);

  // Tiles picked in a playlist's grid (by tile key, which follows the preset): the presets they are.
  const pickInList = (keys: string[]) => {
    setTilesPicked(keys);
    const paths = new Set(tiles.filter((t) => keys.includes(t.key)).map((t) => t.path));
    const found = [...paths].flatMap((p) => byPath.get(p)?.row.key ?? []);
    if (found.length) setInfo(false);
    setSel(found.length ? { kind: 'presets', keys: found } : SOURCE);
  };
  // Picks that went (the index read again, the library or a playlist changed, a tile taken out) are let go; none left, back to the source.
  const tileKeys = tiles.map((t) => t.key).join('\n');
  useEffect(() => {
    if (tilesPicked.length === 0) return;
    if (!list) return toSource();
    const there = new Set(tileKeys.split('\n'));
    const live = tilesPicked.filter((k) => there.has(k));
    if (live.length !== tilesPicked.length) pickInList(live);
  }, [tileKeys, list?.id]); // only when the tiles change
  useEffect(() => {
    if (!rows || sel.kind !== 'presets') return;
    const live = sel.keys.filter((k) => byKey.has(k));
    if (live.length === sel.keys.length) return;
    if (live.length === 0) toSource();
    else setSel({ kind: 'presets', keys: live });
  }, [rows, byKey, sel, toSource]);
  const libraryRows = useMemo(() => (rows ?? []).map((p) => p.row), [rows]);
  const [panelError, setPanelError] = useState<string | null>(null);
  const setData = (keys: string[], change: LibraryChange) => {
    setPanelError(null);
    apply(api.librarySet(keys, change)).catch((e) => setPanelError(`Couldn't save that: ${e instanceof Error ? e.message : String(e)}`));
  };
  const addTo = (id: string, paths: string[]) => {
    const name = playlists.find((p) => p.id === id)?.name ?? 'the playlist';
    // One at a time, in order: each answer is the playlists after it.
    const all = paths.reduce<Promise<Lists | void>>((was, path) => was.then(() => pl.add(id, path)), Promise.resolve());
    run(all, `add ${paths.length === 1 ? 'it' : plural(paths.length, 'preset')} to ${name}`);
  };
  const entryOf = (p: Prepared): Entry => library.find((e) => e.path === p.row.path) ?? { path: p.row.path, name: p.title, group: p.subStyle ? `${p.style}/${p.subStyle}` : p.style };

  // A tile played (a click or Enter): the inspector shows it at once, not the source's card ("Show info" ends) nor what played
  // before, while the deck's own word on what plays is on its way; that word then keeps the inspector following the deck.
  const showPlayed = (e: Entry) => {
    setInfo(false);
    return optimistic(e, true);
  };
  // Playing from a playlist's grid: from that place in it. `undo` puts back what plays when it can't be played.
  const playAt = (index: number | null, path: string, name: string, undo: () => void = () => {}) => {
    const failed = (what: string) => (err?: unknown) => {
      undo();
      fail(`Couldn't ${what}.`)(err);
    };
    if (!list) return failed(`play ${name}`)();
    const at = playlists.indexOf(list);
    const active = deck.playlist === list.id;
    if (index === null) return void api.open(path).then(() => opened(library.find((e) => e.path === path) ?? { path, name, group: '' }), failed(`open ${name}`));
    // A place the list no longer has, or a preset gone from the library, can't play.
    if (index < 0 || (list.kind === 'manual' && (index >= list.items.length || list.items[index].missing))) return failed(`play ${name}`)();
    pl.act(active ? { kind: 'go', index } : { kind: 'load', playlist: at, index }).catch(failed(`play ${list.name}`));
  };
  // The inspector's Play, for the one picked: from its place in the playlist shown, else on its own.
  const playPicked = () => {
    const p = picked[0];
    if (!p) return;
    const tile = list ? tiles.find((t) => tilesPicked.includes(t.key) && t.path === p.row.path) : undefined;
    if (tile) playAt(tile.index, tile.path, tile.name);
    // Claimed, as a tile's play is: the deck's word on what played before can't put it back while this opens.
    else load(entryOf(p), true);
  };

  const openInspector = () => {
    if (modes.inspector === null) choose('inspector', true);
  };

  // A dot of the inspector's map played: at once and on its own (not from a playlist shown); what was picked is let go,
  // so the details, the map's ring and the grid follow what plays from here on.
  const playDot = (row: LibraryRow) => {
    const p = byKey.get(row.key);
    if (!p) return;
    toSource();
    void load(entryOf(p), true);
  };
  // A tile of a playlist's grid played: from that place in it, the inspector showing it at once.
  const playTile = (t: StripTile) => {
    const undo = showPlayed(library.find((e) => e.path === t.path) ?? { path: t.path, name: t.name, group: '' });
    playAt(t.index, t.path, t.name, undo);
  };

  // The library's view (Grid or Map, the app's choice): in Map view the room under the hero shows the map, and the inspector
  // leaves its own map section out (never two maps). Quick add keeps the grid, where a click adds.
  const [view, setView] = useLibraryView();
  const [axes, setAxes] = useMapAxes();
  const roomMap = roomShowsMap(view, quickAdd !== null);
  // The head's colour picker shows only over a map with dots (`mapRoom`): never over a note or the grid.
  const libraryHead = (title: string, count: number | null, countTitle?: string, dots = false) => (
    <LibraryHead
      title={title}
      count={count}
      countTitle={countTitle}
      view={view}
      onView={setView}
      switchable={quickAdd === null}
      aside={roomMap && dots ? <ColourPicker axes={axes} onAxes={setAxes} /> : null}
    />
  );
  // In Map view with no dots: the note in the map's place (an empty source keeps its own empty note).
  const noDots = (
    <Text as="p" className="vs-home-note vs-home-grid-empty">
      {NO_DOTS_NOTE}
    </Text>
  );
  // A playlist's map: its presets as dots. Empty, its pane says so; presets but no dots, the note; read, the map.
  const listMapRows = useMemo(() => (list && roomMap ? listRows(list, rows ?? [], played.paths) : []), [list, roomMap, rows, played.paths]);
  // Until the library is read, the pane (its tiles, or "Reading the library…").
  const listRoom = roomMap && rows ? mapRoom(total, drawnOf(listMapRows)) : null;
  // A dot of a playlist's map played: from its place in the playlist (`listPlace`, as the strip numbers it, so a preset past
  // the grid's last tile too), the inspector showing it at once; a place the page can't name (a smart playlist playing
  // shuffled) opens it on its own.
  const playListDot = (row: LibraryRow) => {
    if (!list || row.path === current?.path) return;
    if (tilesPicked.length) pickInList([]);
    const name = byKey.get(row.key)?.title ?? row.title;
    const undo = showPlayed(library.find((e) => e.path === row.path) ?? { path: row.path, name, group: '' });
    playAt(listPlace(list, row, rows ?? [], played.paths, deck.playlist === list.id), row.path, name, undo);
  };

  const sourceName = paneName(shown, lists);
  // The playlist's head: its card in the inspector, or over its pane while it is empty.
  const playlistHead = (variant: 'pane' | 'inspector') =>
    list &&
    lists && (
      <PlaylistHead
        variant={variant}
        list={list}
        lists={lists}
        tiles={tiles}
        total={total}
        onLists={setLists}
        onDeleted={() => pick({ kind: 'library' })}
        onError={(what) => fail(`Couldn't ${what}.`)}
        onQuickAdd={offersQuickAdd(list) ? () => startQuickAdd(list.id) : undefined}
      />
    );
  // Before the playlists are read nothing is shown yet: the card names the library, as it will most likely be.
  const sourceCard = !shown ? (
    <SourceCard name={sourceName} count={counts.library} offer={false} />
  ) : list && lists ? (
    playlistHead('inspector')
  ) : (
    <SourceCard name={sourceName} count={shown.kind === 'starred' ? counts.starred : counts.library} offer={shown.kind === 'library'} />
  );
  // An empty playlist has no grid to pick from, so its card may never show in the inspector (something plays):
  // its head goes over the pane instead, unless the inspector shows that card already.
  const emptyHead = tiles.length === 0 && !(modes.inspector && onSource) ? playlistHead('pane') : undefined;

  const length = presetLength(deck);
  const position = useElapsed(since, current !== null, length);
  // Where it plays from, as the deck says, for the preset shown playing: never a playlist that isn't playing it.
  const from = playsFrom(deck, playlists, true, current?.path ?? null);
  const stepWords = playing ? ' in the playlist' : '';
  // Shows or hides the sidebar: on the title's line in the sidebar's band while it shows, else at the header's lead.
  const sidebarToggle = (
    <PanelToggle
      panel="sidebar"
      name={say('source list')}
      controls={SIDEBAR_ID}
      open={modes.sidebar !== 'hidden'}
      title={`${modes.sidebar === 'hidden' ? 'Show' : 'Hide'} the ${say('source list')} (⌃⌘S)`}
      onPress={toggleSidebar}
    />
  );

  return (
    <>
      <HomeLayout
        lights={lights}
        sidebarMode={modes.sidebar}
        inspectorMode={modes.inspector}
        onDismiss={dismissOverlays}
        // The sidebar's toggle on the title's line in its band (Settings is the sidebar's foot row).
        titleAction={sidebarToggle}
        // The panels' glass takes the playing preset's colours (its thumbnail: the native preview can't be read from the page).
        ambient={playingShown?.row.thumbnail ?? null}
        sidebar={
          <InsetSidebar
            sections={sections}
            selected={shown}
            // The source shown, picked again: its card in the inspector (how the library's full-library offer is reached while a preset plays).
            onSelect={(next) => {
              if (shown && samePane(next, shown) && !quickAdd) {
                setInfo(true);
                openInspector();
              } else if (quickAdd && next.kind === 'library') {
                // Quick add is the library already: it stays on.
              } else pick(next);
            }}
            collapsed={collapsed}
            onToggle={(id) => setCollapsed((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))}
            lists={lists}
            actions={actions}
          />
        }
        header={
          <Header
            view="home"
            // The mark is at the top of the sidebar (decision 71).
            mark={false}
            onChange={(next) => next !== 'home' && onMode(next, current?.path ?? null)}
            // Docked, the toggle is in the sidebar's band.
            lead={modes.sidebar === 'docked' ? undefined : sidebarToggle}
          >
            <span className="vs-fill" />
            <div className="vs-home-toolbar" ref={setToolbar} />
            {/* The audio input, out of the Now Playing card (its TransportBar has `audio={false}`), left of the icon buttons. */}
            <TransportAudio onAudioError={audioFailed} audioTrouble={audioTrouble} folded />
            {/* The icon buttons, spaced as the view switch's links are. */}
            <div className="vs-home-tools">
              <CameraAction />
              <PanelToggle
                panel="inspector"
                name={say('inspector')}
                controls={INSPECTOR_ID}
                open={modes.inspector !== null}
                title={`${modes.inspector === null ? 'Show' : 'Hide'} the ${say('inspector')} (⌘I)`}
                onPress={toggleInspector}
              />
            </div>
          </Header>
        }
        // Round 2 (decision 71): the hero is the picture alone; the bar names what plays.
        // The transport floats over the preview's foot, shown on hover or focus (Hero's `controls`); its keys (H, ← →, R) work whether it shows or not.
        hero={
          <Hero
            picture={<Preview className={HERO_PIC} />}
            controls={
              <TransportBar
                layout="overlay"
                // The dice by the star, ◀ ring ▶ dead centre, the audio input in the header.
                audio={false}
                diceByStar
                centreKeys
                now={current ? { name: playingShown?.title ?? current.name, from } : null}
                playing={!deck.hold}
                // It moves on by itself on a timer, or on Link's bars.
                moves={movesByItself(deck)}
                onPlayPause={hold}
                onStep={step}
                stepIn={stepWords}
                position={position}
                onAudioError={audioFailed}
                audioTrouble={audioTrouble}
                star={playingShown ? { on: !!playingShown.star, onToggle: () => setData([playingShown.row.key], { star: !playingShown.star }) } : null}
              />
            }
          />
        }
        inspector={
          modes.inspector ? (
            <Inspector
              // The preset picked, else the one playing; the source's card for "Show info", or while nothing plays.
              subject={onSource ? null : (picked[0] ?? playingShown)}
              playing={playingShown?.row.key ?? null}
              // The library map under the details lights what plays, whatever they show.
              playingPreset={playingShown}
              from={playsFrom(deck, playlists, false, current?.path ?? null)}
              playlists={lists?.playlists ?? null}
              library={libraryRows}
              mine={data?.presets}
              onSet={setData}
              onAddTo={addTo}
              // A dot in the library map plays at once, as a library tile's play does, and on its own (`playDot`).
              onPick={playDot}
              // In Map view the room shows the map: the inspector's section goes, the details take the region.
              map={inspectorShowsMap(view, quickAdd !== null)}
              onBack={toSource}
              onPlay={picked.length === 1 ? playPicked : undefined}
              chosen={picked.length > 1 ? picked : undefined}
              source={onSource ? sourceCard : undefined}
              error={panelError}
              // Its ✕ (and Esc anywhere) only while it is laid over the grid; docked, the header's toggle closes it.
              onClose={modes.inspector === 'overlay' ? () => choose('inspector', false) : undefined}
            />
          ) : undefined
        }
        // The grid scrolls itself under the pinned hero, on the column's padding (`--vs-home-pad`).
        pane={
          <div className="vs-home-grid-pane">
            <SettingsNotes />
            {shown && shown.kind !== 'list' ? (
              <>
                {adding && <QuickAddStrip name={adding.name} count={adding.items.length} onDone={endQuickAdd} />}
                <div className="vs-home-library">
                  <PaneTile>
                    {(tileMin) => (
                      <Library
                        key={shown.kind}
                        entries={library}
                        loaded={loaded}
                        search={search}
                        onSearch={setSearch}
                        found={found}
                        current={current?.path ?? null}
                        // While quick add is on a click adds, so the tiles' + goes.
                        into={adding ? null : into}
                        onLoad={(e) => {
                          setInfo(false);
                          void load(e, true);
                        }}
                        onAdd={(e) => into && run(pl.add(into.id, e.path), `add ${e.name} to ${into.name}`)}
                        onPress={(e, thumbnail, ev) => beginDrag(ev, { kind: 'preset', path: e.path, name: e.name, thumbnail }, dropping)}
                        // The tiles' size is the pane's form (PANE_FORMS): small where the column can't hold five wide ones.
                        tileMin={tileMin}
                        home={{
                          scope: shown.kind,
                          title: sourceName,
                          onChosen,
                          bare: true,
                          toolbar,
                          selected: keysOf(sel),
                          controls: INSPECTOR_ID,
                          adding: adding && { name: adding.name, has: addingPaths, onToggle: toggleAdded },
                          head: ({ shown: n, total: all, filtered, drawn }) =>
                            libraryHead(
                              sourceName,
                              filtered ? n : all,
                              filtered ? `${n.toLocaleString('en-US')} of ${all.toLocaleString('en-US')} presets shown` : undefined,
                              mapRoom(n, drawn) === 'map',
                            ),
                          map: roomMap
                            ? (dots, play) =>
                                mapRoom(dots.length, drawnOf(dots)) === 'map' ? (
                                  <LibraryMapView rows={dots} mine={data?.presets} playing={playingShown} source={shown.kind === 'library' ? undefined : sourceName} onPick={play} />
                                ) : (
                                  noDots
                                )
                            : null,
                        }}
                      />
                    )}
                  </PaneTile>
                </div>
              </>
            ) : list && lists ? (
              <>
                {libraryHead(list.name, total, undefined, listRoom === 'map')}
                {listRoom === 'map' ? (
                  <LibraryMapView rows={listMapRows} mine={data?.presets} playing={playingShown} source={list.name} onPick={playListDot} />
                ) : listRoom === 'undrawn' ? (
                  noDots
                ) : (
                  <PlaylistPane
                    key={list.id}
                    list={list}
                    lists={lists}
                    tiles={tiles}
                    total={total}
                    rows={rows}
                    dropping={dropping}
                    picked={tilesPicked}
                    onPick={pickInList}
                    onPlay={playTile}
                    onLists={setLists}
                    onError={(what) => fail(`Couldn't ${what}.`)}
                    onLibrary={() => pick({ kind: 'library' })}
                    head={emptyHead || undefined}
                  />
                )}
              </>
            ) : null}
            <DragGhost />
          </div>
        }
      />
      <HelpOverlay open={help} onClose={() => setHelp(false)} list={HOME_HELP} />
      {/* Any other notice: a small toast in the window's bottom-right corner, over everything, never in the grid. */}
      {banner && (
        <Surface layer="float" radius="control" className="vs-home-toast">
          <Text as="div" size="caption" leading="normal" className="vs-home-notice-type">
            <NoticeBanner className="vs-home-notice" notice={banner} onDismiss={dismiss} />
          </Text>
        </Surface>
      )}
    </>
  );
}

/**
 * **Job.** The inspector's card for the library or the starred presets, while nothing is
 * picked: its name, how many, and (the library) the full library's offer.
 *
 * **Changed.** Type from the contract (display face for the name, tabular readout figures
 * for the count, `--text-3` for the hint). **Kept.** The words and the offer.
 */
export function SourceCard({ name, count, offer }: { name: string; count: number | null; offer: boolean }) {
  return (
    <div className="vs-home-source">
      <Text as="p" leading="normal" className="vs-home-source-kicker">
        Showing
      </Text>
      <Text as="h2" role="display" size="heading" weight="strong" leading="normal" className="vs-home-source-name">
        {name}
      </Text>
      {count !== null && (
        <Text as="p" role="numeral" size="body" weight="body" leading="normal" className="vs-home-source-count">
          {plural(count, 'preset')}
        </Text>
      )}
      <Text as="p" size="caption" className="vs-home-source-hint">
        Click a preset, or press Enter, to play it; ⌘-click to see it here.
      </Text>
      {offer && <PackOffer />}
    </div>
  );
}

/**
 * **Job.** Quick add's strip over the library's grid: `Adding to “Warm up” · 3 presets · Done`.
 *
 * **Changed.** A `--surface-1` tint on the column's padding; Done is type (an `ActionButton`
 * would draw a key, which the principles keep off). **Kept.** The region, its status line and words.
 */
export function QuickAddStrip({ name, count, onDone }: { name: string; count: number; onDone(): void }) {
  return (
    <Text as="div" size="caption" leading="normal" className="vs-home-quickadd" ariaRole="region" aria-label={say('quickadd')}>
      <p className="vs-home-quickadd-text" role="status">
        {Say('quickadd strip')}{' '}
        <Text as="b" size="inherit" weight="strong" leading="normal" className="vs-home-quickadd-name">
          “{name}”
        </Text>
        <span className="vs-home-quickadd-sep" aria-hidden="true">
          ·
        </span>
        {plural(count, 'preset')}
      </p>
      <button type="button" className="vs-home-quickadd-done" onClick={onDone} title={`${Say('quickadd done')}: back to ${name} (Esc)`}>
        {/* The word is the Text: the app's `.vs-root` button reset (`font: inherit`) outranks a Text on the button itself. */}
        <Text size="inherit" weight="strong" leading="normal">
          {Say('quickadd done')}
        </Text>
      </button>
    </Text>
  );
}

/** The inspector's row for a preset playing that the index doesn't list (a file opened from elsewhere, the index not read yet): its name, as the app gave it. */
export function unindexed(e: Entry): LibraryRow {
  const [style = '', sub = null] = e.group ? e.group.split('/') : [];
  return { key: e.path, path: e.path, hash: '', style, sub_style: sub, authors: [], title: e.name, thumbnail: null, look: null, starter: false };
}

/**
 * Settings files that couldn't be read or kept (#99), each a quiet note over the
 * grid in the words the app wrote, until dismissed for this session. The live
 * region is always there, so a problem that comes later is read out too.
 */
function SettingsNotes() {
  const { problems, dismiss } = useSettingsProblems();
  return (
    <div className="vs-home-problems" role="status" aria-label="settings problems">
      {problems.map((p) => (
        <Text as="p" size="caption" key={problemKey(p)} className="vs-home-problem" data-file={p.file}>
          <Text size="inherit" className="vs-home-problem-mark" aria-hidden="true">
            !
          </Text>
          <span className="vs-home-problem-text">{p.message}</span>
          <ActionButton tone="quiet" onPress={() => dismiss(p)} label={`Dismiss the note about ${p.file}`} title="Dismiss: hide this note until the app starts again">
            <Icon name="close" size={12} />
          </ActionButton>
        </Text>
      ))}
    </div>
  );
}

/** The sidebar's Settings row (as ⌘, does): the Settings sheet (#98), over the home. */
export const openSettings = () => openSheet('settings');

/** Whether two panes are the same source. */
export const samePane = (a: Pane, b: Pane): boolean => a.kind === b.kind && (a.kind !== 'list' || (b.kind === 'list' && a.id === b.id));

/** The source to show when none has been picked: the playlist playing, else the library (decision 67), which shows the filter the deck follows (issue 161). */
export function firstPane(lists: Lists): Pane {
  return lists.deck.playlist && lists.playlists.some((p) => p.id === lists.deck.playlist) ? { kind: 'list', id: lists.deck.playlist } : { kind: 'library' };
}

/** The library's index with the user's data over it, read again as either changes; null until read. `apply` takes a change's answer at once. */
export function useLibraryRows() {
  const [index, setIndex] = useState<LibraryRow[] | null>(null);
  const [data, setData] = useState<LibraryData | null>(null);
  useEffect(() => {
    const read = () => void api.libraryIndex().then(setIndex, () => setIndex((i) => i ?? []));
    read();
    api.libraryData().then(setData, () => {});
    const stopIndex = rereadOn(onChanged, read);
    const stopData = rereadOn(
      (f) => api.onLibraryChanged(f),
      () => void api.libraryData().then(setData, () => {}),
    );
    return () => {
      stopIndex();
      stopData();
    };
  }, []);
  const rows = useMemo(() => (index ? prepare(index, data) : null), [index, data]);
  const apply = useCallback((answer: Promise<LibraryData>) => answer.then((d) => void setData(d)), []);
  return { rows, data, apply };
}

/** The presets played lately, newest first; `reread` asks again (after the preset changes). */
function usePlayed() {
  const [paths, setPaths] = useState<string[]>([]);
  const reread = useCallback(() => void pl.recentlyPlayed().then(setPaths, () => {}), []);
  useEffect(reread, [reread]);
  return { paths, reread };
}

/** A playlist's presets as its grid shows them, in play order: while it plays shuffled, the deck's own order, which the page can't work out itself. */
export function useStrip(list: Playlist | null, lists: Lists | null, rows: Prepared[] | null, played: string[]): { tiles: StripTile[]; total: number } {
  const deck = lists?.deck ?? pl.EMPTY_DECK;
  const active = !!list && deck.playlist === list.id;
  const [order, setOrder] = useState<string[] | null>(null);
  const orderKey = active && list ? `${list.id}:${deck.order}:${deck.count}:${list.items.length}` : null;
  useEffect(() => {
    if (orderKey === null) return setOrder(null);
    let live = true;
    pl.deckItems().then(
      (o) => live && setOrder(o),
      () => live && setOrder(null),
    );
    return () => {
      live = false;
    };
  }, [orderKey]);
  return useMemo(() => (list ? strip(list, { rows: rows ?? [], played, playing: active ? order : null }) : { tiles: [], total: 0 }), [list, rows, played, active, order]);
}

/** What a tile in a playlist's grid says to a screen reader: its place, its name, and whether it plays now, plays next or is gone from the library. */
export function stripTileSays(t: StripTile, place: number, playing: boolean, next: boolean, picked = false): string {
  return [`${place}. ${t.name}`, playing && 'playing', next && 'next', t.missing && 'not in the library any more', picked && 'picked'].filter(Boolean).join(', ');
}

/** How a playlist's grid is used (its tooltip, and a hint for VoiceOver): how to pick and play, and, in a playlist you can reorder, how to move a preset and take it out. */
export const stripTip = (reorderable: boolean): string =>
  reorderable ? 'Click a preset to play from there, ⌘-click to see it · drag it, or ⌥← ⌥→, to move it · ✕ takes it out' : 'Click a preset to play from there, ⌘-click to see it';

/** How a click picks a tile: ⇧ a run, ⌘ (or Ctrl) one more; null: a plain click, which plays it (decision 71). */
const tilePickOf = (e: MouseEvent): TilePick | null => (e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : null);

interface PaneProps {
  list: Playlist;
  lists: Lists;
  /** Its presets in play order (`strip`). */
  tiles: StripTile[];
  /** How many it holds; `tiles` stops at `STRIP_CAP`. */
  total: number;
  rows: Prepared[] | null;
  dropping: DragHandlers;
  /** The tiles picked, by tile key. */
  picked: readonly string[];
  onPick(keys: string[]): void;
  /** Play from this tile. */
  onPlay(t: StripTile): void;
  onLists(lists: Lists): void;
  onError(what: string): (e: unknown) => void;
  onLibrary(): void;
  /** Over the note while it is empty: its head (`PlaylistHead`), when the inspector doesn't show it. */
  head?: ReactNode;
}

/**
 * **Job.** A playlist's presets as a wrapping grid in the order they play (its head is the
 * inspector's source card; empty, `head` over its note): a click or Enter plays from there, ⌘ or ⇧ (or
 * Space) picks; in a manual playlist each tile is dragged, or moved with ⌥← ⌥→, to a
 * new place, and ✕ takes it out. Each tile shows its place, and "next".
 *
 * **Changed.** The grid's rules (tile.css's `.home-grid` family) come here with it, on the
 * column's padding and `--space-*`; the focus ring is on the tile (the picture is
 * PresetTile's), the drop bar in `--warning`, the "next" chip and ✕ on `--vs-thumb`'s dark
 * backing without a blur (glass is only for floats). **Kept.** The keys, the drag, the picks,
 * the labels, tooltips and words.
 */
export function PlaylistPane({ list, lists, tiles, total, rows, dropping, picked, onPick, onPlay, onLists, onError, onLibrary, head }: PaneProps) {
  const drag = useDrag();
  const { deck } = lists;
  const active = deck.playlist === list.id;
  const run = (p: Promise<Lists | void>, what: string) => p.then((l) => l && onLists(l), onError(what));
  const byPath = useMemo(() => new Map((rows ?? []).map((p) => [p.row.path, p])), [rows]);
  const anchor = useRef<string | null>(null);
  const tileKeys = useMemo(() => tiles.map((t) => t.key), [tiles]);

  const manual = list.kind === 'manual';
  const shuffledNow = active && list.settings.order === 'shuffle';
  const reorderable = manual && !shuffledNow;
  const currentAt = (t: StripTile) => active && (manual || !shuffledNow ? deck.index !== null && t.index === deck.index : t.path === deck.current);
  const nextAt = (t: StripTile) => active && (manual || !shuffledNow ? deck.next_index !== null && t.index === deck.next_index : t.path === deck.next);
  const tip = stripTip(reorderable);

  if (tiles.length === 0)
    return (
      <>
        {head}
        <Text as="p" className="vs-home-note vs-home-grid-empty">
          {manual ? (
            <>
              {list.name} is empty. Open the{' '}
              <button type="button" className="vs-home-link" onClick={onLibrary}>
                library
              </button>{' '}
              and drag presets onto <b>{list.name}</b> in the {say('source list')}, or add the one playing from the {say('inspector')} pane.
            </>
          ) : rows === null ? (
            'Reading the library…'
          ) : (
            'Nothing in the library matches this yet.'
          )}
        </Text>
      </>
    );

  return (
    // What is picked here is what the inspector shows: a press in the grid doesn't put away the inspector laid over it.
    <ol className="vs-home-grid" aria-label={`${list.name}, in the order it plays`} aria-controls={INSPECTOR_ID} title={tip} data-hint={tip}>
      {tiles.map((t, i) => {
        const target = manual && t.index !== null ? itemTarget(list.id, t.index) : undefined;
        const payload: Payload | null = reorderable && t.index !== null ? { kind: 'item', list: list.id, index: t.index, path: t.path, name: t.name, thumbnail: t.thumbnail } : null;
        const known = byPath.get(t.path);
        const chosen = picked.includes(t.key);
        const choose = (how: TilePick) => {
          const next = pickTiles(picked, tileKeys, i, how, anchor.current);
          if (how !== 'range') anchor.current = t.key;
          onPick(next);
        };
        return (
          <PresetTile
            as="li"
            key={t.key}
            className="vs-home-tile"
            thumbnail={t.thumbnail}
            name={tileName(known?.title ?? t.name, t.path)}
            by={known ? tileBy(known.authors, known.style) : ''}
            playing={currentAt(t)}
            marks={
              nextAt(t) && (
                <Text leading="normal" className="vs-home-tile-next">
                  next
                </Text>
              )
            }
            tools={
              manual &&
              t.index !== null && (
                <span className="vs-home-tile-tools" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                  <ActionButton
                    tone="quiet"
                    onPress={() => run(pl.removeItem(list.id, t.index!), `take ${t.name} out`)}
                    label={`Take ${t.name} out of ${list.name}`}
                    title="Take it out of the playlist"
                  >
                    <Icon name="close" size={12} />
                  </ActionButton>
                </span>
              )
            }
            tabIndex={0}
            aria-label={stripTileSays(t, i + 1, currentAt(t), nextAt(t), chosen)}
            aria-current={currentAt(t) ? 'true' : undefined}
            data-picked={chosen ? '' : undefined}
            data-next={nextAt(t) ? '' : undefined}
            data-missing={t.missing ? '' : undefined}
            data-drop={reorderable ? target : undefined}
            data-over={target && isOver(drag, target) ? (drag?.payload.kind === 'item' && drag.payload.list === list.id && drag.payload.index < (t.index ?? 0) ? 'after' : 'before') : undefined}
            data-dragged={drag?.payload.kind === 'item' && drag.payload.list === list.id && drag.payload.index === t.index ? '' : undefined}
            title={t.missing ? `Not in the library any more: ${t.path}` : `${t.name} — click to play from here`}
            onClick={(e: MouseEvent) => {
              // A double-click's second click doesn't play it again.
              if (e.detail > 1) return;
              const how = tilePickOf(e);
              if (how) return choose(how);
              // Played, the picks go: the inspector shows what plays.
              anchor.current = t.key;
              if (picked.length) onPick([]);
              onPlay(t);
            }}
            onPointerDown={payload ? (e) => beginDrag(e, payload, dropping) : undefined}
            onKeyDown={(e: KeyboardEvent) => {
              if (e.target !== e.currentTarget) return;
              const by = e.altKey && e.key === 'ArrowLeft' ? -1 : e.altKey && e.key === 'ArrowRight' ? 1 : 0;
              const to = by && reorderable && t.index !== null ? nudge(t.index, by, list.items.length) : null;
              if (to !== null) {
                e.preventDefault();
                e.stopPropagation();
                const grid = e.currentTarget.parentElement;
                run(pl.moveItem(list.id, t.index!, to), `move ${t.name}`).then(() => requestAnimationFrame(() => (grid?.children[tileFocus(to, tiles.length)] as HTMLElement | undefined)?.focus()));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                // As a click: the picks go, and the inspector shows what plays.
                anchor.current = t.key;
                if (picked.length) onPick([]);
                onPlay(t);
              } else if (e.key === ' ') {
                e.preventDefault();
                choose(e.shiftKey ? 'range' : 'toggle');
              } else if (e.key === 'Escape' && picked.length) {
                e.preventDefault();
                e.stopPropagation();
                onPick([]);
              }
            }}
          />
        );
      })}
      {total > tiles.length && (
        <Text as="li" size="caption" leading="normal" className="vs-home-more">
          and {plural(total - tiles.length, 'more')}
        </Text>
      )}
    </ol>
  );
}

/**
 * The preset being dragged, following the pointer: a `float` layer (the theme's glass and
 * lift), dimmed until it is over a place it can land.
 */
function DragGhost() {
  const drag = useDrag();
  if (!drag) return null;
  const { payload, x, y, target } = drag;
  return (
    <Layer level="float" className="vs-home-ghost" data-ok={target ? '' : undefined} style={{ transform: `translate(${x + 12}px, ${y + 12}px)` }} aria-hidden="true">
      {payload.thumbnail ? <img src={payload.thumbnail} alt="" draggable={false} /> : null}
      <Text size="caption" leading="normal">
        {payload.name}
      </Text>
    </Layer>
  );
}
