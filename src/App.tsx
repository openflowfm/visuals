import { useEffect, useRef, useState } from 'react';
import { createCompositor, type Compositor } from './render/compositor.ts';
import { useShow } from './state/useShow.ts';
import { Editor } from './ui/Editor.tsx';
import './app.css';

/**
 * The renderer, and a panel that explains itself.
 *
 * The picture is the product; the panel exists because a rig that shows nothing
 * gives you no way to tell *which* thing is wrong — the set, the bridge, the
 * clock, or the shaders. Press `i` to toggle it, and it starts open because the
 * first thing anyone does with this is find out whether it connected.
 */
export function App() {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const { show, showRef, scheme, save, clock, online } = useShow();
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
      if (e.key === 'i') setPanel((on) => !on);
      if (e.key === 'e') setEditing((on) => !on);
      if (e.key === 'Escape') setEditing(false);
      if (e.key === 'f') void document.documentElement.requestFullscreen?.().catch(() => {});
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

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
      compositor.frame(showRef.current, clock.beat(), clock.seconds(), dt);

      frames += 1;
      if (now - since >= 500) {
        setFps(Math.round((frames * 1000) / (now - since)));
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
      compositor.free();
    };
  }, [clock, showRef]);

  const drawing = show.layers.filter((l) => l.playing >= 0 && l.opacity > 0.001);

  return (
    <>
      <canvas ref={canvas} className="stage" />
      {panel && (
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
          {show.schemeError && <p className="bad-line">scheme.json: {show.schemeError}</p>}

          <dl>
            <dt>tempo</dt>
            <dd>{show.tempo.toFixed(2)}</dd>
            <dt>beat</dt>
            <dd>{clockText(show.quantum)}</dd>
            <dt>song</dt>
            <dd>{show.song ?? '—'}</dd>
            <dt>colourway</dt>
            <dd>{show.colorway ?? '—'}</dd>
            <dt>section</dt>
            <dd>{show.role ?? '—'}{show.role && !show.archetype ? ' (no archetype)' : ''}</dd>
            <dt>energy</dt>
            <dd>{Math.round(show.energy * 100)}</dd>
            <dt>fps</dt>
            <dd>{fps}</dd>
          </dl>

          <table>
            <thead>
              <tr>
                <th>layer</th>
                <th>clip</th>
                <th>source</th>
                <th>effects</th>
                <th>nrg</th>
                <th>blend</th>
                <th>fader</th>
                <th>level</th>
              </tr>
            </thead>
            <tbody>
              {show.layers.map((layer) => (
                <tr key={layer.t} className={layer.playing < 0 ? 'silent' : undefined}>
                  <td>
                    <i style={{ background: hex(layer.color) }} />
                    {layer.name}
                  </td>
                  <td className="clip" title={layer.clipName}>
                    {layer.playing < 0 ? '—' : layer.clipName || `scene ${layer.playing}`}
                  </td>
                  <td>{layer.source}</td>
                  <td className="fx">
                    {layer.effects
                      // The amount is only worth the room when it isn't full —
                      // a column of "100"s is noise that pushes the useful
                      // columns off the edge.
                      .map((e) => (e.amount > 0.95 ? e.kind : `${e.kind} ${Math.round(e.amount * 100)}`))
                      .join(' + ') || '—'}
                  </td>
                  <td>{Math.round(layer.energy * 100)}</td>
                  <td>{layer.blend}</td>
                  <td>{Math.round(layer.opacity * 100)}</td>
                  <td>
                    <b style={{ width: `${Math.round(layer.level * 100)}%` }} />
                  </td>
                </tr>
              ))}
              {show.layers.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty">
                    {show.connected ? 'the set has no tracks yet' : 'waiting for the bridge'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="hint">
            {drawing.length} of {show.layers.length} layers drawing · <kbd>i</kbd> panel ·{' '}
            <kbd>e</kbd> edit · <kbd>f</kbd> fullscreen
          </p>
        </div>
      )}
      {editing && scheme && (
        <Editor show={show} scheme={scheme} save={save} onClose={() => setEditing(false)} />
      )}
    </>
  );

  /**
   * Beat within the bar, and deliberately not a bar number.
   *
   * Link's beat is one continuous session timeline that started whenever the
   * first peer in the session did, so its absolute value is meaningless here —
   * connecting to a Live that has been open all afternoon reads "bar 3480",
   * which is not the song's bar and never will be. The *phase* is the part that
   * is shared, exact, and worth showing, so that is the part shown.
   *
   * Read off the same clock the shaders use, so the panel cannot disagree with
   * the picture about where in the bar it is.
   */
  function clockText(quantum: number): string {
    const phase = ((clock.beat() % quantum) + quantum) % quantum;
    return `${Math.floor(phase) + 1} of ${quantum}`;
  }
}

function hex(color: number): string {
  return `#${(color >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
}
