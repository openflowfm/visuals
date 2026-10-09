import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as api from './api.ts';
import type { Entry, Opened } from './api.ts';
import { AudioInput } from './AudioInput.tsx';
import { Segmented } from '@openflow/widgets/controls/Segmented.tsx';
import { Playlists } from './Playlists.tsx';
import * as pl from './playlists.ts';
import { FrameRate, Header, Hints, HOME, NoticeBanner, NowPlaying, Preview, useSheet, type View } from './views.tsx';
import { Home } from './Home.tsx';
import { Settings } from './Settings.tsx';
import { MoreEffects } from './MoreEffects.tsx';
import { CrashPrompt } from './CrashPrompt.tsx';
import { useAccessibility } from './access.ts';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { Library } from './Library.tsx';
import { stepIn } from './librarySearch.ts';
import { useNotice, useTauriEvent } from './hooks.ts';
import { useLibrary } from './library.ts';
import { isTyping, nameOf, notice, openFailed } from './shell.ts';
import { Live } from './Live.tsx';
import * as output from './output.ts';
import { Onboarding, useWelcome } from './Onboarding.tsx';

// The editor, only in a lab build: without `VITE_LAB` this is `null` at build
// time, and the editor's code (the graph, the inspector, the edits) never reaches
// the bundle.
const Editor = import.meta.env.VITE_LAB ? lazy(() => import('./Lab.tsx')) : null;

/**
 * The home (playlists, once it is ready), the library (browse presets, play them
 * in the preview), live mode (performing controls, the output full screen on a
 * display), and in a lab build the editor; Settings and More effects open over
 * any of them (`openSheet`). `VISUALS_LIVE=1` starts in live mode,
 * `VISUALS_PRESET=<path>` on a preset.
 */
export function App() {
  const [mode, setMode] = useState<{ view: View; preset: string | null; windowed?: boolean } | null>(null);
  const welcome = useWelcome();
  useEffect(() => {
    Promise.all([output.startPreset(), output.liveStart()]).then(
      ([preset, live]) => setMode({ view: live ? 'live' : HOME, preset }),
      () => setMode({ view: HOME, preset: null }),
    );
  }, []);
  const onMode = useCallback((view: View, preset: string | null) => setMode({ view, preset }), []);
  const { sheet, close } = useSheet();
  useAccessibility();
  if (!mode || welcome.shown === null) return null;
  if (welcome.shown)
    return (
      <Onboarding
        onDone={(end) => {
          welcome.close();
          // Arriving from the flow, live mode plays in the window: the output isn't opened on a display.
          setMode({ view: end === 'live' ? 'live' : HOME, preset: null, windowed: end === 'live' });
        }}
      />
    );
  return (
    <>
      <Page mode={mode} onMode={onMode} />
      <Settings open={sheet === 'settings'} onClose={close} />
      <MoreEffects open={sheet === 'effects'} onClose={close} />
      <CrashPrompt />
    </>
  );
}

/** The view showing, under the sheets `App` lays over every view. */
function Page({ mode, onMode }: { mode: { view: View; preset: string | null; windowed?: boolean }; onMode(view: View, preset: string | null): void }) {
  if (mode.view === 'live') return <Live start={mode.preset} onMode={onMode} windowed={mode.windowed} />;
  if (mode.view === 'home') return <Home start={mode.preset} onMode={onMode} />;
  if (mode.view === 'editor' && Editor)
    return (
      <Suspense fallback={null}>
        <Editor start={mode.preset} onMode={onMode} />
      </Suspense>
    );
  return <Browse view="library" start={mode.preset} onMode={onMode} />;
}

export interface BrowseProps {
  view: View;
  start: string | null;
  onMode(view: View, path: string | null): void;
  /** Each preset as it opens, from the library or live (a playlist step, auto-advance, a controller). */
  onOpened?(opened: Opened): void;
  /** Under the preview. */
  below?: ReactNode;
  /** A column to the right. */
  side?: ReactNode;
}

/**
 * Browsing: the library and the playlists, the preview, previous / next /
 * random. The library view is this alone; the lab's editor puts its graph
 * `below` and its inspector at the `side`.
 */
export function Browse({ view, start, onMode, onOpened, below, side }: BrowseProps) {
  const [current, setCurrent] = useState<Entry | null>(null);
  const { notice: banner, set: setNotice, fail, dismiss } = useNotice();
  const [lists, setLists] = useState<pl.Lists | null>(null);
  const [tab, setTab] = useState(0);
  const [target, setTarget] = useState<string | null>(null);
  const audioFailed = useMemo(() => fail("Couldn't read the audio input."), [fail]);

  const load = useCallback(
    async (e: Entry) => {
      setCurrent(e);
      dismiss();
      try {
        const opened = await api.open(e.path);
        onOpened?.(opened);
      } catch (err) {
        setNotice(notice(`Couldn't open ${e.name}.`, err));
      }
    },
    [dismiss, setNotice, onOpened],
  );
  const { library, loaded, search, setSearch, found } = useLibrary(start, load, fail);
  const shown = found.shown;

  // A playlist is playing: the live action layer steps through it.
  const playing = lists?.deck.playlist ?? null;
  const step = useCallback(
    (by: number) => {
      if (playing) {
        pl.act({ kind: by === 0 ? 'random' : by > 0 ? 'next' : 'previous' }).catch(fail("Couldn't step the playlist."));
        return;
      }
      const next = stepIn(shown.length ? shown : library, current?.path ?? null, by);
      if (next) load(next);
    },
    [playing, shown, library, current, load, fail],
  );

  useEffect(() => {
    pl.lists().then(setLists, fail("Couldn't read the playlists."));
  }, [fail]);
  // Whatever changed the preset live (a playlist step, auto-advance, a controller),
  // the page follows it here.
  useTauriEvent(pl.onLists, setLists);
  useTauriEvent(pl.onLive, (now) => {
    setLists((l) => (l ? { ...l, deck: now.deck } : l));
    if (!now.path) return;
    const path = now.path;
    const known = library.find((e) => e.path === path);
    setCurrent(known ?? { path, name: nameOf(path), group: '' });
    setNotice(now.error ? openFailed(path, now.error) : null);
    if (now.opened) onOpened?.(now.opened);
  });

  // The playlist the library's + adds to: the one picked in the panel, or the one playing.
  const into = lists?.playlists.find((p) => p.id === (target ?? playing)) ?? null;

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e)) return;
      if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key.toLowerCase() === 'r') step(0);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [step]);

  return (
    <div className="app" data-view={view}>
      <Header view={view} onChange={(next) => next !== view && onMode(next, current?.path ?? null)}>
        <div className="wdg wdg-control-group vf-transport" role="group" aria-label="presets">
          <Button onPress={() => step(-1)} label="previous preset" title="previous preset (←)" hint={`previous preset${playing ? ' in the playlist' : ''} (←)`}>
            ◀
          </Button>
          <Button onPress={() => step(1)} label="next preset" title="next preset (→)" hint={`next preset${playing ? ' in the playlist' : ''} (→)`}>
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
      </Header>
      <aside className="library">
        <Segmented className="library-tabs" items={['library', 'playlists']} index={tab} onChange={setTab} label="library or playlists" />
        {tab === 0 ? (
          <Library
            entries={library}
            loaded={loaded}
            search={search}
            onSearch={setSearch}
            found={found}
            current={current?.path ?? null}
            into={into}
            onLoad={load}
            onAdd={(e) => into && pl.add(into.id, e.path).then(setLists, fail(`Couldn't add ${e.name} to ${into.name}.`))}
          />
        ) : (
          lists && (
            <Playlists lists={lists} current={current?.path ?? null} selected={target ?? playing ?? lists.playlists[0]?.id ?? null} onSelect={setTarget} onLists={setLists} onError={setNotice} />
          )
        )}
      </aside>
      <main>
        <div className="bench-row">
          <Preview className="bench" />
        </div>
        {below}
      </main>
      {side}
      <Hints />
    </div>
  );
}
