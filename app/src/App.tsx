import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as api from './api.ts';
import type { Entry, Owner, Preset, Problem, Report } from './api.ts';
import { AudioInput } from './AudioInput.tsx';
import { Segmented } from '@openflow/widgets/controls/Segmented.tsx';
import { Inspector } from './Inspector.tsx';
import { Playlists } from './Playlists.tsx';
import * as pl from './playlists.ts';
import { StageGraph } from './StageGraph.tsx';
import { setValue as setValueIn } from './stages.ts';
import * as compareApi from './compare/api.ts';
import { FrameRate, Header, Hints, NoticeView, NowPlaying, type View } from './views.tsx';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { Library } from './Library.tsx';
import { searchLibrary } from './librarySearch.ts';
import { noticeOf, type Notice } from './shell.ts';
import { Live } from './Live.tsx';
import * as output from './output.ts';

const problemsOf = (r: Report | null): Problem[] => (r ? [...r.equations, ...r.shaders] : []);

/** Report the bench's hole to the app, which moves the native view under it. */
function useBench(ref: React.RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const send = () => {
      const r = el.getBoundingClientRect();
      api.placeBench({ x: r.left, y: r.top, width: r.width, height: r.height }).catch(() => {});
    };
    const observer = new ResizeObserver(send);
    observer.observe(el);
    observer.observe(document.body);
    window.addEventListener('resize', send);
    send();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', send);
    };
  }, [ref]);
}

/**
 * Apply edits to the bench, newest first: one load at a time, and while one is
 * running only the latest edit waits behind it.
 */
function useApply(onReport: (r: Report) => void) {
  const running = useRef(false);
  const waiting = useRef<Preset | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const run = useCallback(
    async (p: Preset) => {
      if (running.current) {
        waiting.current = p;
        return;
      }
      running.current = true;
      try {
        onReport(await api.apply(p));
      } catch (e) {
        onReport({ equations: [{ stage: 'equations', message: String(e), line: null }], shaders: [] });
      }
      running.current = false;
      const next = waiting.current;
      waiting.current = null;
      if (next) run(next);
    },
    [onReport],
  );
  return useCallback(
    (p: Preset) => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => run(p), 250);
    },
    [run],
  );
}

/**
 * The compare view and Butterchurn behind it, loaded only in the dev build: in
 * `vite build` this is `null` and the import is dropped from the bundle.
 */
const Compare = import.meta.env.DEV ? lazy(() => import('./Compare.tsx').then((m) => ({ default: m.Compare }))) : null;

/**
 * The editor, the compare view (dev builds only: Butterchurn beside the engine,
 * with verdicts), or live mode (performing controls, the output full screen on a
 * display). `VISUALS_COMPARE=1` starts in compare, `VISUALS_LIVE=1` in live
 * mode, `VISUALS_PRESET=<path>` on a preset.
 */
export function App() {
  const [mode, setMode] = useState<{ view: View; preset: string | null } | null>(null);
  useEffect(() => {
    Promise.all([compareApi.start(), output.liveStart()]).then(
      ([s, live]) => setMode({ view: live ? 'live' : s.compare && Compare ? 'compare' : 'editor', preset: s.preset }),
      () => setMode({ view: 'editor', preset: null }),
    );
  }, []);
  if (!mode) return null;
  if (mode.view === 'compare' && Compare) {
    return (
      <Suspense fallback={null}>
        <Compare start={mode.preset} onMode={(view, preset) => setMode({ view, preset })} />
      </Suspense>
    );
  }
  if (mode.view === 'live') return <Live start={mode.preset} onMode={(view, preset) => setMode({ view, preset })} />;
  return <Editor start={mode.preset} onMode={(view, preset) => setMode({ view, preset })} />;
}

function Editor({ start, onMode }: { start: string | null; onMode: (view: 'compare' | 'live', path: string | null) => void }) {
  const [library, setLibrary] = useState<Entry[]>([]);
  const [search, setSearch] = useState('');
  const [current, setCurrent] = useState<Entry | null>(null);
  const [preset, setPreset] = useState<Preset | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  // The stage open in the inspector, by id; null is the graph's own first choice.
  const [selected, setSelected] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [lists, setLists] = useState<pl.Lists | null>(null);
  const [tab, setTab] = useState(0);
  const [target, setTarget] = useState<string | null>(null);
  const bench = useRef<HTMLDivElement>(null);
  useBench(bench);
  const apply = useApply(setReport);
  const fail = useCallback((what: string) => (e: unknown) => setNotice(noticeOf(what, e)), []);

  const found = useMemo(() => searchLibrary(library, search), [library, search]);
  const shown = found.shown;

  const load = useCallback(async (e: Entry) => {
    setCurrent(e);
    setNotice(null);
    try {
      const opened = await api.open(e.path);
      setPreset(opened.preset);
      setReport(opened.report);
    } catch (err) {
      setNotice(noticeOf(`couldn’t open “${e.name}”`, err));
    }
  }, []);

  // A playlist is playing: the live action layer steps through it.
  const playing = lists?.deck.playlist ?? null;
  const step = useCallback(
    (by: number) => {
      if (playing) {
        pl.act({ kind: by === 0 ? 'random' : by > 0 ? 'next' : 'previous' }).catch(fail('couldn’t step the playlist'));
        return;
      }
      const list = shown.length ? shown : library;
      if (!list.length) return;
      const at = current ? list.findIndex((e) => e.path === current.path) : -1;
      const next = by === 0 ? Math.floor(Math.random() * list.length) : (at + by + list.length) % list.length;
      load(list[next]);
    },
    [playing, shown, library, current, load, fail],
  );

  // Whatever changed the preset live (a playlist step, auto-advance, a controller),
  // the page follows it here.
  const libraryRef = useRef(library);
  libraryRef.current = library;
  useEffect(() => {
    pl.lists().then(setLists, fail('couldn’t read the playlists'));
    const off = pl.onLive((now) => {
      setLists((l) => (l ? { ...l, deck: now.deck } : l));
      if (!now.path) return;
      const path = now.path;
      const known = libraryRef.current.find((e) => e.path === path);
      const name = path.split('/').pop()?.replace(/\.milk$/i, '') ?? path;
      setCurrent(known ?? { path, name, group: '' });
      setNotice(now.error ? noticeOf(`couldn’t open “${known?.name ?? name}”`, now.error) : null);
      if (now.opened) {
        setPreset(now.opened.preset);
        setReport(now.opened.report);
      }
    });
    return () => {
      off.then((f) => f());
    };
  }, [fail]);

  // The playlist the library's + adds to: the one picked in the panel, or the one playing.
  const into = lists?.playlists.find((p) => p.id === (target ?? playing)) ?? null;

  useEffect(() => {
    api.presets().then(
      (l) => {
        setLibrary(l);
        setLoaded(true);
        const first = start ? (l.find((e) => e.path === start) ?? { path: start, name: start.split('/').pop()!.replace(/\.milk$/i, ''), group: '' }) : null;
        if (first) load(first);
        else if (l.length) load(l[Math.floor(Math.random() * l.length)]);
      },
      (e) => {
        setLoaded(true);
        fail('couldn’t read the preset folder')(e);
      },
    );
  }, [load, fail]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement).closest('input, textarea, select, [role="combobox"]')) return;
      if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key.toLowerCase() === 'r') step(0);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [step]);

  // The preset as of the latest edit, for edits that land between renders.
  const latest = useRef<Preset | null>(null);
  latest.current = preset;

  const edit = (next: Preset) => {
    latest.current = next;
    setPreset(next);
    apply(next);
  };

  // Settings go to the bench live, at most once a display frame per setting.
  const pending = useRef(new Map<string, { owner: Owner; key: string; value: number }>());
  const flushing = useRef(0);
  const set = useCallback(
    (owner: Owner, key: string, value: number) => {
      if (!latest.current) return;
      const [next, written] = setValueIn(latest.current, owner, key, value);
      latest.current = next;
      setPreset(next);
      pending.current.set(`${JSON.stringify(owner)}:${written}`, { owner, key: written, value });
      if (flushing.current) return;
      flushing.current = requestAnimationFrame(() => {
        flushing.current = 0;
        const changes = [...pending.current.values()];
        pending.current.clear();
        for (const c of changes) {
          api.setValue(c.owner, c.key, c.value).then((live) => {
            if (!live && latest.current) apply(latest.current);
          });
        }
      });
    },
    [apply],
  );

  const problems = problemsOf(report);

  return (
    <div className="app">
      <Header view="editor" onChange={(view) => view !== 'editor' && onMode(view, current?.path ?? null)}>
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
        <NoticeView notice={notice} onDismiss={() => setNotice(null)} />
        <span className="vf-fill" />
        <AudioInput onError={fail('couldn’t read the audio input')} />
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
            onAdd={(e) => into && pl.add(into.id, e.path).then(setLists, fail(`couldn’t add “${e.name}” to ${into.name}`))}
          />
        ) : (
          lists && (
            <Playlists
              lists={lists}
              current={current?.path ?? null}
              selected={target ?? playing ?? lists.playlists[0]?.id ?? null}
              onSelect={setTarget}
              onLists={setLists}
              onError={fail('the playlist change didn’t go through')}
            />
          )
        )}
      </aside>
      <main>
        <div className="bench-row">
          <div className="bench" ref={bench} />
        </div>
        <div className="graph">
          {preset && <StageGraph preset={preset} problems={problems} selected={selected} onSelect={setSelected} onChange={edit} onSet={set} />}
        </div>
      </main>
      <aside className="side">{preset && <Inspector preset={preset} selected={selected} problems={problems} onChange={edit} onSet={set} />}</aside>
      <Hints />
    </div>
  );
}
