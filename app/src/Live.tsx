import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NumberField } from '@openflow/widgets/controls/NumberField.tsx';
import { Segmented } from '@openflow/widgets/controls/Segmented.tsx';
import { Slider } from '@openflow/widgets/controls/Slider.tsx';
import { Toggle } from '@openflow/widgets/controls/Toggle.tsx';
import type { Param } from '@openflow/widgets/param/param.ts';
import * as api from './api.ts';
import { AudioInput } from './AudioInput.tsx';
import * as fx from './fx.ts';
import * as output from './output.ts';
import { Playlists } from './Playlists.tsx';
import * as pl from './playlists.ts';
import './live.css';

const nameOf = (path: string) => path.split('/').pop()?.replace(/\.milk$/i, '') ?? path;

/** The effects that are held while pressed (and latch with Shift), and the one that toggles. */
type Hit = 'strobe' | 'punch' | 'freeze' | 'blackout';
const hitAction = (kind: Hit, on: boolean | null) => ({ kind, on }) as fx.FxAction;

/** The keys that hold an effect while they are down. */
const HOLD_KEYS: Record<string, Hit> = { s: 'strobe', p: 'punch', f: 'freeze' };

const range = (name: string, min: number, max: number, defaultValue: number): Param => ({
  kind: 'float',
  min,
  max,
  defaultValue,
  name,
});
const SPEED = range('speed', 0.25, 2, 1);
const TRANSITION = range('transition', 0, 10, 2);
const BRIGHTNESS = range('brightness', 0, 2, 1);
const HUE = range('hue', 0, 1, 0);
const TRAILS = range('trails', 0, 1, 0);
const SENSITIVITY = range('sensitivity', 0.25, 4, 1);
const INTENSITY = range('strobe', 0, 1, 1);
const FADE = range('blackout fade', 0, 10, 0);
const BPM: Param = { kind: 'int', min: 40, max: 240, defaultValue: 120, steps: 201, name: 'bpm' };

const RATES = [0.25, 0.5, 1, 2, 4];
const RATE_NAMES = ['¼', '½', '1', '2', '4'];
const BARS = [0, 4, 8, 16, 32];
const MIRRORS: fx.Mirror[] = ['off', 'x', 'y', 'quad'];
const nearest = (list: number[], value: number) =>
  list.reduce((best, v, at) => (Math.abs(v - value) < Math.abs(list[best] - value) ? at : best), 0);

/**
 * One of the big buttons. A held one sends on while the pointer is down and off
 * when it comes up or leaves; Shift-click latches it instead. Blackout toggles.
 */
function HitButton({ kind, on, hold, label, keyName, send }: {
  kind: Hit;
  on: boolean;
  hold: boolean;
  label: string;
  keyName: string;
  send: (action: fx.FxAction) => void;
}) {
  const pressed = useRef(false);
  const release = () => {
    if (!pressed.current) return;
    pressed.current = false;
    send(hitAction(kind, false));
  };
  return (
    <button
      type="button"
      className="live-hit"
      data-kind={kind}
      data-on={on ? '' : undefined}
      title={hold ? `${label}: hold (${keyName}), Shift-click latches` : `${label}: toggle (${keyName})`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        if (!hold || e.shiftKey) {
          send(hitAction(kind, null));
          return;
        }
        pressed.current = true;
        send(hitAction(kind, true));
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
    >
      {label}
      <small>{keyName}</small>
    </button>
  );
}

/**
 * The live effects: the hits, the picture and time controls, the tempo. Every
 * change goes out through `act`, as a controller's would, and what is shown is
 * the state the app sends back (set here ahead of it, so a drag doesn't lag).
 */
function Effects({ state, onState, send }: {
  state: fx.Fx;
  onState: React.Dispatch<React.SetStateAction<fx.Fx | null>>;
  send: (action: fx.FxAction) => void;
}) {
  const set = (action: fx.FxAction, patch: Partial<fx.Fx>) => {
    onState((s) => s && { ...s, ...patch });
    send(action);
  };
  const slider = (param: Param, value: number, onChange: (v: number) => void, display: string) => (
    <Slider
      param={param}
      value={value}
      onChange={onChange}
      display={display}
      orientation="horizontal"
      layout="inside"
      title={`${param.name} (double-click resets)`}
    />
  );

  return (
    <div className="live-fx">
      <div className="live-hits">
        <HitButton kind="strobe" on={state.strobe} hold label="STROBE" keyName="S" send={send} />
        <HitButton kind="punch" on={state.punch} hold label="PUNCH" keyName="P" send={send} />
        <HitButton kind="freeze" on={state.freeze} hold label="FREEZE" keyName="F" send={send} />
        <HitButton kind="blackout" on={state.blackout} hold={false} label="BLACKOUT" keyName="B" send={send} />
        <button
          type="button"
          className="live-hit live-hold"
          data-on={state.hold ? '' : undefined}
          title="hold the preset: steps and auto-advance are ignored (H)"
          onClick={() => send({ kind: 'hold', on: null })}
        >
          HOLD
          <small>H</small>
        </button>
      </div>
      <div className="live-fx-row">
        <button type="button" className="live-tap" title="tap tempo (T)" onClick={() => send({ kind: 'tap' })}>
          TAP <b>{Math.round(state.bpm)}</b>
        </button>
        <NumberField
          param={BPM}
          value={Math.round(state.bpm)}
          onChange={(v) => set({ kind: 'bpm', bpm: Math.round(v) }, { bpm: Math.round(v) })}
          name="bpm"
          title="type a tempo"
        />
        <Segmented
          name="sync"
          items={['tempo', 'audio']}
          index={state.sync === 'audio' ? 1 : 0}
          onChange={(i) => {
            const source: fx.Sync = i === 1 ? 'audio' : 'tempo';
            set({ kind: 'sync', source }, { sync: source });
          }}
        />
        <Segmented
          name="advance every"
          items={['off', '4', '8', '16', '32']}
          index={nearest(BARS, state.bars)}
          onChange={(i) => set({ kind: 'bars', bars: BARS[i] }, { bars: BARS[i] })}
          title="auto-advance every this many bars; off uses the playlist's seconds"
        />
        <span className="fill" />
        <button type="button" onClick={() => send({ kind: 'fx_reset' })} title="every effect back to normal (0)">
          reset effects
        </button>
      </div>
      <div className="live-fx-row">
        <Segmented
          name="strobe rate"
          items={RATE_NAMES}
          index={nearest(RATES, state.strobe_rate)}
          onChange={(i) => set({ kind: 'strobe_rate', rate: RATES[i] }, { strobe_rate: RATES[i] })}
          title="flashes per beat"
        />
        <Segmented
          name="strobe"
          items={['white', 'black']}
          index={state.strobe_style === 'black' ? 1 : 0}
          onChange={(i) => {
            const style: fx.StrobeStyle = i === 1 ? 'black' : 'white';
            set({ kind: 'strobe_style', style }, { strobe_style: style });
          }}
        />
        <Segmented
          name="mirror"
          items={['off', 'X', 'Y', '4-way']}
          index={Math.max(0, MIRRORS.indexOf(state.mirror))}
          onChange={(i) => set({ kind: 'mirror', mode: MIRRORS[i] }, { mirror: MIRRORS[i] })}
          title="mirror (M steps through)"
        />
        <Toggle
          on={state.invert}
          onChange={(on) => set({ kind: 'invert', on }, { invert: on })}
          layout="inside"
          name="invert"
          label="invert"
          title="invert (I)"
        >
          {state.invert ? 'on' : 'off'}
        </Toggle>
        <Toggle
          on={state.punch_on_beat}
          onChange={(on) => set({ kind: 'punch_on_beat', on }, { punch_on_beat: on })}
          layout="inside"
          name="punch on beat"
          label="punch on beat"
        >
          {state.punch_on_beat ? 'on' : 'off'}
        </Toggle>
      </div>
      <div className="live-fx-grid">
        {slider(SPEED, state.speed, (v) => set({ kind: 'speed', speed: v }, { speed: v }), `${state.speed.toFixed(2)}×`)}
        {slider(TRANSITION, state.transition, (v) => set({ kind: 'transition', seconds: v }, { transition: v }), `${state.transition.toFixed(1)} s`)}
        {slider(BRIGHTNESS, state.brightness, (v) => set({ kind: 'brightness', value: v }, { brightness: v }), state.brightness.toFixed(2))}
        {slider(HUE, state.hue, (v) => set({ kind: 'hue', value: v }, { hue: v }), `${Math.round(state.hue * 360)}°`)}
        {slider(TRAILS, state.trails, (v) => set({ kind: 'trails', value: v }, { trails: v }), state.trails.toFixed(2))}
        {slider(SENSITIVITY, state.sensitivity, (v) => set({ kind: 'sensitivity', value: v }, { sensitivity: v }), `${state.sensitivity.toFixed(2)}×`)}
        {slider(INTENSITY, state.strobe_intensity, (v) => set({ kind: 'strobe_intensity', value: v }, { strobe_intensity: v }), `${Math.round(state.strobe_intensity * 100)}%`)}
        {slider(FADE, state.blackout_fade, (v) => set({ kind: 'blackout_fade', seconds: v }, { blackout_fade: v }), `${state.blackout_fade.toFixed(1)} s`)}
      </div>
    </div>
  );
}

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
  const [effects, setEffects] = useState<fx.Fx | null>(null);
  const preview = useRef<HTMLDivElement>(null);
  usePreview(preview);

  // Live mode is the output: open it on the way in, close it on the way out.
  // Leaving also puts the effects back, so the editor is never left inverted or frozen.
  useEffect(() => {
    api.setPreviews(false).catch(() => {});
    output.open(null).then(setStatus, (e) => setError(String(e)));
    const off = output.onStatus(setStatus);
    fx.state().then(setEffects, (e) => setError(String(e)));
    const offFx = fx.onFx(setEffects);
    return () => {
      off.then((f) => f());
      offFx.then((f) => f());
      fx.act({ kind: 'fx_reset' }).catch(() => {});
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
  const actFx = useCallback((action: fx.FxAction) => fx.act(action).catch((e) => setError(String(e))), []);

  // The hold keys that are down, so their release (or the window losing focus) lets go.
  const held = useRef(new Set<Hit>());
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        onMode('editor', current);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      const k = e.key.toLowerCase();
      const hit = HOLD_KEYS[k];
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') act({ kind: 'next' });
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') act({ kind: 'previous' });
      else if (k === 'r') act({ kind: 'random' });
      else if (hit || (k.length === 1 && 'btimh0'.includes(k))) {
        e.preventDefault();
        if (e.repeat) return;
        if (hit && e.shiftKey) actFx(hitAction(hit, null));
        else if (hit) {
          held.current.add(hit);
          actFx(hitAction(hit, true));
        } else if (k === 'b') actFx({ kind: 'blackout', on: null });
        else if (k === 't') actFx({ kind: 'tap' });
        else if (k === 'i') actFx({ kind: 'invert', on: null });
        else if (k === 'm') actFx({ kind: 'mirror', mode: null });
        else if (k === 'h') actFx({ kind: 'hold', on: null });
        else if (k === '0') actFx({ kind: 'fx_reset' });
        return;
      } else return;
      e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      const hit = HOLD_KEYS[e.key.toLowerCase()];
      if (hit && held.current.delete(hit)) actFx(hitAction(hit, false));
    };
    const blur = () => {
      for (const hit of held.current) actFx(hitAction(hit, false));
      held.current.clear();
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
            {effects?.hold && <span className="live-held" title="held: steps and auto-advance are ignored (H)">HOLD</span>}
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
          <p className="quiet live-keys">
            hold S strobe · P punch · F freeze (Shift latches) · B blackout · T tap · I invert · M mirror · H hold · 0 reset effects
          </p>
        </div>
        {effects && <Effects state={effects} onState={setEffects} send={actFx} />}
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
