import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { HintFooter } from '@openflow/widgets/chrome/HintFooter.tsx';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { Select } from '@openflow/widgets/controls/Select.tsx';
import * as api from './api.ts';
import { AudioInput } from './AudioInput.tsx';
import * as output from './output.ts';
import { Playlists } from './Playlists.tsx';
import * as pl from './playlists.ts';
import { openFailed, problem, type Problem } from './problems.ts';
import { Header } from './views.tsx';
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

const displayName = (d: output.Display) => `${d.index + 1}. ${d.name} (${d.width}×${d.height})${d.main ? ' · menu bar' : ''}`;

/** What the keys do, said by the strip along the bottom when nothing is pointed at. */
const KEYS = '← → step  ·  R random  ·  ⌘⇧L back to the editor (closes the output)';

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
  const [error, setError] = useState<Problem | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [displays, setDisplays] = useState<output.Display[]>([]);
  const [status, setStatus] = useState<output.Status>({ display: null, size: null });
  const [stats, setStats] = useState<api.Stats>({ fps: 0, cpu_ms: 0 });
  const preview = useRef<HTMLDivElement>(null);
  usePreview(preview);

  const fail = useCallback((what: string) => (e: unknown) => setError(problem(what, e)), []);
  const show = useCallback(
    (id: number | null) => output.open(id).then(setStatus, fail("Couldn't show the output on that display.")),
    [fail],
  );

  // Live mode is the output: open it on the way in, close it on the way out.
  useEffect(() => {
    api.setPreviews(false).catch(() => {});
    show(null);
    const off = output.onStatus(setStatus);
    return () => {
      off.then((f) => f());
      output.close().catch(() => {});
    };
  }, [show]);

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
      if (start) api.open(start).catch((e) => setError(openFailed(start, String(e))));
      else pl.act({ kind: 'random' }).catch(fail("Couldn't pick a preset to start on."));
    }, fail("Couldn't read the playlists."));
    const off = pl.onLive((now) => {
      setLists((l) => (l ? { ...l, deck: now.deck } : l));
      if (now.path) setCurrent(now.path);
      // A preset that opened clears a failure to open the last one.
      if (now.error) setError(openFailed(now.path, now.error));
      else if (now.path) setError(null);
    });
    const t = window.setInterval(() => api.stats().then(setStats, () => {}), 1000);
    return () => {
      off.then((f) => f());
      window.clearInterval(t);
    };
  }, [fail, start]);

  const act = useCallback((action: pl.Action) => pl.act(action).catch(fail(`Couldn't ${action.kind === 'random' ? 'pick a random preset' : `go to the ${action.kind} preset`}.`)), [fail]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        onMode('editor', current);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement).closest('input, textarea, select, [role="combobox"]')) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') act({ kind: 'next' });
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') act({ kind: 'previous' });
      else if (e.key.toLowerCase() === 'r') act({ kind: 'random' });
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [act, onMode, current]);

  const up = pl.upNext(lists);
  const deck = lists?.deck ?? null;
  const shown = status.display;
  const chosen = shown?.id ?? displays.find((d) => !d.main)?.id ?? displays[0]?.id ?? null;
  const pick = displays.findIndex((d) => d.id === chosen);
  // Only the display with the menu bar: the output covers this window too.
  const alone = displays.length === 1 && displays[0].main;

  return (
    <div className="live">
      <Header view="live" onChange={(view) => view !== 'live' && onMode(view, current)}>
        <span className="fill" />
        <AudioInput onError={(m) => setError(problem("Couldn't use that audio input.", m))} />
        <span className="stats" title="Frames drawn each second, and the time the engine spends on each">
          {stats.fps.toFixed(0)} fps · {stats.cpu_ms.toFixed(2)} ms cpu
        </span>
      </Header>
      <section className="live-stage">
        <div className="live-deck">
          <div className="live-now" title={current ?? undefined}>
            <i>now</i>
            {current ? (
              <b>{nameOf(current)}</b>
            ) : (
              <b className="live-none">Nothing playing — press R for a random preset, or play a playlist.</b>
            )}
          </div>
          <div className="live-next">
            <i>next</i>
            {up ? (
              up.next ? (
                <span data-missing={up.next.missing ? '' : undefined} title={up.next.missing ? `Not in the library any more: ${up.next.path}` : up.next.path}>
                  {up.next.name}
                  {up.next.missing && <em> — missing from the library, it won't open</em>}
                </span>
              ) : (
                <span className="live-none">{up.playlist.name} is empty — add presets with + current.</span>
              )
            ) : (
              <span className="live-none">the next preset in the library</span>
            )}
          </div>
          <p className="live-where">
            {up ? (
              <>
                from <b>{up.playlist.name}</b>
                {up.index !== null && ` · ${up.index + 1} of ${up.playlist.items.length}`}
              </>
            ) : (
              'from the whole library — play a playlist to set the order'
            )}
            {deck?.auto ? ` · moves on every ${Math.round(deck.seconds)} s` : ' · auto-advance off'}
          </p>
        </div>
        <div className="live-transport">
          <Button onPress={() => act({ kind: 'previous' })} label="Previous preset" title="Previous preset (← or ↑)">
            ◀ previous
          </Button>
          <Button onPress={() => act({ kind: 'random' })} label="Random preset" title={up ? `A random preset from ${up.playlist.name} (R)` : 'A random preset from the library (R)'}>
            random
          </Button>
          <Button onPress={() => act({ kind: 'next' })} label="Next preset" title="Next preset (→ or ↓)">
            next ▶
          </Button>
        </div>
        {error && (
          <div className="live-problem" role="alert" title={error.detail ?? undefined}>
            <span>{error.text}</span>
            <Button tone="quiet" onPress={() => setError(null)} label="Dismiss" title="Dismiss">
              ✕
            </Button>
          </div>
        )}
        <div className="live-preview-cell">
          <div className="live-preview" ref={preview} />
        </div>
      </section>
      <aside className="live-side">
        <div className="live-output">
          <h2>Output</h2>
          {shown ? (
            <p className="live-status" data-on="" title={status.size ? `The picture is ${status.size[0]}×${status.size[1]} on the display` : undefined}>
              Showing on {shown.name}
            </p>
          ) : (
            <div className="live-status">
              <span>Not showing</span>
              <Button onPress={() => show(chosen)} title="Open the output full screen on the display picked below">
                Show
              </Button>
            </div>
          )}
          {displays.length > 0 ? (
            <Select
              className="live-display"
              items={displays.map(displayName)}
              index={Math.max(0, pick)}
              onChange={(i) => show(displays[i].id)}
              label="Display"
              title="The display the output fills; remembered for next time"
            />
          ) : (
            <p className="live-note">No displays found.</p>
          )}
          {alone ? (
            <p className="live-warn" role="note">
              Only one display is connected, so the output covers this one — the menu bar and this window too. Connect a projector or a second display and pick it
              here; ⌘⇧L closes the output.
            </p>
          ) : (
            shown?.main && (
              <p className="live-warn" role="note">
                The output is covering the display with the menu bar. Pick another display above.
              </p>
            )
          )}
        </div>
        <div className="live-lists">
          {lists && (
            <Playlists
              lists={lists}
              current={current}
              selected={selected ?? deck?.playlist ?? lists.playlists[0]?.id ?? null}
              onSelect={setSelected}
              onLists={setLists}
              onError={(text, detail) => setError({ text, detail: detail ?? null })}
              library={false}
            />
          )}
        </div>
      </aside>
      <HintFooter className="live-hints" resting={KEYS} />
    </div>
  );
}
