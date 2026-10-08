import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { HintFooter } from '@openflow/widgets/chrome/HintFooter.tsx';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { ButtonFace } from '@openflow/widgets/controls/ButtonFace.tsx';
import { Select } from '@openflow/widgets/controls/Select.tsx';
import * as api from './api.ts';
import { AudioInput } from './AudioInput.tsx';
import { Effects } from './Effects.tsx';
import * as fx from './fx.ts';
import { LinkPanel } from './LinkPanel.tsx';
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
    // Anything above the hole (effects, banner, wrapping text) or a scroll can
    // move it without resizing it, so check its rect every frame and send it
    // only when it actually changed.
    let last = '';
    let frame = 0;
    const tick = () => {
      const r = el.getBoundingClientRect();
      const key = `${r.left},${r.top},${r.width},${r.height}`;
      if (key !== last) {
        last = key;
        api.placeBench({ x: r.left, y: r.top, width: r.width, height: r.height }).catch(() => {});
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [ref]);
}

const displayName = (d: output.Display) => `${d.index + 1}. ${d.name} (${d.width}×${d.height})${d.main ? ' · menu bar' : ''}`;

/** What the keys do, said by the strip along the bottom when nothing is pointed at. */
const KEYS =
  '← → step · R random · H hold · hold S strobe, P punch, F freeze (⇧ latches) · B blackout · T tap · I invert · M mirror · 0 reset effects · ⌘⇧L editor';

/**
 * Live mode: performing, not editing. The output fills a display of its own
 * while this is shown, and closes when it isn't; the editor isn't rendered and
 * the engine reads back no stage pictures. What's left is what a show needs, the
 * most needed biggest: what's playing and what's next, previous / random / next
 * and HOLD (through the live action layer, as a controller would), the effects,
 * Link, the playlists, the audio input, and where the output goes.
 *
 * Esc does nothing here, so a stray key never stops the show: leaving is the
 * switch above, or ⌘⇧L. Leaving also puts the effects back, so the editor is
 * never left inverted or frozen.
 */
export function Live({ start, onMode }: { start: string | null; onMode: (mode: 'editor', path: string | null) => void }) {
  const [lists, setLists] = useState<pl.Lists | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [error, setError] = useState<Problem | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [displays, setDisplays] = useState<output.Display[]>([]);
  const [status, setStatus] = useState<output.Status>({ display: null, size: null });
  const [stats, setStats] = useState<api.Stats>({ fps: 0, cpu_ms: 0 });
  const [effects, setEffects] = useState<fx.Fx | null>(null);
  const preview = useRef<HTMLDivElement>(null);
  usePreview(preview);

  const held = (effects?.hold ?? lists?.deck.hold) === true;
  const heldNow = useRef(held);
  heldNow.current = held;

  const fail = useCallback((what: string) => (e: unknown) => setError(problem(what, e)), []);
  const show = useCallback((id: number | null) => output.open(id).then(setStatus, fail("Couldn't show the output on that display.")), [fail]);

  // Live mode is the output: open it on the way in, close it (and reset the effects) on the way out.
  useEffect(() => {
    api.setPreviews(false).catch(() => {});
    show(null);
    const off = output.onStatus(setStatus);
    fx.state().then(setEffects, fail("Couldn't read the effects."));
    const offFx = fx.onFx(setEffects);
    return () => {
      off.then((f) => f());
      offFx.then((f) => f());
      fx.act({ kind: 'fx_reset' }).catch(() => {});
      output.close().catch(() => {});
    };
  }, [show, fail]);

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

  const act = useCallback(
    (action: pl.Action) =>
      pl.act(action).catch((e) =>
        setError(
          heldNow.current
            ? problem('HOLD is on, so the preset stays — press H to let go.', e)
            : problem(`Couldn't ${action.kind === 'random' ? 'pick a random preset' : `go to the ${action.kind} preset`}.`, e),
        ),
      ),
    [],
  );
  const actFx = useCallback((action: fx.FxAction) => fx.act(action).catch(fail("Couldn't change that effect.")), [fail]);

  // The hold keys that are down, so their release (or the window losing focus) lets go.
  const down = useRef(new Set<fx.Hit>());
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
      else {
        const press = fx.effectKey(e.key, e.shiftKey);
        if (!press) return;
        e.preventDefault();
        if (e.repeat) return;
        if ('hold' in press) {
          down.current.add(press.hold);
          actFx(fx.hitAction(press.hold, true));
        } else actFx(press.action);
        return;
      }
      e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      const hit = fx.HOLD_KEYS[e.key.toLowerCase()];
      if (hit && down.current.delete(hit)) actFx(fx.hitAction(hit, false));
    };
    const blur = () => {
      for (const hit of down.current) actFx(fx.hitAction(hit, false));
      down.current.clear();
    };
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [act, actFx, onMode, current]);

  const says = pl.nextSays(lists, held);
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
            {current ? <b>{nameOf(current)}</b> : <b className="live-none">Nothing playing — press R for a random preset, or play a playlist.</b>}
            {held && (
              <span className="live-held" title="Held: steps, auto-advance and Link's changes wait until you let go (H)">
                HOLD
              </span>
            )}
          </div>
          <div className="live-next">
            <i>next</i>
            {says.kind === 'held' ? (
              <span className="live-none">held — nothing changes until you let go of HOLD (H)</span>
            ) : says.kind === 'item' ? (
              <span data-missing={says.item.missing ? '' : undefined} title={says.item.missing ? `Not in the library any more: ${says.item.path}` : `${says.item.path} — what → opens; R picks any other`}>
                {says.item.name}
                {says.item.missing && <em> — missing from the library, it won't open</em>}
              </span>
            ) : says.kind === 'empty' ? (
              <span className="live-none">{says.up.playlist.name} is empty — add presets with + current.</span>
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
            {deck?.auto ? ` · moves on every ${Math.round(deck.seconds)} s` : ''}
          </p>
        </div>
        <div className="wdg live-transport">
          <Button onPress={() => act({ kind: 'previous' })} label="Previous preset" title="Previous preset (← or ↑)">
            ◀ previous
          </Button>
          <Button onPress={() => act({ kind: 'random' })} label="Random preset" title={up ? `Any other preset in ${up.playlist.name} (R)` : 'Any preset in the library (R)'}>
            random
          </Button>
          <Button onPress={() => act({ kind: 'next' })} label="Next preset" title="Next preset (→ or ↓)">
            next ▶
          </Button>
          <ButtonFace
            className="live-hold"
            aria-pressed={held}
            aria-label="Hold the preset (H)"
            title="Hold the preset: steps, auto-advance and Link's changes wait until you let go (H)"
            onClick={() => actFx({ kind: 'hold', on: null })}
          >
            HOLD
          </ButtonFace>
        </div>
        {error && (
          <div className="live-problem" role="alert" title={error.detail ?? undefined}>
            <span>{error.text}</span>
            <Button tone="quiet" onPress={() => setError(null)} label="Dismiss" title="Dismiss">
              ✕
            </Button>
          </div>
        )}
        {effects && <Effects state={effects} onState={setEffects} send={actFx} />}
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
        <LinkPanel />
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
