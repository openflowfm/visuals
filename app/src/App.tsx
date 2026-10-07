import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as api from './api.ts';
import type { Entry, Owner, Preset, Problem, Report } from './api.ts';
import { AudioInput } from './AudioInput.tsx';
import { Segmented } from '@openflow/widgets/controls/Segmented.tsx';
import { Inspector } from './Inspector.tsx';
import { Playlists } from './Playlists.tsx';
import * as pl from './playlists.ts';
import { StageGraph } from './StageGraph.tsx';
import { STAGES, setValue as setValueIn } from './stages.ts';
import { Compare } from './Compare.tsx';
import * as compareApi from './compare/api.ts';
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

type View = 'editor' | 'compare' | 'live';

/**
 * The editor, the compare view (Butterchurn beside the engine, with verdicts),
 * or live mode (performing controls, the output full screen on a display).
 * `VISUALS_COMPARE=1` starts in compare, `VISUALS_LIVE=1` in live mode,
 * `VISUALS_PRESET=<path>` on a preset.
 */
export function App() {
  const [mode, setMode] = useState<{ view: View; preset: string | null } | null>(null);
  useEffect(() => {
    Promise.all([compareApi.start(), output.liveStart()]).then(
      ([s, live]) => setMode({ view: live ? 'live' : s.compare ? 'compare' : 'editor', preset: s.preset }),
      () => setMode({ view: 'editor', preset: null }),
    );
  }, []);
  if (!mode) return null;
  if (mode.view === 'compare') return <Compare start={mode.preset} onMode={(view, preset) => setMode({ view, preset })} />;
  if (mode.view === 'live') return <Live start={mode.preset} onMode={(view, preset) => setMode({ view, preset })} />;
  return <Editor start={mode.preset} onMode={(view, preset) => setMode({ view, preset })} />;
}

function Editor({ start, onMode }: { start: string | null; onMode: (view: 'compare' | 'live', path: string | null) => void }) {
  const [library, setLibrary] = useState<Entry[]>([]);
  const [search, setSearch] = useState('');
  const [current, setCurrent] = useState<Entry | null>(null);
  const [preset, setPreset] = useState<Preset | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [selected, setSelected] = useState('frame');
  const [stats, setStats] = useState<api.Stats>({ fps: 0, cpu_ms: 0 });
  const [error, setError] = useState<string | null>(null);
  const [lists, setLists] = useState<pl.Lists | null>(null);
  const [tab, setTab] = useState(0);
  const [target, setTarget] = useState<string | null>(null);
  const bench = useRef<HTMLDivElement>(null);
  useBench(bench);
  const apply = useApply(setReport);

  const shown = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = words.length ? library.filter((e) => words.every((w) => `${e.group} ${e.name}`.toLowerCase().includes(w))) : library;
    return hits.slice(0, 400);
  }, [library, search]);

  const load = useCallback(async (e: Entry) => {
    setCurrent(e);
    setError(null);
    try {
      const opened = await api.open(e.path);
      setPreset(opened.preset);
      setReport(opened.report);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  // A playlist is playing: the live action layer steps through it.
  const playing = lists?.deck.playlist ?? null;
  const step = useCallback(
    (by: number) => {
      if (playing) {
        pl.act({ kind: by === 0 ? 'random' : by > 0 ? 'next' : 'previous' }).catch((e) => setError(String(e)));
        return;
      }
      const list = shown.length ? shown : library;
      if (!list.length) return;
      const at = current ? list.findIndex((e) => e.path === current.path) : -1;
      const next = by === 0 ? Math.floor(Math.random() * list.length) : (at + by + list.length) % list.length;
      load(list[next]);
    },
    [playing, shown, library, current, load],
  );

  // Whatever changed the preset live (a playlist step, auto-advance, a controller),
  // the page follows it here.
  const libraryRef = useRef(library);
  libraryRef.current = library;
  useEffect(() => {
    pl.lists().then(setLists, (e) => setError(String(e)));
    const off = pl.onLive((now) => {
      setLists((l) => (l ? { ...l, deck: now.deck } : l));
      if (!now.path) return;
      const path = now.path;
      const known = libraryRef.current.find((e) => e.path === path);
      const name = path.split('/').pop()?.replace(/\.milk$/i, '') ?? path;
      setCurrent(known ?? { path, name, group: '' });
      setError(now.error);
      if (now.opened) {
        setPreset(now.opened.preset);
        setReport(now.opened.report);
      }
    });
    return () => {
      off.then((f) => f());
    };
  }, []);

  // The playlist the library's + adds to: the one picked in the panel, or the one playing.
  const into = lists?.playlists.find((p) => p.id === (target ?? playing)) ?? null;

  useEffect(() => {
    api.presets().then((l) => {
      setLibrary(l);
      const first = start ? (l.find((e) => e.path === start) ?? { path: start, name: start.split('/').pop()!.replace(/\.milk$/i, ''), group: '' }) : null;
      if (first) load(first);
      else if (l.length) load(l[Math.floor(Math.random() * l.length)]);
    });
    const t = window.setInterval(() => api.stats().then(setStats), 1000);
    return () => window.clearInterval(t);
  }, [load]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
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

  const stage = STAGES.find((s) => s.id === selected) ?? STAGES[0];
  const problems = problemsOf(report);

  return (
    <div className="app">
      <header>
        <h1>visual[flow]</h1>
        <Segmented
          items={['editor', 'compare', 'live']}
          index={0}
          onChange={(i) => i > 0 && onMode(i === 1 ? 'compare' : 'live', current?.path ?? null)}
          label="editor, compare or live"
        />
        <button onClick={() => step(-1)} title="previous (←)">◀</button>
        <button onClick={() => step(1)} title="next (→)">▶</button>
        <button onClick={() => step(0)} title="random (R)">random</button>
        <span className="name">
          {current ? (
            <>
              <i>{current.group}</i> {current.name}
            </>
          ) : (
            'no preset'
          )}
        </span>
        {error && <span className="problem">{error}</span>}
        <span className="fill" />
        <AudioInput onError={setError} />
        <span className="stats">
          {stats.fps.toFixed(0)} fps · {stats.cpu_ms.toFixed(2)} ms cpu
        </span>
      </header>
      <aside className="library">
        <Segmented className="library-tabs" items={['library', 'playlists']} index={tab} onChange={setTab} label="library or playlists" />
        {tab === 0 ? (
          <>
            <input placeholder={`search ${library.length} presets`} value={search} onChange={(e) => setSearch(e.target.value)} />
            <ul>
              {shown.map((e) => (
                <li key={e.path} data-current={current?.path === e.path ? '' : undefined} onClick={() => load(e)}>
                  <span>{e.name}</span>
                  <i>{e.group}</i>
                  {into && (
                    <button
                      className="library-add"
                      title={`add to ${into.name}`}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        pl.add(into.id, e.path).then(setLists, (err) => setError(String(err)));
                      }}
                    >
                      +
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        ) : (
          lists && (
            <Playlists
              lists={lists}
              current={current?.path ?? null}
              selected={target ?? playing ?? lists.playlists[0]?.id ?? null}
              onSelect={setTarget}
              onLists={setLists}
              onError={setError}
            />
          )
        )}
      </aside>
      <main>
        <div className="bench-row">
          <div className="bench" ref={bench} />
        </div>
        <div className="graph">
          {preset && <StageGraph preset={preset} problems={problems} selected={selected} onSelect={setSelected} onSet={set} />}
        </div>
      </main>
      <aside className="side">{preset && <Inspector preset={preset} stage={stage} problems={problems} onChange={edit} onSet={set} />}</aside>
    </div>
  );
}
