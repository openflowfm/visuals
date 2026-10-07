import { useEffect, useState } from 'react';
import * as link from './link.ts';
import './link.css';

/** What the interval picker offers, as `every:unit`. */
const CHOICES: [string, string][] = [
  ['0:bars', 'off'],
  ['1:beats', 'every beat'],
  ['2:beats', 'every 2 beats'],
  ['1:bars', 'every bar'],
  ['2:bars', 'every 2 bars'],
  ['4:bars', 'every 4 bars'],
  ['8:bars', 'every 8 bars'],
  ['16:bars', 'every 16 bars'],
  ['32:bars', 'every 32 bars'],
];

/** Where the bar is now: the last frame run on at its tempo, so the light moves smoothly between frames. */
function runOn(frame: link.Frame, now: number): { bar: number; phase: number } {
  const beats = Math.max(0, now - frame.at) * (frame.tempo / 60000);
  const q = frame.quantum;
  const since = frame.bar - 1 + (frame.barPhase + beats) / q;
  const bar = Math.floor(since);
  return { bar: bar + 1, phase: (since - bar) * q };
}

/**
 * Ableton Link and the one: who is in the session and at what tempo, the bar counted
 * from the one with a light per beat, "set one" (with a beat's nudge either way), and
 * how often the preset changes on the beat. Visuals follow the session; nothing here
 * sets its tempo or transport.
 */
export function LinkPanel() {
  const [frame, setFrame] = useState<link.Frame | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    link.state().then(setFrame, (e) => setError(String(e)));
    const off = link.onFrame(setFrame);
    return () => {
      off.then((f) => f());
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setNow(Date.now());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const run = (p: Promise<link.Frame>) =>
    p.then(
      (f) => {
        setFrame(f);
        setError(null);
      },
      (e) => setError(String(e)),
    );

  if (!frame) {
    return (
      <div className="link-panel">
        <h2>link</h2>
        {error ? <p className="problem">{error}</p> : <p className="quiet">starting…</p>}
      </div>
    );
  }

  const { bar, phase } = runOn(frame, now);
  const lit = Math.min(frame.quantum - 1, Math.floor(phase));
  const every = `${frame.every.every}:${frame.every.unit}`;
  const toNext = frame.next !== null ? frame.next - (frame.beat + Math.max(0, now - frame.at) * (frame.tempo / 60000)) : null;

  return (
    <div className="link-panel">
      <div className="link-head">
        <h2>link</h2>
        <label className="link-on">
          <input type="checkbox" checked={frame.enabled} onChange={(e) => run(link.enable(e.target.checked))} />
          <span>{frame.enabled ? 'on' : 'off'}</span>
        </label>
      </div>
      <p className="link-status" data-on={frame.enabled && frame.peers > 0 ? '' : undefined}>
        <b>{frame.tempo.toFixed(1)}</b> bpm ·{' '}
        {!frame.enabled
          ? 'not on the network: our own clock'
          : frame.peers === 0
            ? 'no peers: our own clock'
            : `${frame.peers} ${frame.peers === 1 ? 'peer' : 'peers'}`}
        {frame.playing && ' · playing'}
      </p>
      <div className="link-beat">
        <span className="link-bar" title="the bar, counted from the one">
          {bar}
        </span>
        <span className="link-lights">
          {Array.from({ length: frame.quantum }, (_, i) => (
            <span key={i} className="link-light" data-lit={i === lit ? '' : undefined} data-one={i === 0 ? '' : undefined} />
          ))}
        </span>
      </div>
      <div className="link-one">
        <button onClick={() => run(link.nudge(-1))} title="the one a beat earlier">
          −
        </button>
        <button onClick={() => run(link.setOne())} title="the one is the nearest bar line (the coming one, late in a bar)">
          set one
        </button>
        <button onClick={() => run(link.nudge(1))} title="the one a beat later">
          +
        </button>
        <button onClick={() => run(link.resetOne())} title="back to Link's own bar lines">
          reset
        </button>
      </div>
      <label className="link-every">
        <span>change preset</span>
        <select
          value={every}
          onChange={(e) => {
            const [n, unit] = e.target.value.split(':');
            run(link.sync(Number(n), unit as link.Unit));
          }}
        >
          {CHOICES.some(([v]) => v === every) || <option value={every}>every {frame.every.every} {frame.every.unit}</option>}
          {CHOICES.map(([v, name]) => (
            <option key={v} value={v}>
              {name}
            </option>
          ))}
        </select>
        {toNext !== null && <span className="quiet">in {Math.max(0, Math.ceil(toNext))} beats</span>}
      </label>
      {error && <p className="problem">{error}</p>}
    </div>
  );
}
