import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Segmented } from '@openflow/widgets/controls/Segmented.tsx';
import * as api from './api.ts';
import { AudioInput } from './AudioInput.tsx';
import * as output from './output.ts';
import { Playlists } from './Playlists.tsx';
import * as pl from './playlists.ts';
import './live.css';

const nameOf = (path: string) => path.split('/').pop()?.replace(/\.milk$/i, '') ?? path;

/** The bench's small preview: report its hole to the app, as the editor does. */
function usePreview(ref: React.RefObject<HTMLDivElement | null>) {
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
 * Live mode: performing, not editing. The output fills a display of its own
 * while this is shown, and closes when it isn't; the editor isn't rendered and
 * the engine reads back no stage pictures. What's left is what a show needs:
 * what's playing and what's next, previous / next / random (through the live
 * action layer, as a controller would), the playlists, the audio input, and
 * where the output goes.
 *
 * Esc does nothing here, so a stray key never stops the show: leaving is the
 * switch above, or ⌘⇧L.
 */
export function Live({ start, onMode }: { start: string | null; onMode: (mode: 'editor' | 'compare', path: string | null) => void }) {
  const [lists, setLists] = useState<pl.Lists | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [displays, setDisplays] = useState<output.Display[]>([]);
  const [status, setStatus] = useState<output.Status>({ display: null, size: null });
  const [stats, setStats] = useState<api.Stats>({ fps: 0, cpu_ms: 0 });
  const preview = useRef<HTMLDivElement>(null);
  usePreview(preview);

  // Live mode is the output: open it on the way in, close it on the way out.
  useEffect(() => {
    api.setPreviews(false).catch(() => {});
    output.open(null).then(setStatus, (e) => setError(String(e)));
    const off = output.onStatus(setStatus);
    return () => {
      off.then((f) => f());
      output.close().catch(() => {});
    };
  }, []);

  const refreshDisplays = useCallback(() => output.displays().then(setDisplays, () => {}), []);
  useEffect(() => {
    refreshDisplays();
    // A display plugged in or out shows up in the list next time it is looked at.
    window.addEventListener('focus', refreshDisplays);
    return () => window.removeEventListener('focus', refreshDisplays);
  }, [refreshDisplays, status.display?.id]);

  useEffect(() => {
    pl.lists().then((l) => {
      setLists(l);
      setCurrent((c) => c ?? l.deck.current ?? start);
      // Started in live mode, nothing is playing yet: the preset asked for, or any.
      if (l.deck.current) return;
      if (start) api.open(start).catch((e) => setError(String(e)));
      else pl.act({ kind: 'random' }).catch((e) => setError(String(e)));
    }, (e) => setError(String(e)));
    const off = pl.onLive((now) => {
      setLists((l) => (l ? { ...l, deck: now.deck } : l));
      if (now.path) setCurrent(now.path);
      setError(now.error);
    });
    const t = window.setInterval(() => api.stats().then(setStats, () => {}), 1000);
    return () => {
      off.then((f) => f());
      window.clearInterval(t);
    };
  }, []);

  const act = useCallback((action: pl.Action) => pl.act(action).catch((e) => setError(String(e))), []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        onMode('editor', current);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') act({ kind: 'next' });
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') act({ kind: 'previous' });
      else if (e.key.toLowerCase() === 'r') act({ kind: 'random' });
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [act, onMode, current]);

  const deck = lists?.deck ?? null;
  const playing = deck?.playlist ? (lists?.playlists.find((p) => p.id === deck.playlist) ?? null) : null;
  const next = playing && playing.items.length ? playing.items[((deck?.index ?? -1) + 1) % playing.items.length] : null;
  const shown = status.display;
  const chosen = shown?.id ?? displays.find((d) => !d.main)?.id ?? displays[0]?.id ?? null;

  return (
    <div className="live">
      <header>
        <h1>visual[flow]</h1>
        <Segmented
          items={['editor', 'compare', 'live']}
          index={2}
          onChange={(i) => i < 2 && onMode(i === 0 ? 'editor' : 'compare', current)}
          label="editor, compare or live"
        />
        <span className="fill" />
        <AudioInput onError={setError} />
        <span className="stats">
          {stats.fps.toFixed(0)} fps · {stats.cpu_ms.toFixed(2)} ms cpu
        </span>
      </header>
      <section className="live-stage">
        <div className="live-preview-cell">
          <div className="live-preview" ref={preview} />
        </div>
        <div className="live-deck">
          <div className="live-now">
            <i>now</i>
            <b>{current ? nameOf(current) : 'nothing yet'}</b>
          </div>
          <div className="live-next">
            <i>{playing ? `next in ${playing.name}` : 'next'}</i>
            <span>{next ? next.name : playing ? '—' : 'the next in the library'}</span>
            {playing && deck?.index != null && (
              <span className="quiet">
                {deck.index + 1} / {playing.items.length}
                {deck.auto ? ` · every ${Math.round(deck.seconds)} s` : ''}
              </span>
            )}
          </div>
          <div className="live-transport">
            <button onClick={() => act({ kind: 'previous' })} title="previous (← or ↑)">◀ previous</button>
            <button onClick={() => act({ kind: 'random' })} title="random (R)">random</button>
            <button onClick={() => act({ kind: 'next' })} title="next (→ or ↓)">next ▶</button>
          </div>
          {error && <p className="problem">{error}</p>}
          <p className="quiet live-keys">← → ↑ ↓ step · R random · Esc does nothing · ⌘⇧L or the switch leaves live mode and closes the output</p>
        </div>
        <div className="live-output">
          <h2>output</h2>
          <label>
            <span>display</span>
            <select
              value={chosen ?? ''}
              onChange={(e) => output.open(Number(e.target.value)).then(setStatus, (err) => setError(String(err)))}
              onFocus={refreshDisplays}
            >
              {displays.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.index + 1}. {d.name} ({d.width}×{d.height}){d.main ? ' · menu bar' : ''}
                </option>
              ))}
            </select>
          </label>
          {shown ? (
            <p className="live-status" data-on="">
              showing on {shown.name}
              {status.size && ` · picture ${status.size[0]}×${status.size[1]}`}
              {shown.main && <span className="quiet"> · covers the display with the menu bar</span>}
            </p>
          ) : (
            <p className="live-status">
              not showing{' '}
              <button onClick={() => output.open(null).then(setStatus, (e) => setError(String(e)))}>show again</button>
            </p>
          )}
        </div>
      </section>
      <aside className="live-lists">
        {lists && (
          <Playlists
            lists={lists}
            current={current}
            selected={selected ?? deck?.playlist ?? lists.playlists[0]?.id ?? null}
            onSelect={setSelected}
            onLists={setLists}
            onError={setError}
          />
        )}
      </aside>
    </div>
  );
}
