import { useEffect, useRef, useState } from 'react';
import { schemeLabel } from '../protocol.ts';
import { createCompositor, type Compositor } from './render/compositor.ts';
import type { FrameStats } from './render/meter.ts';
import { describeFrames } from './ui/frames.ts';
import { useOutput } from './state/useOutput.ts';
import { useShow, type Clock } from './state/useShow.ts';
import { ON_WALL, reportFrames, useOnWall, useWall, useWallFrames } from './state/useWall.ts';
import { Align } from './ui/Align.tsx';
import { Boundary } from './ui/Boundary.tsx';
import { Console } from './ui/Console.tsx';
import { Modal } from '@openflow/widgets/chrome/Modal.tsx';
import { DebugWorkspace } from './debug/Workspace.tsx';
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
  const {
    show,
    showRef,
    scheme,
    library,
    media,
    models,
    importModel,
    importModelTexture,
    saveModelSetup,
    reconcileModel,
    grid,
    edit,
    saveScheme,
    saveSchemeAs,
    loadScheme,
    downbeat,
    nextFlow,
    nextColorway,
    lab,
    labOpen,
    labArchiveOpen,
    labArchiveSelect,
    labArchiveDecide,
    labExploreOpen,
    labExploreJudge,
    labExploreSkip,
    labBookmark,
    labDevelopOpen,
    labDevelopDeal,
    labDevelopCompare,
    labDevelopSkip,
    labDevelopClose,
    labFinalsOpen,
    labFinalsNew,
    labFinalsCompare,
    labFinalsSkip,
    labOffer,
    labLog,
    labLogOpen,
    labRescore,
    labRetag,
    labRenote,
    labStage,
    labCandidate,
    calibrationAvailable,
    calibration,
    calibrationOpen,
    calibrationDecide,
    clock,
    online,
  } = useShow();
  // The render loop reads the scheme every frame because effects live in it, and
  // reads it through a ref for the same reason it reads the show through one:
  // rebuilding the loop whenever a number moved would drop a frame per edit.
  const schemeRef = useRef(scheme);
  schemeRef.current = scheme;
  const modelsRef = useRef(models);
  modelsRef.current = models;
  const { output, aligning, align, moveCorner, setGain, reset } = useOutput();
  const wall = useWall(!ON_WALL);
  const wallFrames = useWallFrames(!ON_WALL);
  const { open: walled, send, shut } = wall;
  useOnWall(ON_WALL);
  const [panel, setPanel] = useState(true);
  const [editing, setEditing] = useState(false);
  /**
   * This window's own frames. On the console with a wall up these describe a
   * quarter-size preview rather than the show, which is why the readout prefers
   * the wall's numbers whenever there are any.
   */
  const [frames, setFrames] = useState<FrameStats | null>(null);
  const [harness, setHarness] = useState(false);
  // The wall's numbers whenever there is a wall, because with one up this
  // window is drawing a quarter-size preview and its frame time describes that
  // preview rather than the show. The readout names which it is showing.
  const frameLine = describeFrames(
    walled ? wallFrames : frames,
    walled ? 'wall' : 'console',
  );
  const [glError, setGlError] = useState<string | null>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      // Ignore keys aimed at a field: `e` is a letter before it is a shortcut,
      // and a regex being typed into a rule contains most of the alphabet.
      //
      // `instanceof` rather than a truthiness check, because a keydown's target
      // is not always an element — on a synthetic event it can be `window`,
      // which has no `matches` and threw, taking every shortcut down with it.
      // Above the field guard, because ⌘S is a command and not a letter aimed
      // at a field — saving must work mid-typing. The browser's own save
      // dialog is eaten either way, wall included: nobody wants a webpage
      // download of the renderer mid-show.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key === 's') {
        e.preventDefault();
        if (!ON_WALL) saveScheme();
        return;
      }
      const target = e.target;
      if (target instanceof HTMLElement && target.matches('input, textarea, select')) return;
      if (e.key === 'f') void document.documentElement.requestFullscreen?.().catch(() => {});
      // The wall is a picture and not a control surface. `f` is above this line
      // because a window that failed to fill its screen needs one way to.
      if (ON_WALL) return;
      // The one. A digit rather than a letter because it *is* the count.
      if (e.key === '1') downbeat();
      // Flow, next. `n` rather than the `l` it was, because the noun changed and
      // a mnemonic for a word nobody uses any more is worse than no mnemonic.
      // `f` was the obvious first choice and is fullscreen.
      //
      // One press is one turn; holding the key must not race through a whole
      // library before the key-up arrives. Modifiers stay available to the
      // browser (`cmd-N` still opens a window), and the colourway does not move.
      if (e.key === 'n' && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) nextFlow();
      // Colourway, next — the same gesture's other half, under the same rules.
      if (e.key === 'c' && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) nextColorway();
      if (e.key === 'i') setPanel((on) => !on);
      // `d` for the harness. Not on the wall: that window is the picture, and
      // nothing that is not the picture belongs in front of an audience.
      if (e.key === 'd' && !ON_WALL) setHarness((on) => !on);
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
  }, [downbeat, nextFlow, nextColorway, saveScheme, align, aligning, walled, send, shut]);

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
    let since = last;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      // Clamped, so a tab that was backgrounded for a minute doesn't advance
      // the musical clock by a minute's worth of beats in one frame.
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      clock.advance(dt);
      compositor.frame(
        showRef.current,
        schemeRef.current,
        clock.beat(),
        clock.seconds(),
        dt,
        undefined,
        modelsRef.current,
      );

      if (now - since >= 500) {
        // Nobody reads a frame rate off a projector, so the wall does not draw
        // this — it says it, once a second, and the console reads it. Sorting a
        // 600-frame window twice a second is nothing next to a frame; sorting
        // it *inside* a frame would not be, which is why it is on this tick.
        const reading = compositor.stats();
        if (ON_WALL) reportFrames(reading);
        else setFrames(reading);
        since = now;
        // Set rather than only-when-set: a context that came back clears its
        // own message, and a panel still reading "the graphics context was
        // lost" over a picture that is drawing is worse than no panel.
        setGlError(compositor.error);
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

  // With a wall up this window stops being the destination and starts being a
  // preview of one, which is worth a quarter of the pixels rather than all of
  // them. There is no sharing the render itself: a GL context belongs to one
  // document, so two windows is two draws, and the only lever is how big the
  // one nobody is projecting has to be.
  useEffect(() => {
    stage.current?.preview(walled);
  }, [walled]);

  const drawing = show.tracks.filter((t) => t.playing >= 0 && t.opacity > 0.001);
  const bars = scheme?.rotation.bars ?? 0;

  return (
    <>
      <canvas ref={canvas} className="stage" />
      {harness && !ON_WALL && (
        <Modal
          title="debug & experiments"
          label="Debug workspace"
          className="vf-harness"
          onClose={() => setHarness(false)}
        >
          <DebugWorkspace subject={{ show, clock, frames, glError, online }} />
        </Modal>
      )}
      {panel && !ON_WALL && (
        <div className="panel">
          <h1>
            visual[flow]
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
            <button
              type="button"
              className="panel-bug"
              onClick={() => setHarness(true)}
              title="Open debugging and experiments — frames, the clock, and what is wired up (d)"
            >
              debug
            </button>
          </h1>

          {glError && <p className="bad-line">{glError}</p>}
          {wall.trouble && <p className="bad-line">{wall.trouble}</p>}
          {show.schemeError && <p className="bad-line">scheme: {show.schemeError}</p>}
          {library?.notice && <p className="bad-line">{library.notice}</p>}

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
            <dt>scheme</dt>
            <dd className="wide">
              {library ? `${schemeLabel(library.current)}${library.dirty ? ' *' : ''}` : '—'}
            </dd>
            <dt>flow</dt>
            <dd className="wide">
              {show.flow ? (scheme?.flows[show.flow]?.name ?? show.flow) : '—'}
              {show.pinned ? '*' : ''}
            </dd>
            <dt>colours</dt>
            <dd className="wide">{show.colorway ?? '—'}</dd>
            <dt>frames</dt>
            <dd className={`frames ${frameLine.tone}`} title={frameLine.detail}>
              <span>{frameLine.headline}</span>
              <small>{frameLine.source}</small>
            </dd>
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
            <kbd>1</kbd> the one · <kbd>n</kbd> next flow · <kbd>c</kbd> next colours ·{' '}
            <kbd>i</kbd> panel · <kbd>e</kbd>{' '}
            edit · <kbd>k</kbd> align · <kbd>w</kbd> wall · <kbd>f</kbd> fullscreen
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
        <Boundary what="the console">
          <Console
            show={show}
            scheme={scheme}
            library={library}
            media={media}
            models={models}
            importModel={importModel}
            importModelTexture={importModelTexture}
            saveModelSetup={saveModelSetup}
            reconcileModel={reconcileModel}
            grid={grid}
            edit={edit}
            saveScheme={saveScheme}
            saveSchemeAs={saveSchemeAs}
            loadScheme={loadScheme}
            lab={lab}
            labOpen={labOpen}
            labArchiveOpen={labArchiveOpen}
            labArchiveSelect={labArchiveSelect}
            labArchiveDecide={labArchiveDecide}
            labExploreOpen={labExploreOpen}
            labExploreJudge={labExploreJudge}
            labExploreSkip={labExploreSkip}
            labBookmark={labBookmark}
            labDevelopOpen={labDevelopOpen}
            labDevelopDeal={labDevelopDeal}
            labDevelopCompare={labDevelopCompare}
            labDevelopSkip={labDevelopSkip}
            labDevelopClose={labDevelopClose}
            labFinalsOpen={labFinalsOpen}
            labFinalsNew={labFinalsNew}
            labFinalsCompare={labFinalsCompare}
            labFinalsSkip={labFinalsSkip}
            labOffer={labOffer}
            labLog={labLog}
            labLogOpen={labLogOpen}
            labRescore={labRescore}
            labRetag={labRetag}
            labRenote={labRenote}
            labStage={labStage}
            labCandidate={labCandidate}
            calibrationAvailable={calibrationAvailable}
            calibration={calibration}
            calibrationOpen={calibrationOpen}
            calibrationDecide={calibrationDecide}
            clock={clock}
            onClose={() => setEditing(false)}
          />
        </Boundary>
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
  /** How many bars the flow wheel runs for. Zero when it is held. */
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
