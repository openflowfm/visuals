import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AudioLevels } from 'butterchurn';
import { Segmented } from '@openflow/widgets/controls/Segmented.tsx';
import * as app from './api.ts';
import type { Report } from './api.ts';
import { AudioInput } from './AudioInput.tsx';
import * as api from './compare/api.ts';
import type { Approval, Listed, Verdict } from './compare/api.ts';
import { createReference, type Reference } from './compare/butterchurn.ts';
import { convert, stopConverting } from './compare/convert.ts';
import { filter, SHOWS, step, windowAround, type Show } from './compare/list.ts';
import * as pl from './playlists.ts';
import './compare.css';

/** What Butterchurn's side is doing. */
type Theirs =
  | { state: 'starting' }
  | { state: 'converting' }
  | { state: 'drawing'; broken: string[] }
  | { state: 'failed'; why: string };

/** Which picture is shown when one is shown full size. */
type Flip = null | 'theirs' | 'ours';

const ROWS = 400;

const mark = (a: Approval | undefined) => (a?.verdict === 'approve' ? '✓' : a?.verdict === 'reject' ? '✗' : a?.note ? '•' : '');

const describe = (r: Report | null) =>
  r ? [...r.equations.map((p) => `${p.stage}: ${p.message}`), ...r.shaders.map((p) => `${p.stage} shader fell back to the default: ${p.message}`)] : [];

/**
 * Butterchurn and the engine side by side, on one preset and the live input, with
 * a verdict per preset. Butterchurn draws on a canvas in the page; ours is the
 * native bench, moved under a hole where its picture goes.
 */
export function Compare({ start, onMode }: { start: string | null; onMode: (view: 'editor' | 'live', path: string | null) => void }) {
  const [presets, setPresets] = useState<Listed[]>([]);
  const [approvals, setApprovals] = useState<Record<string, Approval>>({});
  const [file, setFile] = useState('');
  const [search, setSearch] = useState('');
  const [show, setShow] = useState<Show>('all');
  const [current, setCurrent] = useState<Listed | null>(null);
  const [theirs, setTheirs] = useState<Theirs>({ state: 'starting' });
  /** Why Butterchurn itself could not start; outlasts every preset's state. */
  const [dead, setDead] = useState<string | null>(null);
  const [ours, setOurs] = useState<Report | null>(null);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [swap, setSwap] = useState(false);
  const [flip, setFlip] = useState<Flip>(null);
  const [fps, setFps] = useState({ theirs: 0, ours: 0 });

  const canvas = useRef<HTMLCanvasElement>(null);
  const hole = useRef<HTMLDivElement>(null);
  const noteBox = useRef<HTMLTextAreaElement>(null);
  const reference = useRef<Promise<Reference> | null>(null);
  const loads = useRef(0);
  const currentRef = useRef<Listed | null>(null);
  currentRef.current = current;

  // Ours: the native bench under the hole, wherever the hole is.
  useLayoutEffect(() => {
    const el = hole.current;
    if (!el) return;
    const send = () => {
      const r = el.getBoundingClientRect();
      app.placeBench({ x: r.left, y: r.top, width: r.width, height: r.height }).catch(() => {});
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
  }, [swap, flip]);

  // Theirs: Butterchurn, loaded now and not with the page, drawn every frame to
  // the bytes the bench heard.
  useEffect(() => {
    const el = canvas.current!;
    let stopped = false;
    let frame = 0;
    const made = createReference(el, () => stopped);
    reference.current = made;
    made.catch((e) => !stopped && setDead(`Butterchurn did not start: ${(e as Error)?.message ?? e}`));
    const levels: AudioLevels = { timeByteArray: new Uint8Array(1024), timeByteArrayL: new Uint8Array(1024), timeByteArrayR: new Uint8Array(1024) };
    let rate = 0;
    let asking = false;
    let last = performance.now();
    let counted = { frames: 0, since: last };
    const tick = (now: number) => {
      if (stopped) return;
      frame = requestAnimationFrame(tick);
      if (!asking) {
        asking = true;
        api
          .audio()
          .then((buffer) => {
            const bytes = new Uint8Array(buffer);
            rate = new DataView(buffer).getFloat32(0, true);
            levels.timeByteArray.set(bytes.subarray(4, 1028));
            levels.timeByteArrayL.set(bytes.subarray(1028, 2052));
            levels.timeByteArrayR.set(bytes.subarray(2052, 3076));
          })
          .catch(() => {})
          .finally(() => (asking = false));
      }
      const dt = Math.min(0.25, Math.max(0.001, (now - last) / 1000));
      last = now;
      made.then((r) => {
        if (stopped) return;
        const why = r.render(levels, dt, rate);
        if (why) setTheirs({ state: 'failed', why: `an equation threw: ${why}` });
      }, () => {});
      counted.frames++;
      if (now - counted.since >= 1000) {
        const theirsFps = (counted.frames * 1000) / (now - counted.since);
        counted = { frames: 0, since: now };
        app.stats().then((s) => setFps({ theirs: theirsFps, ours: s.fps }), () => {});
      }
    };
    frame = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      made.then((r) => r.free(), () => {});
      stopConverting();
    };
  }, []);

  /** Put `e` on both sides: converted first, then both loaded in the same moment. */
  const pick = useCallback(async (e: Listed, openOurs = true) => {
    const token = ++loads.current;
    setCurrent(e);
    setError(null);
    setTheirs({ state: 'converting' });
    const converted = await convert(e.path).catch((err) => ({ ok: false as const, reason: String(err) }));
    if (token !== loads.current) return;
    const ref = await reference.current?.catch(() => null);
    if (token !== loads.current) return;
    if (openOurs) {
      api.open(e.path).then(
        (o) => token === loads.current && setOurs(o.report),
        (err) => token === loads.current && setError(String(err)),
      );
    }
    if (!ref) return;
    if (!converted.ok) {
      ref.blank();
      setTheirs({ state: 'failed', why: `the converter failed: ${converted.reason}` });
      return;
    }
    try {
      setTheirs({ state: 'drawing', broken: ref.load(converted.json) });
    } catch (err) {
      ref.blank();
      setTheirs({ state: 'failed', why: `Butterchurn would not load it: ${(err as Error).message}` });
    }
  }, []);

  // The list, the verdicts, the input, and where to start.
  useEffect(() => {
    let cancelled = false;
    Promise.all([api.presets(), api.approvals(), pl.lists().catch(() => null)]).then(
      ([list, book, lists]) => {
        if (cancelled) return;
        setPresets(list);
        setApprovals(book.items);
        setFile(book.file);
        const want = start ?? lists?.deck.current ?? null;
        const found = want ? list.find((p) => p.path === want) : undefined;
        const first = found ?? (want ? { path: want, name: want.split('/').pop()!.replace(/\.milk$/i, ''), group: '', id: want } : list[0]);
        if (first) pick(first);
      },
      (e) => setError(String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [start, pick]);

  // Whatever else changes the bench (auto-advance, a controller), Butterchurn follows.
  const presetsRef = useRef(presets);
  presetsRef.current = presets;
  useEffect(() => {
    const off = pl.onLive((now) => {
      if (!now.path || now.path === currentRef.current?.path) return;
      const path = now.path;
      const known = presetsRef.current.find((p) => p.path === path);
      if (now.opened) setOurs(now.opened.report);
      pick(known ?? { path, name: path.split('/').pop()!.replace(/\.milk$/i, ''), group: '', id: path }, false);
    });
    return () => {
      off.then((f) => f());
    };
  }, [pick]);

  const verdict = current ? approvals[current.id] : undefined;
  useEffect(() => {
    setNote(verdict?.note ?? '');
    setStatus('');
  }, [current?.id, verdict?.note]);

  const save = useCallback(
    async (v: Verdict | null, text: string) => {
      if (!current) return;
      setStatus('…');
      try {
        const kept = await api.judge(current.id, v, text);
        setApprovals((all) => {
          const next = { ...all };
          if (kept) next[current.id] = kept;
          else delete next[current.id];
          return next;
        });
        setStatus('saved');
      } catch (e) {
        setStatus(`not saved: ${e}`);
      }
    },
    [current],
  );
  const toggle = useCallback((v: Verdict) => save(verdict?.verdict === v ? null : v, note), [save, verdict, note]);
  const saveNote = () => {
    if (note.trim() !== (verdict?.note ?? '')) save(verdict?.verdict ?? null, note);
  };

  const shown = useMemo(() => filter(presets, approvals, search, show), [presets, approvals, search, show]);
  const at = current ? shown.findIndex((p) => p.path === current.path) : -1;
  const [from, to] = windowAround(shown.length, at, ROWS);

  const move = useCallback(
    (by: number) => {
      const next = by === 0 ? shown[Math.floor(Math.random() * shown.length)] : step(shown, current?.path ?? null, by);
      if (next) pick(next);
    },
    [shown, current, pick],
  );

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement).closest('input, textarea, select')) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const actions: Record<string, () => void> = {
        ArrowDown: () => move(1),
        ArrowUp: () => move(-1),
        r: () => move(0),
        a: () => toggle('approve'),
        x: () => toggle('reject'),
        n: () => noteBox.current?.focus(),
        s: () => setSwap((s) => !s),
        f: () => setFlip((f) => (f ? null : 'theirs')),
        ' ': () => setFlip((f) => (f === 'theirs' ? 'ours' : f === 'ours' ? 'theirs' : f)),
      };
      const run = actions[k];
      if (!run) return;
      e.preventDefault();
      run();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [move, toggle]);

  useEffect(() => {
    document.querySelector('.compare-list li[data-current]')?.scrollIntoView({ block: 'nearest' });
  }, [current?.path, from]);

  const oursProblems = describe(ours);
  const theirsLabel = dead ??
    (theirs.state === 'starting'
      ? 'starting Butterchurn…'
      : theirs.state === 'converting'
        ? 'converting…'
        : theirs.state === 'failed'
          ? theirs.why
          : theirs.broken.length
            ? `${theirs.broken.join(' and ')} shader would not link: Butterchurn draws black`
            : null);
  const theirsBad = !!dead || theirs.state === 'failed' || (theirs.state === 'drawing' && theirs.broken.length > 0);

  return (
    <div className="compare">
      <header>
        <h1>visual[flow]</h1>
        <Segmented
          items={['editor', 'compare', 'live']}
          index={1}
          onChange={(i) => i !== 1 && onMode(i === 0 ? 'editor' : 'live', current?.path ?? null)}
          label="editor, compare or live"
        />
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
          Butterchurn {fps.theirs.toFixed(0)} fps · ours {fps.ours.toFixed(0)} fps
        </span>
      </header>
      <aside className="compare-list">
        <input placeholder={`search ${presets.length} presets`} value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="compare-show">
          <select value={show} onChange={(e) => setShow(e.target.value as Show)} title="show presets by verdict">
            {SHOWS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <span className="quiet">
            {at >= 0 ? `${at + 1} of ` : ''}
            {shown.length}
          </span>
        </div>
        <ul>
          {shown.slice(from, to).map((p) => {
            const a = approvals[p.id];
            return (
              <li key={p.path} data-current={current?.path === p.path ? '' : undefined} data-verdict={a?.verdict ?? undefined} onClick={() => pick(p)} title={a?.note || undefined}>
                <span className="compare-mark">{mark(a)}</span>
                <span className="compare-entry">
                  <span>{p.name}</span>
                  <i>{p.group}</i>
                </span>
              </li>
            );
          })}
        </ul>
      </aside>
      <main className="compare-main">
        <div className="compare-captions" data-swap={swap ? '' : undefined} data-flip={flip ?? undefined}>
          <div className="compare-caption" data-side="ours">
            <b>ours</b> <span className="quiet">the engine, on Metal</span>
            {oursProblems.map((p) => (
              <span key={p} className="problem">
                {' '}
                · {p}
              </span>
            ))}
          </div>
          <div className="compare-caption" data-side="theirs">
            <b>Butterchurn 2.6.7</b> <span className="quiet">the reference, WebGL</span>
          </div>
        </div>
        <div className="compare-feeds" data-swap={swap ? '' : undefined} data-flip={flip ?? undefined}>
          {/* Ours first in the page: its shadow is what paints round the hole, and
              Butterchurn's canvas has to paint after it. The row is reversed. */}
          <div className="compare-feed compare-hole" data-side="ours" ref={hole} />
          <div className="compare-feed" data-side="theirs">
            <canvas ref={canvas} />
            {theirsLabel && <div className="compare-label" data-bad={theirsBad ? '' : undefined}>{theirsLabel}</div>}
          </div>
        </div>
        <div className="compare-verdict">
          <button className="approve" data-on={verdict?.verdict === 'approve' ? '' : undefined} onClick={() => toggle('approve')} title="approve (A)">
            approve <kbd>A</kbd>
          </button>
          <button className="reject" data-on={verdict?.verdict === 'reject' ? '' : undefined} onClick={() => toggle('reject')} title="reject (X)">
            reject <kbd>X</kbd>
          </button>
          <textarea
            ref={noteBox}
            placeholder="note (N to write, Esc to leave; saved when you leave it)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={saveNote}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur();
            }}
          />
          <div className="compare-status">
            <span>
              {verdict?.verdict ? <b data-verdict={verdict.verdict}>{verdict.verdict === 'approve' ? 'approved' : 'rejected'}</b> : 'not judged'}
              {verdict?.score != null && <span className="quiet"> · recorded score {verdict.score.toFixed(1)}</span>}
              {verdict?.at && <span className="quiet"> · {new Date(verdict.at).toLocaleString()}</span>}
              {status && <span className="quiet"> · {status}</span>}
            </span>
            <span className="quiet">
              ↑↓ preset · R random · S swap sides · F one full size, Space the other · saved to {file}
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}
