import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { Circuit, CircuitNode, Scheme, Show } from '../../protocol.ts';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { createCompositor } from '../render/compositor.ts';
import { inside, usePlace, type Place } from '../state/usePlace.ts';
import { withStandIns } from '../state/useRoom.ts';
import type { Clock } from '../state/useShow.ts';
import { previewOutletOf, probeAt } from './probe.ts';
import type { ResponseOverrides } from '../../response.ts';

/**
 * The bench: the flow you are editing, drawn by the renderer the wall uses.
 *
 * Not a preview *of* the stage — the same `Compositor`, on a smaller canvas.
 * There used to be a second renderer here and it was a standing risk: a bench
 * that could disagree with the stage about what a flow looks like is worse than
 * no bench, because brightness and blend are exactly what you come here to
 * judge. One renderer means the disagreement cannot happen.
 *
 * It runs on the **designer's** transport and the designer's [room](
 * ../state/useRoom.ts) rather than the stage's, so a wave wired to the beat is
 * in time and a flow wired to the chorus is in the chorus while you build it,
 * whether or not Ableton is open. That is the whole reason a library is
 * something you can build.
 */
export function Bench({
  show,
  scheme,
  flow,
  clock,
  live,
  responses,
  onError,
}: {
  show: Show;
  scheme: Scheme;
  /** The flow to draw, which is the one being edited rather than the one that is up. */
  flow: string;
  clock: Clock;
  /**
   * Read the show from here each frame instead of `show` — the stage's own.
   * A ref rather than a value because meter levels ride the anchors into a ref
   * and never through React state; a live picture drawn from a prop would hold
   * every fader at wherever the last structural push left it.
   */
  live?: { readonly current: Show } | null;
  /** Development-only response substitutions for the calibration bench. */
  responses?: ResponseOverrides;
  onError(message: string | null): void;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const now = useRef({ show, scheme, flow, clock, live: live ?? null, responses, onError });
  now.current = { show, scheme, flow, clock, live: live ?? null, responses, onError };

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const compositor = createCompositor(el);
    let raf = 0;
    let last = performance.now();
    let said: string | null = null;

    const loop = (at: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min((at - last) / 1000, 0.1);
      last = at;
      const held = now.current;
      const beat = held.clock.beat();
      compositor.frame(
        // The flow is the one being **edited** rather than the one the wheel has
        // landed on, or the bench would show you something else while you
        // worked. The stand-in set is the room's, shared with the node faces —
        // see [`withStandIns`](../state/useRoom.ts).
        { ...withStandIns(held.live ? held.live.current : held.show, beat), flow: held.flow },
        held.scheme,
        beat,
        held.clock.seconds(),
        dt,
        held.responses,
      );
      if (compositor.error !== said) {
        said = compositor.error;
        held.onError(said);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      compositor.free();
    };
  }, []);

  return <canvas ref={canvas} className="bench-canvas" />;
}

/** How small the panel may be dragged before it stops being worth looking at. */
const LEAST = 180;

const WHERE = 'openflow.visuals.bench';

/**
 * Where it opens before anybody has moved it: top right, clear of the name row.
 *
 * `x` is deliberately past any screen. `inside` pins it to the right edge on the
 * first frame whatever the window is, and the pinned number is what gets stored,
 * so this stays a one-off rather than a rule. Top *left* would be worse than
 * arbitrary — it is where a new flow's nodes are dropped.
 */
const OPENS_AT: Place = { x: 1e4, y: 40, w: 560, h: 340 };

/**
 * The id a promoted node is drawn under, and there is deliberately only one.
 *
 * The compositor caches a compiled program per **flow id** and swaps it — old
 * program deleted, new one compiled — whenever that id's signature changes. So
 * one reused id means one probe program alive at a time, however many nodes you
 * click through. A `~probe:${nodeId}` scheme would compile just as correctly and
 * leak a GL program per node ever selected, because nothing would ever come back
 * to delete them. A tilde for the same reason `probe.ts` uses one: a flow id is
 * something a person can make, and this must never be one of theirs.
 */
const PROBE = '~probe';

/** A flow that was deleted out from under the panel still has to draw nothing. */
const EMPTY: Circuit = { nodes: [], cords: [] };

/**
 * What the header says while a node is up, and it has one job.
 *
 * Somebody clicks a node, walks away, and comes back to a big picture that is
 * not what the flow draws. Without a line saying so the next thing that happens
 * is a bug report about a flow that is fine — so the panel names the node, says
 * plainly that it is one node, and [tints its header](./console.css) as well,
 * because a reader who has stopped reading still sees a colour.
 *
 * The last clause is the one that is easy to leave out. A `p` or an `n` outlet
 * has no picture of its own: `probeAt` brings a number back through `paint` and
 * a point back through a `plasma` source, so what you are looking at is a
 * **diagram** of a signal rather than a frame. A big one implies otherwise
 * unless it says.
 */
function showing(circuit: Circuit, node: CircuitNode): string {
  const outlet = previewOutletOf(circuit, node.id)?.kind;
  return [
    'one node',
    // Kind and mode both, the way a faceplate shows them: a header reading
    // `plasma` over a node whose dropdown says `source` makes you read two
    // things to learn one.
    node.op ? `${node.kind} · ${node.op}` : node.kind,
    outlet === 'n'
      ? 'a number, drawn as brightness'
      : outlet === 'p'
        ? 'a point, drawn as plasma'
        : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * The bench, floating over the canvas rather than pinned beside it.
 *
 * It was a sidebar, and a sidebar is the wrong shape for the one thing in this
 * app you are actually looking at: a fixed column takes its width from the
 * *narrowest* thing in it and gives the rest of the screen to a graph you spend
 * far less time reading. Floating inverts that — the picture is as big as you
 * want it and the canvas keeps the whole width underneath, because a panel
 * costs nothing when it is not where you are working.
 *
 * **Where it sits is [the browser's](../state/usePlace.ts), not the scheme's.**
 * Same argument as the projector corners: it describes this person's screen.
 *
 * The shape is yours rather than pinned to 16:9, and that is honest rather than
 * lax — points are centred and aspect-corrected, so a wider bench shows more of
 * the same plane with circles still round, which is exactly what a wider wall
 * does. Nothing about the flow changes; the framing does, in the same way and
 * through the same code.
 *
 * ## It will draw one node instead
 *
 * A node's own face is about a hundred pixels across, which is enough to tell
 * you *that* something is happening and not nearly enough to tell you what. The only way to
 * flow properly used to be to rewire the node into `out`, flow, and rewire it
 * back — an edit, to answer a question. Clicking the face promotes it here
 * instead, at whatever size the panel is, and nothing about the graph changes.
 *
 * The picture it draws is [`probeAt`](./probe.ts)'s, so it is the same graph the
 * small face was already showing rather than a second reading of the node. What
 * makes it work is that the compositor takes a *scheme and an id*: hand it a
 * scheme with the probe graph parked under one throwaway id and it needs to
 * learn nothing at all.
 */
export function FloatingBench({
  show,
  scheme,
  flow,
  clock,
  onError,
  aside,
  probing,
  onProbe,
}: {
  show: Show;
  scheme: Scheme;
  flow: string;
  clock: Clock;
  onError(message: string | null): void;
  /** A word for the right of the header — what the picture is being driven by. */
  aside: string;
  /** A node of `flow` to draw instead of the whole thing, or null for the flow. */
  probing: CircuitNode | null;
  onProbe(id: string | null): void;
}) {
  const panel = useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = usePlace(WHERE, OPENS_AT);

  // Memoised because `Bench` re-reads this every frame through a ref, and both
  // halves of it allocate: `probeAt` rebuilds the graph and the scheme is copied
  // to park it. Neither is expensive once; sixty times a second, both are.
  const drawn = useMemo(() => {
    const circuit = probing ? probeAt(scheme.flows[flow]?.circuit ?? EMPTY, probing.id) : null;
    if (!circuit) return { scheme, flow };
    // The whole library goes with it, because a probed graph can still contain a
    // `flow` node and the flattener resolves those out of `scheme.flows`. It is
    // named rather than left blank because the compositor prefixes a compile
    // error with the flow's name, and `~probe: too many lines` names nothing a
    // person can act on.
    return {
      scheme: { ...scheme, flows: { ...scheme.flows, [PROBE]: { name: 'one node', circuit } } },
      flow: PROBE,
    };
  }, [scheme, flow, probing]);

  /** The box the panel floats over, which is whatever it was put inside. */
  const over = useCallback(() => {
    const box = panel.current?.parentElement?.getBoundingClientRect();
    return { width: box?.width ?? Infinity, height: box?.height ?? Infinity };
  }, []);

  // A window made smaller can leave a panel that was legal where it is not, and
  // a header off the edge is a panel you can never grab again.
  useEffect(() => {
    const settle = () => {
      const box = over();
      setPlace((held) => inside(held, box.width, box.height, LEAST));
    };
    settle();
    window.addEventListener('resize', settle);
    return () => window.removeEventListener('resize', settle);
  }, [over, setPlace]);

  /**
   * One gesture for both handles, because they differ by a single line.
   *
   * Pointer capture rather than listeners on the window: it keeps the drag
   * alive over the canvas underneath — which has pan and zoom gestures of its
   * own that would otherwise start halfway through this one — and it ends the
   * drag correctly when the pointer is lost rather than when a mouseup happens
   * to arrive.
   */
  const grab =
    (resizing: boolean) =>
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      // The header carries a button, and capturing its pointer would swallow the
      // click. Testing for interactive HTML rather than for that one button is
      // the rule `Graph` already uses to decide when a node must not drag.
      if ((event.target as HTMLElement).closest('button')) return;
      event.preventDefault();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      const from = { x: event.clientX, y: event.clientY };
      const was = place;
      const box = over();

      const move = (at: PointerEvent) => {
        const dx = at.clientX - from.x;
        const dy = at.clientY - from.y;
        // Growing is capped by the room to the right and below, not by the
        // container: a panel allowed past the edge would be shoved back left by
        // the clamp, and the corner would slide away from the pointer.
        const next = resizing
          ? {
              ...was,
              w: Math.min(was.w + dx, box.width - was.x),
              h: Math.min(was.h + dy, box.height - was.y),
            }
          : { ...was, x: was.x + dx, y: was.y + dy };
        setPlace(inside(next, box.width, box.height, LEAST));
      };
      const done = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', done);
        handle.removeEventListener('pointercancel', done);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', done);
      handle.addEventListener('pointercancel', done);
    };

  return (
    <div
      ref={panel}
      className="bench"
      style={{ left: place.x, top: place.y, width: place.w, height: place.h }}
    >
      <div
        className="hold"
        data-probing={probing ? '' : undefined}
        onPointerDown={grab(false)}
        title="Drag to move the picture"
      >
        <span className="cap">
          {probing ? showing(scheme.flows[flow]?.circuit ?? EMPTY, probing) : 'the picture'}
        </span>
        <span className="gap" />
        <span className="cap">{aside}</span>
        {probing && (
          <Button tone="quiet" onPress={() => onProbe(null)} title="Back to the finished flow">
            whole flow
          </Button>
        )}
      </div>
      <Bench
        show={show}
        scheme={drawn.scheme}
        flow={drawn.flow}
        clock={clock}
        onError={onError}
      />
      <div
        className="stretch"
        onPointerDown={grab(true)}
        title="Drag to resize the picture"
      />
    </div>
  );
}
