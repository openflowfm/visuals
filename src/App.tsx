import { useEffect, useRef, useState } from 'react';
import { createCompositor, type Compositor } from './render/compositor.ts';
import { useOutput } from './state/useOutput.ts';
import { useShow, type Clock } from './state/useShow.ts';
import { ON_WALL, useOnWall, useWall } from './state/useWall.ts';
import { Align } from './ui/Align.tsx';
import { Console } from './ui/Console.tsx';
import './app.css';

/**
 * The renderer, and a panel that explains itself.
 *
 * The picture is the product; the panel exists because a rig that shows nothing
 * gives you no way to tell *which* thing is wrong — the set, the bridge, the
 * clock, or the shaders. Press `i` to toggle it, and it starts open because the
 * first thing anyone does with this is find out whether it connected.
 *
 * **This is also the wall**, when the URL says so — the same component with the
 * panel, the console and the handles taken away, drawing on the projector in a
 * window opened for it. One component rather than two because the loop that
 * advances the clock and feeds the compositor is the thing that must not exist
 * twice; what a front end gets to decide is only the destination. See
 * [the wall](./state/useWall.ts).
 */
export function App() {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const stage = useRef<Compositor | null>(null);
  const { show, showRef, scheme, grid, save, downbeat, clock, online } = useShow();
  // The render loop reads the scheme every frame because effects live in it, and
  // reads it through a ref for the same reason it reads the show through one:
  // rebuilding the loop whenever a number moved would drop a frame per edit.
  const schemeRef = useRef(scheme);
  schemeRef.current = scheme;
  const { output, aligning, align, moveCorner, setGain, reset } = useOutput();
  const wall = useWall(!ON_WALL);
  const { open: walled, send, shut } = wall;
  useOnWall(ON_WALL);
  const [panel, setPanel] = useState(true);
  const [editing, setEditing] = useState(false);
  const [fps, setFps] = useState(0);
  const [glError, setGlError] = useState<string | null>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      // Ignore keys aimed at a field: `e` is a letter before it is a shortcut,
      // and a regex being typed into a rule contains most of the alphabet.
      //
      // `instanceof` rather than a truthiness check, because a keydown's target
      // is not always an element — on a synthetic event it can be `window`,
      // which has no `matches` and threw, taking every shortcut down with it.
      const target = e.target;
      if (target instanceof HTMLElement && target.matches('input, textarea, select')) return;
      if (e.key === 'f') void document.documentElement.requestFullscreen?.().catch(() => {});
      // The wall is a picture and not a control surface. `f` is above this line
      // because a window that failed to fill its screen needs one way to.
      if (ON_WALL) return;
      // The one. A digit rather than a letter because it *is* the count, and
      // because the four letters worth having are already shortcuts.
      if (e.key === '1') downbeat();
      if (e.key === 'i') setPanel((on) => !on);
      if (e.key === 'e') setEditing((on) => !on);
      if (e.key === 'k') align(!aligning);
      if (e.key === 'w') {
        if (walled) shut();
        else send();
      }
      if (e.key === 'Escape') {
        setEditing(false);
        align(false);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [downbeat, align, aligning, walled, send, shut]);

  useEffect(() => {
    if (!canvas.current) return;
    let compositor: Compositor;
    try {
      compositor = createCompositor(canvas.current);
    } catch (err) {
      setGlError((err as Error).message);
      return;
    }
    if (compositor.error) setGlError(compositor.error);
    stage.current = compositor;

    let raf = 0;
    let last = performance.now();
    let frames = 0;
    let since = last;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      // Clamped, so a tab that was backgrounded for a minute doesn't advance
      // the musical clock by a minute's worth of beats in one frame.
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      clock.advance(dt);
      compositor.frame(showRef.current, schemeRef.current, clock.beat(), clock.seconds(), dt);

      frames += 1;
      if (now - since >= 500) {
        // Nobody reads a frame rate off a projector, and a wall re-rendering
        // twice a second for a number it does not draw is two renders too many.
        if (!ON_WALL) setFps(Math.round((frames * 1000) / (now - since)));
        frames = 0;
        since = now;
        if (compositor.error) setGlError(compositor.error);
      }
    };
    raf = requestAnimationFrame(loop);

    const resize = () => compositor.resize();
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      stage.current = null;
      compositor.free();
    };
  }, [clock, showRef]);

  // The corners belong to the projector rather than to the show, so they reach
  // the compositor on a change rather than riding every frame. The grid comes on
  // with the mode: it is only ever useful while something is being lined up.
  useEffect(() => {
    stage.current?.setOutput({ ...output, test: aligning });
  }, [output, aligning]);

  const drawing = show.tracks.filter((t) => t.playing >= 0 && t.opacity > 0.001);
  const bars = scheme?.rotation.bars ?? 0;

  return (
    <>
      <canvas ref={canvas} className="stage" />
      {panel && !ON_WALL && (
        <div className="panel">
          <h1>
            visuals
            <span className={online ? 'ok' : 'bad'}>{online ? 'server' : 'no server'}</span>
            <span className={show.connected ? 'ok' : 'bad'}>
              {show.connected ? 'bridge' : 'no bridge'}
            </span>
            <span className={show.clock ? 'ok' : 'warn'}>
              {show.clock ? `link ${show.peers}` : 'no link'}
            </span>
            <span className={show.playing ? 'ok' : 'idle'}>
              {show.playing ? 'playing' : 'stopped'}
            </span>
          </h1>

          {glError && <p className="bad-line">{glError}</p>}
          {wall.trouble && <p className="bad-line">{wall.trouble}</p>}
          {show.schemeError && <p className="bad-line">scheme.json: {show.schemeError}</p>}

          <dl>
            <dt>tempo</dt>
            <dd>{show.tempo.toFixed(1)}</dd>
            <Phrase clock={clock} quantum={show.quantum} one={show.one} bars={bars} />
            <dt>playing</dt>
            <dd>
              {drawing.length}/{show.tracks.length}
            </dd>
            <dt>song</dt>
            <dd className="wide">{show.song ?? '—'}</dd>
            <dt>section</dt>
            <dd>{show.role ?? '—'}</dd>
            <dt>look</dt>
            <dd className="wide">
              {show.look ? (scheme?.looks[show.look]?.name ?? show.look) : '—'}
              {show.pinned ? '*' : ''}
            </dd>
            <dt>colours</dt>
            <dd className="wide">{show.colorway ?? '—'}</dd>
            <dt>fps</dt>
            <dd>{fps}</dd>
            <dt>wall</dt>
            <dd className="wall">
              {walled ? (
                <>
                  <span>{wall.where ?? 'open'}</span>
                  <button type="button" onClick={shut}>
                    close
                  </button>
                </>
              ) : wall.displays.length ? (
                wall.displays.map((display) => (
                  <button key={display.name} type="button" onClick={() => send(display)}>
                    {display.name}
                  </button>
                ))
              ) : (
                <button type="button" onClick={() => send()}>
                  send
                </button>
              )}
            </dd>
          </dl>

          <p className="hint">
            <kbd>1</kbd> the one · <kbd>i</kbd> panel · <kbd>e</kbd> edit · <kbd>k</kbd> align ·{' '}
            <kbd>w</kbd> wall · <kbd>f</kbd> fullscreen
          </p>
        </div>
      )}
      {aligning && !ON_WALL && (
        <Align
          corners={output.corners}
          gain={output.gain}
          moveCorner={moveCorner}
          setGain={setGain}
          reset={reset}
          onClose={() => align(false)}
        />
      )}
      {editing && scheme && (
        <Console
          show={show}
          showRef={showRef}
          scheme={scheme}
          grid={grid}
          save={save}
          clock={clock}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}

/**
 * Where the music is: the beat, and the bar within the phrase.
 *
 * **Its own component because it runs its own loop.** The rest of the panel
 * re-renders when the *set* changes, roughly once a second, and a beat drawn on
 * that schedule counts 1, 3, 4, 2 — it is not wrong, it is sampled too slowly to
 * be right, which reads as a rig with a stutter in it. So this reads the clock
 * the shaders read and re-renders when the **digit** changes, which is three
 * times a second at worst and never touches the console mounted beside it.
 *
 * Digits rather than a sentence. `1 of 4` is a fact you read; four numerals with
 * one lit is a thing you glance at, which is the only way anything on this panel
 * gets looked at during a set.
 *
 * The bar is counted **from the one** rather than from Link's zero, which is the
 * whole point of there being a one — see [`resolve.ts`](../resolve.ts). Shown
 * against the rotation's window, so it is also a countdown to the next change.
 */
function Phrase({
  clock,
  quantum,
  one,
  bars,
}: {
  clock: Clock;
  quantum: number;
  /** The Link beat the phrase starts on, as the server counts it. */
  one: number;
  /** How many bars the look wheel runs for. Zero when it is held. */
  bars: number;
}) {
  const [at, setAt] = useState({ beat: 1, bar: 1 });
  const now = useRef({ quantum, one, bars });
  now.current = { quantum, one, bars };

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const held = now.current;
      const q = Math.max(1, held.quantum);
      const since = clock.beat() - held.one;
      const beat = Math.floor(((since % q) + q) % q) + 1;
      const window = held.bars > 0 ? held.bars : 0;
      const whole = Math.floor(since / q);
      const bar = window > 0 ? (((whole % window) + window) % window) + 1 : 1;
      setAt((was) => (was.beat === beat && was.bar === bar ? was : { beat, bar }));
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [clock]);

  return (
    <>
      <dt>beat</dt>
      <dd className="beat">
        {Array.from({ length: Math.max(1, Math.min(quantum, 8)) }, (_, i) => (
          <b key={i} data-on={i + 1 === at.beat ? '' : undefined}>
            {i + 1}
          </b>
        ))}
      </dd>
      {bars > 0 && (
        <>
          <dt>bar</dt>
          <dd>
            {at.bar}/{bars}
          </dd>
        </>
      )}
    </>
  );
}
