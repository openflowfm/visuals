import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { NumberField } from '@openflow/widgets/controls/NumberField.tsx';
import { Segmented } from '@openflow/widgets/controls/Segmented.tsx';
import type { Param } from '@openflow/widgets/param/param.ts';
import * as api from './api.ts';
import type { Entry, LibraryData, LibraryRow } from './api.ts';
import { AudioInput } from './AudioInput.tsx';
import { Library } from './Library.tsx';
import { stepIn, prepare, queryName } from './librarySearch.ts';
import { useLibrary, rereadOn } from './library.ts';
import { onChanged } from './pack.ts';
import * as pl from './playlists.ts';
import type { Lists, Playlist, PlaylistSettings } from './playlists.ts';
import { useNotice, useTauriEvent } from './hooks.ts';
import { isTyping, nameOf, notice, openFailed } from './shell.ts';
import { plural } from './controls.ts';
import { beginDrag, dropAction, isOver, itemTarget, listTarget, nudge, runDrop, useDrag, type DragHandlers, type Payload } from './drag.ts';
import { changeUnit, localMark, NameEdit, saveFile, sections, seedStarters, strip, tileFocus, withSetting, type StripTile } from './home.ts';
import { FrameRate, Header, Hints, NoticeBanner, NowPlaying, openSheet, Preview, type View } from './views.tsx';
import { say } from './words.ts';
import { problemKey, useSettingsProblems } from './survive.ts';
import './playlists.css';
import './home.css';

/** Whether the home is ready to be the start view; kept in `homeReady.ts` so `views.tsx` can read it without a circular import. */
export { HOME_READY } from './homeReady.ts';

/** What the main pane shows: a playlist, by id, or the library. */
type Pane = { kind: 'list'; id: string } | { kind: 'library' };

/** The narrowest a library tile gets on the home, where the library has the main pane's width. */
const HOME_TILE = 150;

const HINT = '← → previous / next preset · R random · drag a preset from the library onto a playlist · point at anything to read what it does';

/**
 * The playlists home (#96), the app's first screen: a sidebar of playlists,
 * smart playlists and the library, with the preview under them; the main pane
 * is the playlist picked, as a strip of thumbnails in the order it plays with its
 * settings and Play, or the library, full width. Presets are dragged from the
 * library onto a playlist in the sidebar, and about within a playlist's strip.
 */
export function Home({ start, onMode }: { start: string | null; onMode(view: View, path: string | null): void }) {
  const [current, setCurrent] = useState<Entry | null>(null);
  const { notice: banner, set: setNotice, fail, dismiss } = useNotice();
  const [lists, setLists] = useState<Lists | null>(null);
  const [pane, setPane] = useState<Pane | null>(null);
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
  const { library, loaded, search, setSearch, found } = useLibrary(start, load, fail);
  const rows = useLibraryRows();
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
  useTauriEvent(pl.onLive, (now) => {
    setLists((l) => (l ? { ...l, deck: now.deck } : l));
    played.reread();
    if (!now.path) return;
    const path = now.path;
    setCurrent(library.find((e) => e.path === path) ?? { path, name: nameOf(path), group: '' });
    setNotice(now.error ? openFailed(path, now.error) : null);
  });

  // The pane opens on the playlist playing, else the first one, else the library.
  const playlists = lists?.playlists ?? [];
  const deck = lists?.deck ?? pl.EMPTY_DECK;
  const shown: Pane | null = pane && (pane.kind === 'library' || playlists.some((p) => p.id === pane.id)) ? pane : lists ? firstPane(lists) : null;
  const list = shown?.kind === 'list' ? (playlists.find((p) => p.id === shown.id) ?? null) : null;
  // The playlist the library's + adds to: the last manual one picked, or the one playing.
  const [lastManual, setLastManual] = useState<string | null>(null);
  const into = playlists.find((p) => p.kind === 'manual' && p.id === (lastManual ?? deck.playlist)) ?? null;
  const pick = (next: Pane) => {
    setPane(next);
    if (next.kind === 'list' && playlists.find((p) => p.id === next.id)?.kind === 'manual') setLastManual(next.id);
  };

  const playing = deck.playlist;
  const step = useCallback(
    (by: number) => {
      if (playing || deck.query) {
        pl.act({ kind: by === 0 ? 'random' : by > 0 ? 'next' : 'previous' }).catch(fail("Couldn't step the playlist."));
        return;
      }
      const next = stepIn(found.shown.length ? found.shown : library, current?.path ?? null, by);
      if (next) load(next);
    },
    [playing, deck.query, found.shown, library, current, load, fail],
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

  // A drop anywhere on the home: onto a playlist in the sidebar, or a place in the strip.
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

  return (
    <div className="app home" data-view="home">
      <Header view="home" onChange={(next) => next !== 'home' && onMode(next, current?.path ?? null)}>
        <div className="wdg wdg-control-group vf-transport" role="group" aria-label="presets">
          <Button onPress={() => step(-1)} label="previous preset" title="previous preset (←)">
            ◀
          </Button>
          <Button onPress={() => step(1)} label="next preset" title="next preset (→)">
            ▶
          </Button>
          <Button onPress={() => step(0)} label="random preset" title="random preset (R)">
            random
          </Button>
        </div>
        <NowPlaying group={current?.group} name={current?.name} empty={loaded && !library.length ? 'no presets yet' : 'no preset'} />
        <NoticeBanner notice={banner} onDismiss={dismiss} />
        <span className="vf-fill" />
        <AudioInput onError={audioFailed} />
        <FrameRate />
        <Button tone="quiet" onPress={openSettings} label="settings" title="Settings: sound, the output, quality and more">
          ⚙
        </Button>
      </Header>
      <aside className="home-side">
        <Sidebar lists={lists} shown={shown} onPick={pick} onLists={setLists} onImport={imported} onError={(what) => fail(`Couldn't ${what}.`)} rowsReady={rows !== null} />
        <div className="home-preview-cell">
          <Preview className="home-preview" />
        </div>
      </aside>
      <main className="home-main">
        <SettingsNotes />
        {shown?.kind === 'library' ? (
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
            tileMin={HOME_TILE}
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
            onDeleted={() => setPane(null)}
            onError={(what) => fail(`Couldn't ${what}.`)}
            onLibrary={() => pick({ kind: 'library' })}
          />
        ) : (
          lists && (
            <p className="home-note">
              No playlists yet. <b>+</b> beside Playlists makes one; then open the library and drag presets onto it.
            </p>
          )
        )}
      </main>
      <DragGhost />
      <Hints resting={HINT} />
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

/** The pane to show when none has been picked: the playlist playing, else the first, else the library. */
export function firstPane(lists: Lists): Pane {
  const id = lists.deck.playlist ?? lists.playlists[0]?.id;
  return id ? { kind: 'list', id } : { kind: 'library' };
}

/** The library's index with the user's data over it, read again as either changes; null until read. */
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
  return useMemo(() => (index ? prepare(index, data) : null), [index, data]);
}

/** The presets played lately, newest first; `reread` asks again (after the preset changes). */
function usePlayed() {
  const [paths, setPaths] = useState<string[]>([]);
  const reread = useCallback(() => void pl.recentlyPlayed().then(setPaths, () => {}), []);
  useEffect(reread, [reread]);
  return { paths, reread };
}

/** Enter or space on a row, as a click. */
const onActivate = (f: () => void) => (e: KeyboardEvent) => {
  if (e.target !== e.currentTarget) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    f();
  }
};

interface SidebarProps {
  lists: Lists | null;
  shown: Pane | null;
  onPick(pane: Pane): void;
  onLists(lists: Lists): void;
  onImport(text: string): void;
  onError(what: string): (e: unknown) => void;
  rowsReady: boolean;
}

/** What a playlist's row says to a screen reader: its name, what kind it is, how many presets (a manual one), and whether it plays. */
export function rowSays(p: Playlist, playing: boolean): string {
  const what = p.kind === 'smart' ? `smart playlist, fills itself with ${p.query ? queryName(p.query) : 'presets'}` : `playlist, ${plural(p.items.length, 'preset')}`;
  return `${p.name}, ${what}${playing ? ', playing' : ''}`;
}

/** What a tile in the strip says to a screen reader: its place, its name, and whether it plays now, plays next or is gone from the library. */
export function stripTileSays(t: StripTile, place: number, playing: boolean, next: boolean): string {
  return [`${place}. ${t.name}`, playing && 'playing', next && 'next', t.missing && 'not in the library any more'].filter(Boolean).join(', ');
}

/** Playlists, smart playlists, the library: each a row to open in the main pane, and a playlist a place to drop a preset. */
export function Sidebar({ lists, shown, onPick, onLists, onImport, onError }: SidebarProps) {
  const drag = useDrag();
  const file = useRef<HTMLInputElement>(null);
  const playlists = lists?.playlists ?? [];
  const { manual, smart } = sections(playlists);
  const deck = lists?.deck ?? pl.EMPTY_DECK;

  const create = () =>
    pl.create(pl.freshName(playlists)).then((l) => {
      onLists(l);
      const made = l.playlists[l.playlists.length - 1];
      if (made) onPick({ kind: 'list', id: made.id });
    }, onError('make a playlist'));

  const row = (p: Playlist) => {
    const n = playlists.indexOf(p);
    const on = deck.playlist === p.id;
    const picked = shown?.kind === 'list' && shown.id === p.id;
    const target = listTarget(p.id);
    const toggle = () => (on ? pl.act({ kind: 'unload' }) : pl.act({ kind: 'load', playlist: n, index: null })).catch(onError(on ? 'stop the playlist' : `play ${p.name}`));
    return (
      <li
        key={p.id}
        className="home-row"
        tabIndex={0}
        aria-label={rowSays(p, on)}
        aria-current={picked ? 'true' : undefined}
        data-active={on ? '' : undefined}
        data-drop={p.kind === 'manual' ? target : undefined}
        data-over={isOver(drag, target) ? '' : undefined}
        data-refuses={drag && p.kind === 'smart' ? '' : undefined}
        onClick={() => onPick({ kind: 'list', id: p.id })}
        onDoubleClick={toggle}
        onKeyDown={onActivate(() => onPick({ kind: 'list', id: p.id }))}
        title={p.kind === 'smart' ? `${p.name}: fills itself with ${p.query ? queryName(p.query) : 'presets'}` : `${p.name}: drop presets here to add them`}
      >
        <span className="home-row-play" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <Button tone="quiet" onPress={toggle} label={on ? `Stop ${p.name}` : `Play ${p.name}`} title={on ? 'Stop' : `Play ${p.name}`} disabled={!on && p.kind === 'manual' && !p.items.length}>
            {on ? '■' : '▶'}
          </Button>
        </span>
        <span className="home-row-name">{p.name}</span>
        {p.kind === 'manual' && <i aria-hidden="true">{p.items.length}</i>}
      </li>
    );
  };

  return (
    <nav className="home-lists" aria-label="playlists">
      <Section
        title="Playlists"
        tools={
          <>
            <Button tone="quiet" onPress={create} label="new playlist" title="Make a new, empty playlist">
              +
            </Button>
            <Button tone="quiet" onPress={() => file.current?.click()} label="add from a file" title="Add from a file: a playlist someone saved">
              ⤓
            </Button>
            <input
              ref={file}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) f.text().then(onImport, onError('read that file'));
              }}
            />
          </>
        }
      >
        {manual.length ? manual.map(row) : <li className="home-empty">None yet: + makes one.</li>}
      </Section>
      <Section title="Smart playlists">{smart.length ? smart.map(row) : <li className="home-empty">Filter the library, then {say('save query')}.</li>}</Section>
      <ul className="home-section-rows home-library-row">
        <li
          className="home-row"
          tabIndex={0}
          aria-current={shown?.kind === 'library' ? 'true' : undefined}
          onClick={() => onPick({ kind: 'library' })}
          onKeyDown={onActivate(() => onPick({ kind: 'library' }))}
          title="Every preset: search, filter, and drag them onto a playlist"
        >
          <span className="home-row-icon" aria-hidden="true">
            ▦
          </span>
          <span className="home-row-name">Library</span>
        </li>
      </ul>
    </nav>
  );
}

function Section({ title, tools, children }: { title: string; tools?: ReactNode; children: ReactNode }) {
  return (
    <section className="home-section">
      {/* The tools sit beside the heading, not in it: a heading's name is just its title. */}
      <div className="home-section-head">
        <h2 className="home-section-title">{title}</h2>
        {tools}
      </div>
      <ul className="home-section-rows">{children}</ul>
    </section>
  );
}

const EVERY_S: Param = { kind: 'int', min: 1, max: 3600, defaultValue: 30, exponent: 2, name: 'every', customUnit: 's', unit: 'custom' };
const EVERY_BARS: Param = { kind: 'int', min: 1, max: 64, defaultValue: 8, steps: 64, name: 'every', customUnit: 'bars', unit: 'custom' };
const CROSSFADE: Param = { kind: 'float', min: 0, max: 10, defaultValue: 2, steps: 21, name: 'crossfade' };
const SPEED: Param = { kind: 'float', min: 0.25, max: 4, defaultValue: 1, exponent: 2, name: 'speed' };
const TRAILS: Param = { kind: 'float', min: 0, max: 1, defaultValue: 0, steps: 101, name: 'trails' };
const HUE: Param = { kind: 'float', min: 0, max: 1, defaultValue: 0, steps: 361, name: 'colour shift' };

interface PaneProps {
  list: Playlist;
  lists: Lists;
  rows: ReturnType<typeof useLibraryRows>;
  played: string[];
  dropping: DragHandlers;
  onLists(lists: Lists): void;
  onDeleted(): void;
  onError(what: string): (e: unknown) => void;
  onLibrary(): void;
}

/** A playlist: its name and Play, its settings, and its presets as a strip in the order they play. */
export function PlaylistPane({ list, lists, rows, played, dropping, onLists, onDeleted, onError, onLibrary }: PaneProps) {
  const drag = useDrag();
  const [naming, setNamingState] = useState<string | null>(null);
  const nameEdit = useRef(new NameEdit()).current;
  const startNaming = (name: string) => {
    nameEdit.open();
    setNamingState(name);
  };
  const setNaming = setNamingState;
  const [deleting, setDeleting] = useState(false);
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

  const settings = list.settings;
  const set = (next: PlaylistSettings) => {
    onLists({ ...lists, playlists: playlists.map((p) => (p.id === list.id ? { ...p, settings: next } : p)) });
    run(pl.setSettings(list.id, next), 'change the playlist’s settings');
  };

  const play = (index: number | null) => run(pl.act(active && index !== null ? { kind: 'go', index } : { kind: 'load', playlist: at, index }), `play ${list.name}`);
  const stop = () => run(pl.act({ kind: 'unload' }), 'stop the playlist');
  const commitName = () => {
    const name = nameEdit.commit(naming, list.name);
    setNaming(null);
    if (name) run(pl.rename(list.id, name), 'rename the playlist');
  };
  const exportIt = () => pl.exportList(list.id).then((f) => saveFile(f.file_name, f.text), onError(`save ${list.name} to a file`));

  const manual = list.kind === 'manual';
  const shuffledNow = active && settings.order === 'shuffle';
  const reorderable = manual && !shuffledNow;
  const currentAt = (t: StripTile) => active && (manual || !shuffledNow ? deck.index !== null && t.index === deck.index : t.path === deck.current);
  const nextAt = (t: StripTile) => active && !deck.hold && (manual || !shuffledNow ? deck.next_index !== null && t.index === deck.next_index : t.path === deck.next);

  return (
    <div className="home-pane">
      <div className="home-pane-head">
        {naming !== null ? (
          <input
            className="home-name-input"
            aria-label="playlist name"
            autoFocus
            value={naming}
            onChange={(e) => setNaming(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
              else if (e.key === 'Escape') {
                nameEdit.cancel();
                setNaming(null);
              }
            }}
          />
        ) : (
          <h1 className="home-name" title="Double-click to rename" onDoubleClick={() => startNaming(list.name)}>
            {list.name}
          </h1>
        )}
        <span className="home-pane-what">
          {manual ? plural(list.items.length, 'preset') : `fills itself: ${list.query ? queryName(list.query) : 'nothing'} · ${plural(total, 'preset')}`}
          {active && deck.index !== null && ` · playing ${deck.index + 1} of ${manual ? list.items.length : deck.count}`}
        </span>
        <span className="vf-fill" />
        {active ? (
          <Button className="home-on" onPress={stop} title="Stop: ← → step through the library again">
            ■ stop
          </Button>
        ) : (
          <Button className="home-play" onPress={() => play(null)} disabled={manual && !list.items.length} title={manual && !list.items.length ? 'Add presets to play it' : `Play ${list.name}`}>
            ▶ play
          </Button>
        )}
        <Button onPress={() => startNaming(list.name)} title="Rename the playlist">
          rename
        </Button>
        <Button onPress={exportIt} title="Save to a file, to keep or to give someone: its presets by name and content">
          save to a file
        </Button>
        {deleting ? (
          <span className="home-confirm" onKeyDown={(e) => e.key === 'Escape' && setDeleting(false)}>
            <Button
              tone="danger"
              onPress={() => {
                setDeleting(false);
                onDeleted();
                run(pl.remove(list.id), 'delete the playlist');
              }}
              title={`Delete ${list.name} for good`}
            >
              delete it?
            </Button>
            <Button onPress={() => setDeleting(false)} title="Keep the playlist">
              keep
            </Button>
          </span>
        ) : (
          <Button tone="danger" onPress={() => setDeleting(true)} title="Delete the playlist (asks first)">
            delete
          </Button>
        )}
      </div>
      <SettingsBar settings={settings} differs={active ? deck.differs : []} onChange={set} />
      {tiles.length === 0 ? (
        <p className="home-note">
          {manual ? (
            <>
              {list.name} is empty. Open the{' '}
              <button type="button" className="home-link" onClick={onLibrary}>
                library
              </button>{' '}
              and drag presets onto <b>{list.name}</b> in the sidebar.
            </>
          ) : rows === null ? (
            'Reading the library…'
          ) : (
            'Nothing in the library matches this yet.'
          )}
        </p>
      ) : (
        <ol
          className="home-strip"
          aria-label={`${list.name}, in the order it plays`}
          data-hint={reorderable ? 'click plays from there · drag, or ⌥← ⌥→, to move · ✕ takes it out' : 'click plays from there'}
        >
          {tiles.map((t, i) => {
            const target = manual && t.index !== null ? itemTarget(list.id, t.index) : undefined;
            const payload: Payload | null = reorderable && t.index !== null ? { kind: 'item', list: list.id, index: t.index, path: t.path, name: t.name, thumbnail: t.thumbnail } : null;
            const open = () => (t.index !== null ? play(t.index) : api.open(t.path).catch(onError(`open ${t.name}`)));
            return (
              <li
                key={t.key}
                className="home-tile"
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
                  run(pl.moveItem(list.id, t.index!, to), `move ${t.name}`).then(() => requestAnimationFrame(() => (strip?.children[tileFocus(to, tiles.length)] as HTMLElement | undefined)?.focus()));
                }}
              >
                <div className="home-thumb">
                  {t.thumbnail ? <img src={t.thumbnail} alt="" loading="lazy" decoding="async" draggable={false} /> : <span className="home-thumb-none">{t.name}</span>}
                  <b className="home-tile-n">{i + 1}</b>
                  {nextAt(t) && <span className="home-tile-next">next</span>}
                </div>
                <span className="home-tile-name">{t.name}</span>
                {manual && t.index !== null && (
                  <span className="home-tile-tools" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                    <Button tone="quiet" onPress={() => run(pl.removeItem(list.id, t.index!), `take ${t.name} out`)} label={`Take ${t.name} out of ${list.name}`} title="Take it out of the playlist">
                      ✕
                    </Button>
                  </span>
                )}
              </li>
            );
          })}
          {total > tiles.length && <li className="home-more">and {plural(total - tiles.length, 'more')}</li>}
        </ol>
      )}
    </div>
  );
}

/** How a playlist plays: how often it moves on, in what order, the crossfade, and the look it sets. */
export function SettingsBar({ settings, differs, onChange }: { settings: PlaylistSettings; differs: readonly string[]; onChange(next: PlaylistSettings): void }) {
  const tweaked = (name: string) => (differs.includes(name) ? 'changed live; this playlist’s own value comes back when it loads again' : undefined);
  const { change } = settings;
  return (
    <div className="home-settings" role="group" aria-label="how it plays">
      {/* Each control names itself (a `<label>` can't label the widgets' sliders and radio groups); the words beside them are for the eye. */}
      <div className="home-setting" role="group" aria-label={say('auto-advance')} data-tweaked={tweaked('change') ? '' : undefined} title={tweaked('change')}>
        <span aria-hidden="true">{say('auto-advance')} every</span>
        <NumberField
          label={`${say('auto-advance')} every, in ${change.unit === 'bars' ? 'bars' : 'seconds'}`}
          param={change.unit === 'bars' ? EVERY_BARS : EVERY_S}
          value={change.every}
          onChange={(v) => onChange(withSetting(settings, 'change', { unit: change.unit, every: v }))}
          display={change.unit === 'off' ? say('auto-advance off') : change.unit === 'bars' ? plural(Math.round(change.every), 'bar') : `${Math.round(change.every)} s`}
          title={change.unit === 'off' ? say('auto-advance off hint') : change.unit === 'bars' ? "Bars of Ableton Link's beat on each preset" : 'Seconds on each preset'}
        />
        <Segmented
          items={['s', 'bars', say('auto-advance off')]}
          index={change.unit === 'off' ? 2 : change.unit === 'bars' ? 1 : 0}
          onChange={(i) => onChange(changeUnit(settings, i === 2 ? 'off' : i === 1 ? 'bars' : 'seconds'))}
          label="seconds, bars or off"
          hint={`seconds, bars of the beat when you keep in time with Ableton, or ${say('auto-advance off')}`}
        />
      </div>
      <div className="home-setting" data-tweaked={tweaked('order') ? '' : undefined}>
        <Segmented
          items={['in order', 'shuffle']}
          index={settings.order === 'shuffle' ? 1 : 0}
          onChange={(i) => onChange(withSetting(settings, 'order', i === 1 ? 'shuffle' : 'in_order'))}
          label="order"
          hint="play in the order listed, or shuffled"
        />
      </div>
      <Setting name="crossfade" tweak={tweaked('transition')}>
        <NumberField
          label="crossfade"
          param={CROSSFADE}
          value={settings.transition}
          onChange={(v) => onChange(withSetting(settings, 'transition', v))}
          display={`${settings.transition.toFixed(1)} s`}
          title="Seconds one preset fades into the next"
        />
      </Setting>
      <Setting name="speed" tweak={tweaked('speed')}>
        <NumberField
          label="speed"
          param={SPEED}
          value={settings.speed}
          onChange={(v) => onChange(withSetting(settings, 'speed', v))}
          display={`${settings.speed.toFixed(2)}×`}
          title="How fast the presets move"
        />
      </Setting>
      <Setting name="trails" tweak={tweaked('trails')}>
        <NumberField
          label="trails"
          param={TRAILS}
          value={settings.trails}
          onChange={(v) => onChange(withSetting(settings, 'trails', v))}
          display={`${Math.round(settings.trails * 100)}%`}
          title="How long each frame lingers"
        />
      </Setting>
      <Setting name="colour shift" tweak={tweaked('hue')}>
        <NumberField
          label="colour shift"
          param={HUE}
          value={settings.hue}
          onChange={(v) => onChange(withSetting(settings, 'hue', v))}
          display={`${Math.round(settings.hue * 360)}°`}
          title="Turn every colour round the colour wheel"
        />
      </Setting>
    </div>
  );
}

function Setting({ name, tweak, children }: { name: string; tweak?: string; children: ReactNode }) {
  return (
    <div className="home-setting" data-tweaked={tweak ? '' : undefined} title={tweak}>
      <span aria-hidden="true">{name}</span>
      {children}
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
