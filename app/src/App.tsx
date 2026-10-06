import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as api from './api.ts';
import type { Entry, Input, Preset, Problem, Report } from './api.ts';
import { Inspector } from './Inspector.tsx';
import { StageGraph } from './StageGraph.tsx';
import { STAGES } from './stages.ts';

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

export function App() {
  const [library, setLibrary] = useState<Entry[]>([]);
  const [search, setSearch] = useState('');
  const [current, setCurrent] = useState<Entry | null>(null);
  const [preset, setPreset] = useState<Preset | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [selected, setSelected] = useState('frame');
  const [inputs, setInputs] = useState<Input[]>([]);
  const [input, setInput] = useState('');
  const [stats, setStats] = useState<api.Stats>({ fps: 0, cpu_ms: 0 });
  const [error, setError] = useState<string | null>(null);
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

  const step = useCallback(
    (by: number) => {
      const list = shown.length ? shown : library;
      if (!list.length) return;
      const at = current ? list.findIndex((e) => e.path === current.path) : -1;
      const next = by === 0 ? Math.floor(Math.random() * list.length) : (at + by + list.length) % list.length;
      load(list[next]);
    },
    [shown, library, current, load],
  );

  useEffect(() => {
    api.presets().then((l) => {
      setLibrary(l);
      if (l.length) load(l[Math.floor(Math.random() * l.length)]);
    });
    api.inputs().then(setInputs);
    api.listenTo(null).then(setInput, (e) => setError(String(e)));
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

  const edit = (next: Preset) => {
    setPreset(next);
    apply(next);
  };

  const stage = STAGES.find((s) => s.id === selected) ?? STAGES[0];
  const problems = problemsOf(report);

  return (
    <div className="app">
      <header>
        <h1>visual[flow]</h1>
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
        <select
          value={input}
          onChange={(e) => api.listenTo(e.target.value).then(setInput, (err) => setError(String(err)))}
          title="audio input"
        >
          {!inputs.some((i) => i.name === input) && <option value={input}>{input || 'no input'}</option>}
          {inputs.map((i, n) => (
            <option key={`${n}:${i.name}`} value={i.name}>
              {i.name} ({i.channels} ch)
            </option>
          ))}
        </select>
        <span className="stats">
          {stats.fps.toFixed(0)} fps · {stats.cpu_ms.toFixed(2)} ms cpu
        </span>
      </header>
      <aside className="library">
        <input placeholder={`search ${library.length} presets`} value={search} onChange={(e) => setSearch(e.target.value)} />
        <ul>
          {shown.map((e) => (
            <li key={e.path} data-current={current?.path === e.path ? '' : undefined} onClick={() => load(e)}>
              <span>{e.name}</span>
              <i>{e.group}</i>
            </li>
          ))}
        </ul>
      </aside>
      <main>
        <div className="bench-row">
          <div className="bench" ref={bench} />
        </div>
        <div className="graph">
          {preset && <StageGraph preset={preset} problems={problems} selected={selected} onSelect={setSelected} onChange={edit} />}
        </div>
      </main>
      <aside className="side">{preset && <Inspector preset={preset} stage={stage} problems={problems} onChange={edit} />}</aside>
    </div>
  );
}
