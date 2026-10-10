import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import * as api from './api.ts';
import type { Entry, LibraryChange, LibraryData, LibraryRow } from './api.ts';
import { HomeBar } from './HomeBar.tsx';
import { Library } from './Library.tsx';
import { browsable, browseOrder, facet, stepIn, prepare, type Prepared } from './librarySearch.ts';
import { useLibrary, rereadOn, stepDeck } from './library.ts';
import { NowPanel } from './NowPanel.tsx';
import { onChanged } from './pack.ts';
import { PlaylistHead } from './PlaylistHead.tsx';
import { PresetTile, tileBy, tileName } from './PresetTile.tsx';
import * as pl from './playlists.ts';
import type { Lists, Playlist } from './playlists.ts';
import { useNotice, useTauriEvent } from './hooks.ts';
import { isTyping, nameOf, notice, openFailed } from './shell.ts';
import { plural } from './controls.ts';
import { beginDrag, dropAction, isOver, itemTarget, nudge, runDrop, useDrag, type DragHandlers, type Payload } from './drag.ts';
import { localMark, matches, PANEL_KEY, playsFrom, remember, remembered, seedStarters, strip, tileFocus, type Pane, type StripTile } from './home.ts';
import { Sidebar, SourceMenu, paneName, type SidebarProps } from './Sources.tsx';
import { Header, NoticeBanner, openSheet, type View } from './views.tsx';
import { problemKey, useSettingsProblems } from './survive.ts';
import './home.css';

export { Sidebar, rowSays } from './Sources.tsx';
export { SettingsBar } from './PlaylistHead.tsx';
export type { Pane } from './home.ts';

/**
 * The narrowest a library tile gets on the home, where the library has the main
 * pane's width: `small` under `under` px, where the sidebar and the panel narrow
 * (home.css), so the grid keeps three across at 900 px with the panel open (decision 68).
 */
export const HOME_TILE = { wide: 150, small: 124, under: 1100 };

/** Under this width (px) the sidebar is a menu and the Now Playing panel an overlay, closed at first (decision 67). */
export const NARROW = 900;

/** True while the window is narrower than `NARROW`. */
const useNarrow = (): boolean => useNarrowerThan(NARROW);

/** True while the window is narrower than `width` px. */
function useNarrowerThan(width: number): boolean {
  const query = `(max-width: ${width - 1}px)`;
  const [narrow, setNarrow] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const m = window.matchMedia(query);
    const change = () => setNarrow(m.matches);
    change();
    m.addEventListener?.('change', change);
    return () => m.removeEventListener?.('change', change);
  }, [query]);
  return narrow;
}

/**
 * The home (#96; since decision 66 the one place to browse; since 67 laid out
 * like a music app): the header (the mark, home | live, ⚙); a source list down
 * the left (the library, starred, recently played, then the playlists and the
 * smart playlists); the main pane, the library's grid or a playlist's strip
 * under its header; the Now Playing panel on the right with the big preview of
 * the preset playing, which can be closed; and the bottom bar with what plays,
 * ◀ ▶ R, what the app listens to, the panel's toggle and "go live". Under 900 px
 * the source list is a menu at the top of the main pane, the panel, opened,
 * takes the main pane's place, and the bar carries a small preview that opens
 * it. Closing the panel puts focus on the bar's way back to it; opening it from
 * the bar moves focus into it. Presets are dragged
 * from the library onto a playlist in the source list, and about within a
 * playlist's strip. `library` opens it on the library pane
 * (`VISUALS_VIEW=library`), as it opens anyway unless a playlist plays.
 */
export function Home({ start, onMode, library: startOnLibrary = false }: { start: string | null; onMode(view: View, path: string | null): void; library?: boolean }) {
  const [current, setCurrent] = useState<Entry | null>(null);
  const { notice: banner, set: setNotice, fail, dismiss } = useNotice();
  const [lists, setLists] = useState<Lists | null>(null);
  const [pane, setPane] = useState<Pane | null>(startOnLibrary ? { kind: 'library' } : null);
  const audioFailed = useMemo(() => fail("Couldn't read the audio input."), [fail]);

  const load = useCallback(
    async (e: Entry) => {
      setCurrent(e);
      dismiss();
      try {
        await api.open(e.path);
      } catch (err) {
        setNotice(notice(`Couldn't open ${e.name}.`, err));
      }
    },
    [dismiss, setNotice],
  );
  // Picking up where the app left off, the preset put back stays: named in the bar and the panel (unless the deck said first), not opened again.
  const { library, loaded, search, setSearch, found } = useLibrary(start, load, fail, (e) => setCurrent((c) => c ?? e));
  const { rows, apply } = useLibraryRows();
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
  // `VITE_HOME_PLAYLIST=<name>` (a dev run only) opens that playlist's pane once the playlists are read, for a headless capture of it.
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
    setCurrent(library.find((e) => e.path === path) ?? { path, name: nameOf(path), group: '' });
    setNotice(now.error ? openFailed(path, now.error) : null);
  });

  // The pane opens on the playlist playing, else the library.
  const playlists = lists?.playlists ?? [];
  const deck = lists?.deck ?? pl.EMPTY_DECK;
  const shown: Pane | null = pane && (pane.kind !== 'list' || playlists.some((p) => p.id === pane.id)) ? pane : lists ? firstPane(lists) : null;
  const list = shown?.kind === 'list' ? (playlists.find((p) => p.id === shown.id) ?? null) : null;
  // The playlist the library's + adds to: the last manual one picked, or the one playing.
  const [lastManual, setLastManual] = useState<string | null>(null);
  const into = playlists.find((p) => p.kind === 'manual' && p.id === (lastManual ?? deck.playlist)) ?? null;
  const pick = (next: Pane) => {
    setPane(next);
    if (next.kind === 'list' && playlists.find((p) => p.id === next.id)?.kind === 'manual') setLastManual(next.id);
  };

  // The Now Playing panel: open in a wide window as the viewer left it; in the main pane's place, and closed at first, in a narrow one.
  const narrow = useNarrow();
  const tileMin = useNarrowerThan(HOME_TILE.under) ? HOME_TILE.small : HOME_TILE.wide;
  // `VITE_HOME_PANEL=0` (a dev run only) starts with it closed in a wide window, for a headless capture of the bar with its small preview.
  const [panelWide, setPanelWide] = useState(() => !(import.meta.env.DEV && import.meta.env.VITE_HOME_PANEL === '0') && remembered(PANEL_KEY, true));
  // `VITE_HOME_PANEL=1` (a dev run only) starts with it open in a narrow window too, for a headless capture of it.
  const [panelNarrow, setPanelNarrow] = useState(() => import.meta.env.DEV && import.meta.env.VITE_HOME_PANEL === '1');
  const panel = narrow ? panelNarrow : panelWide;
  // Where focus goes once the panel has opened or closed: into it, or to the bar's way back to it.
  const focusAfter = useRef<'panel' | 'bar' | null>(null);
  const setPanel = (open: boolean, focus: 'panel' | 'bar' | null = null) => {
    focusAfter.current = focus;
    if (narrow) return setPanelNarrow(open);
    remember(PANEL_KEY, open);
    setPanelWide(open);
  };
  useEffect(() => {
    const to = focusAfter.current;
    focusAfter.current = null;
    if (to === 'panel') document.querySelector<HTMLElement>('.now-panel .now-close')?.focus();
    // In a narrow window the bar's toggle is hidden: its small preview opens the panel instead.
    else if (to === 'bar') document.querySelector<HTMLElement>(narrow ? '.home-bar-mini-button' : '.home-bar [aria-label="now playing panel"]')?.focus();
  }, [panel, narrow]);

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
  useEffect(() => {
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e)) return;
      if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key.toLowerCase() === 'r') step(0);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [step]);

  const run = (p: Promise<Lists | void>, what: string) => p.then((l) => l && setLists(l), fail(`Couldn't ${what}.`));

  // A drop anywhere on the home: onto a playlist in the source list, or a place in the strip.
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
    pl.importList(text).then((l) => {
      setLists(l);
      const made = l.playlists[l.playlists.length - 1];
      if (made) pick({ kind: 'list', id: made.id });
    }, fail("Couldn't add that playlist file."));

  // How many presets each source holds, for the source list.
  const counts = useMemo<SidebarProps['counts']>(() => {
    const smart = new Map<string, number>();
    if (rows) for (const p of playlists) if (p.kind === 'smart' && p.query) smart.set(p.id, matches(p.query, rows, played.paths).length);
    return {
      // What the library's grid shows with nothing filtered: utility presets wait for a filter (decision 68).
      library: rows ? browsable(rows).length : null,
      starred: rows ? browsable(rows).filter((p) => p.star).length : null,
      list: (p: Playlist) => (p.kind === 'manual' ? p.items.length : (smart.get(p.id) ?? null)),
    };
  }, [rows, playlists, played.paths]);
  const sources: SidebarProps = { lists, shown, counts, onPick: pick, onLists: setLists, onImport: imported, onError: (what) => fail(`Couldn't ${what}.`) };
  const menu = <SourceMenu {...sources} />;

  // What the panel is about: several presets picked in the grid, else the one playing.
  const [chosen, setChosen] = useState<Prepared[]>([]);
  const byPath = useMemo(() => new Map((rows ?? []).map((p) => [p.row.path, p])), [rows]);
  const playingRow = current ? byPath.get(current.path) : undefined;
  const subject = shown?.kind !== 'list' && chosen.length > 1 ? chosen : playingRow ? [playingRow] : [];
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

  const from = playsFrom(deck, playlists);
  return (
    <div className="app home" data-view="home" data-panel={panel ? '' : undefined}>
      <Header view="home" onChange={(next) => next !== 'home' && onMode(next, current?.path ?? null)}>
        <span className="vf-fill" />
        <Button tone="quiet" onPress={openSettings} label="settings" title="Settings: sound, presets, the output, quality and more">
          ⚙
        </Button>
      </Header>
      <aside className="home-side">
        <Sidebar {...sources} />
      </aside>
      <main className="home-main">
        <NoticeBanner className="home-notice" notice={banner} onDismiss={dismiss} />
        <SettingsNotes />
        {shown && shown.kind !== 'list' ? (
          <Library
            entries={library}
            loaded={loaded}
            search={search}
            onSearch={setSearch}
            found={found}
            current={current?.path ?? null}
            into={into}
            onLoad={load}
            onAdd={(e) => into && run(pl.add(into.id, e.path), `add ${e.name} to ${into.name}`)}
            onPress={(e, thumbnail, ev) => beginDrag(ev, { kind: 'preset', path: e.path, name: e.name, thumbnail }, dropping)}
            tileMin={tileMin}
            home={{ scope: shown.kind, title: paneName(shown, lists), menu, onChosen: setChosen }}
          />
        ) : list && lists ? (
          <PlaylistPane
            key={list.id}
            list={list}
            lists={lists}
            rows={rows}
            played={played.paths}
            dropping={dropping}
            onLists={setLists}
            onDeleted={() => setPane({ kind: 'library' })}
            onError={(what) => fail(`Couldn't ${what}.`)}
            onLibrary={() => pick({ kind: 'library' })}
            menu={menu}
          />
        ) : null}
      </main>
      {panel && (
        <div className="home-now">
          <NowPanel
            chosen={subject}
            current={current}
            from={playsFrom(deck, playlists, false)}
            playlists={lists?.playlists ?? null}
            onSet={setData}
            onAddTo={addTo}
            onClose={() => setPanel(false, 'bar')}
            error={panelError}
          />
        </div>
      )}
      <HomeBar
        name={playingRow?.title ?? current?.name ?? null}
        from={current ? from : ''}
        onStep={step}
        stepIn={playing ? ' in the playlist' : ''}
        panel={panel}
        // The toggle keeps focus; the small preview, which goes as the panel opens, hands it to the panel.
        onPanel={(from) => setPanel(!panel, from === 'mini' && !panel ? 'panel' : null)}
        mini={!panel}
        onLive={() => onMode('live', current?.path ?? null)}
        onAudioError={audioFailed}
      />
      <DragGhost />
    </div>
  );
}

/**
 * Settings files that couldn't be read or kept (#99), each a quiet note over the
 * main pane in the words the app wrote, until dismissed for this session. The
 * live region is always there, so a problem that comes later is read out too.
 */
function SettingsNotes() {
  const { problems, dismiss } = useSettingsProblems();
  return (
    <div className="home-problems" role="status" aria-label="settings problems">
      {problems.map((p) => (
        <p key={problemKey(p)} className="home-problem" data-file={p.file}>
          <span className="home-problem-mark" aria-hidden="true">
            !
          </span>
          <span className="home-problem-text">{p.message}</span>
          <Button tone="quiet" onPress={() => dismiss(p)} label={`Dismiss the note about ${p.file}`} title="Dismiss: hide this note until the app starts again">
            ✕
          </Button>
        </p>
      ))}
    </div>
  );
}

/** The header's ⚙: the Settings sheet (#98), over the home. */
export const openSettings = () => openSheet('settings');

/** The pane to show when none has been picked: the playlist playing, else the library (decision 67), which shows the filter the deck follows (#161). */
export function firstPane(lists: Lists): Pane {
  return lists.deck.playlist && lists.playlists.some((p) => p.id === lists.deck.playlist) ? { kind: 'list', id: lists.deck.playlist } : { kind: 'library' };
}

/** The library's index with the user's data over it, read again as either changes; null until read. `apply` takes a change's answer at once. */
function useLibraryRows() {
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
  return { rows, apply };
}

/** The presets played lately, newest first; `reread` asks again (after the preset changes). */
function usePlayed() {
  const [paths, setPaths] = useState<string[]>([]);
  const reread = useCallback(() => void pl.recentlyPlayed().then(setPaths, () => {}), []);
  useEffect(reread, [reread]);
  return { paths, reread };
}

/** Enter or space on a tile, as a click. */
const onActivate = (f: () => void) => (e: KeyboardEvent) => {
  if (e.target !== e.currentTarget) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    f();
  }
};

/** What a tile in the strip says to a screen reader: its place, its name, and whether it plays now, plays next or is gone from the library. */
export function stripTileSays(t: StripTile, place: number, playing: boolean, next: boolean): string {
  return [`${place}. ${t.name}`, playing && 'playing', next && 'next', t.missing && 'not in the library any more'].filter(Boolean).join(', ');
}

/** The strip's one-line tip: how to play from a preset, and, in a playlist you can reorder, how to move one and take it out. */
export const stripTip = (reorderable: boolean): string => (reorderable ? 'Click a preset to play from there · drag it, or ⌥← ⌥→, to move it · ✕ takes it out' : 'Click a preset to play from there');

interface PaneProps {
  list: Playlist;
  lists: Lists;
  rows: Prepared[] | null;
  played: string[];
  dropping: DragHandlers;
  onLists(lists: Lists): void;
  onDeleted(): void;
  onError(what: string): (e: unknown) => void;
  onLibrary(): void;
  /** The narrow window's source menu, for the header. */
  menu?: ReactNode;
}

/** A playlist: its header (name, how it plays, play, shuffle, its settings and more), and its presets as a strip in the order they play. */
export function PlaylistPane({ list, lists, rows, played, dropping, onLists, onDeleted, onError, onLibrary, menu }: PaneProps) {
  const drag = useDrag();
  const { playlists, deck } = lists;
  const at = playlists.indexOf(list);
  const active = deck.playlist === list.id;
  const run = (p: Promise<Lists | void>, what: string) => p.then((l) => l && onLists(l), onError(what));

  // What the deck plays, in its order, while this playlist plays: a shuffled order the page can't work out itself.
  const [order, setOrder] = useState<string[] | null>(null);
  const orderKey = active ? `${deck.order}:${deck.count}:${list.items.length}` : null;
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
  const { tiles, total } = useMemo(() => strip(list, { rows: rows ?? [], played, playing: active ? order : null }), [list, rows, played, active, order]);
  // Each tile's library row, for its name and author line.
  const byPath = useMemo(() => new Map((rows ?? []).map((p) => [p.row.path, p])), [rows]);

  const play = (index: number | null) => run(pl.act(active && index !== null ? { kind: 'go', index } : { kind: 'load', playlist: at, index }), `play ${list.name}`);

  const manual = list.kind === 'manual';
  const shuffledNow = active && list.settings.order === 'shuffle';
  const reorderable = manual && !shuffledNow;
  const currentAt = (t: StripTile) => active && (manual || !shuffledNow ? deck.index !== null && t.index === deck.index : t.path === deck.current);
  const nextAt = (t: StripTile) => active && !deck.hold && (manual || !shuffledNow ? deck.next_index !== null && t.index === deck.next_index : t.path === deck.next);

  return (
    <div className="home-pane">
      <PlaylistHead list={list} lists={lists} tiles={tiles} total={total} onLists={onLists} onDeleted={onDeleted} onError={onError} menu={menu} />
      {tiles.length === 0 ? (
        <p className="home-note home-strip-empty">
          {manual ? (
            <>
              {list.name} is empty. Open the{' '}
              <button type="button" className="home-link" onClick={onLibrary}>
                library
              </button>{' '}
              and drag presets onto <b>{list.name}</b> in the sidebar, or use + playlist in the now playing panel.
            </>
          ) : rows === null ? (
            'Reading the library…'
          ) : (
            'Nothing in the library matches this yet.'
          )}
        </p>
      ) : (
        <>
          {/* What the hint footer used to say about the strip, kept where the strip is. */}
          <p className="home-strip-tip">{stripTip(reorderable)}</p>
          <ol className="home-strip" aria-label={`${list.name}, in the order it plays`} data-hint={stripTip(reorderable)}>
            {tiles.map((t, i) => {
              const target = manual && t.index !== null ? itemTarget(list.id, t.index) : undefined;
              const payload: Payload | null = reorderable && t.index !== null ? { kind: 'item', list: list.id, index: t.index, path: t.path, name: t.name, thumbnail: t.thumbnail } : null;
              const open = () => (t.index !== null ? play(t.index) : api.open(t.path).catch(onError(`open ${t.name}`)));
              const known = byPath.get(t.path);
              return (
                <PresetTile
                  as="li"
                  key={t.key}
                  className="home-tile"
                  thumbnail={t.thumbnail}
                  name={tileName(known?.title ?? t.name, t.path)}
                  by={known ? tileBy(known.authors, known.style) : ''}
                  playing={currentAt(t)}
                  marks={
                    <>
                      <b className="home-tile-n">{i + 1}</b>
                      {nextAt(t) && <span className="home-tile-next">next</span>}
                    </>
                  }
                  tools={
                    manual &&
                    t.index !== null && (
                      <span className="home-tile-tools" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                        <Button
                          tone="quiet"
                          onPress={() => run(pl.removeItem(list.id, t.index!), `take ${t.name} out`)}
                          label={`Take ${t.name} out of ${list.name}`}
                          title="Take it out of the playlist"
                        >
                          ✕
                        </Button>
                      </span>
                    )
                  }
                  tabIndex={0}
                  aria-label={stripTileSays(t, i + 1, currentAt(t), nextAt(t))}
                  aria-current={currentAt(t) ? 'true' : undefined}
                  data-next={nextAt(t) ? '' : undefined}
                  data-missing={t.missing ? '' : undefined}
                  data-drop={reorderable ? target : undefined}
                  data-over={target && isOver(drag, target) ? (drag?.payload.kind === 'item' && drag.payload.list === list.id && drag.payload.index < (t.index ?? 0) ? 'after' : 'before') : undefined}
                  data-dragged={drag?.payload.kind === 'item' && drag.payload.list === list.id && drag.payload.index === t.index ? '' : undefined}
                  title={t.missing ? `Not in the library any more: ${t.path}` : `${t.name} — click to play from here`}
                  onClick={open}
                  onPointerDown={payload ? (e) => beginDrag(e, payload, dropping) : undefined}
                  onKeyDown={(e) => {
                    const by = e.altKey && e.key === 'ArrowLeft' ? -1 : e.altKey && e.key === 'ArrowRight' ? 1 : 0;
                    const to = by && reorderable && t.index !== null && e.target === e.currentTarget ? nudge(t.index, by, list.items.length) : null;
                    if (to === null) return onActivate(open)(e);
                    e.preventDefault();
                    e.stopPropagation();
                    const strip = e.currentTarget.parentElement;
                    run(pl.moveItem(list.id, t.index!, to), `move ${t.name}`).then(() =>
                      requestAnimationFrame(() => (strip?.children[tileFocus(to, tiles.length)] as HTMLElement | undefined)?.focus()),
                    );
                  }}
                />
              );
            })}
            {total > tiles.length && <li className="home-more">and {plural(total - tiles.length, 'more')}</li>}
          </ol>
        </>
      )}
    </div>
  );
}

/** The preset being dragged, following the pointer. */
function DragGhost() {
  const drag = useDrag();
  if (!drag) return null;
  const { payload, x, y, target } = drag;
  return (
    <div className="home-ghost" data-ok={target ? '' : undefined} style={{ transform: `translate(${x + 12}px, ${y + 12}px)` }} aria-hidden="true">
      {payload.thumbnail ? <img src={payload.thumbnail} alt="" draggable={false} /> : null}
      <span>{payload.name}</span>
    </div>
  );
}
