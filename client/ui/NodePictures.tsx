import { useEffect, useRef, type ReactNode } from 'react';
import type { Circuit, Scheme, Show } from '../../protocol.ts';
import { createPreview } from '../render/preview.ts';
import { createNumberEvaluator } from '../render/evaluateNumber.ts';
import { probeAt } from './probe.ts';
import {
  drawScope,
  pushScopeSample,
  scopeHead,
  scopeOutlets,
  scopeSweeps,
  type ScopeSample,
} from './scope.ts';
import {
  budgetPictures,
  LIVE_PICTURE_ZOOM_FLOOR,
  type PictureBudget,
} from './pictureBudget.ts';
import type { Clock } from '../state/useShow.ts';
import { withStandIns } from '../state/useRoom.ts';

const FULL_SCALE = () => 1;

export type NodePictureStatus = PictureBudget['counts'] & {
  reason: 'off' | 'zoom' | 'budget' | null;
};

/**
 * A picture per node, out of one GL context — and a scope where the output is
 * a number.
 *
 * Each face shows what *that node* has made, not a thumbnail of the finished
 * flow — a dozen copies of the same image would teach nothing, while a picture
 * per step turns the canvas into something you can read along the chain.
 * [`probe.ts`](./probe.ts) builds each one by cutting the circuit off at an
 * outlet and bringing the result back to a colour through the vocabulary's own
 * two crossings.
 *
 * **A number outlet is not brought to a colour any more.** Its face is an
 * oscilloscope — see [`scope.ts`](./scope.ts) for why and for the geometry —
 * drawn straight into the face's 2D canvas from this component's own CPU
 * evaluator. Its own rather than the page's, deliberately: the evaluator's
 * track envelopes advance by the `dt` each caller passes, so one instance
 * shared between this 60 fps loop and the 10 Hz readout latch would step its
 * envelopes twice. Two instances, each self-consistent, is the arrangement
 * that cannot drift. Scope faces obey the same on-switch, zoom floor and
 * visibility as the pictures, but not the GL budget — a polyline is not a GL
 * draw, so a scope never spends a slot a picture could use.
 *
 * **One context, blitted per live node.** A context each is the obvious build
 * and the wrong one: browsers keep about sixteen alive and start evicting the
 * oldest, and this page already has a bench and, on the binding side, two more
 * stages. So one offscreen context draws the visible nodes that fit the budget
 * and each frame is copied into that node's own small 2D canvas. The others
 * keep their last frame, visibly paused, without another context or GL draw.
 *
 * It renders through a child function rather than owning the canvas, because
 * what a node *is* belongs to the graph and what a node *looks like* belongs
 * here, and the two should not have to know each other.
 *
 * **It takes the room, not a pair of numbers.** These faces are the thing you
 * click to promote into the big picture, so a face that was drawn under
 * different conditions from the bench makes that gesture lie — see
 * [`preview.ts`](../render/preview.ts). One `Show` and one `Scheme` in, exactly
 * as the bench takes, and nothing here is left to choose a colour or a tempo of
 * its own.
 */
export function NodePictures({
  circuit,
  show,
  scheme,
  transport,
  enabled = true,
  scale = FULL_SCALE,
  promoted = null,
  onStatus,
  children,
}: {
  circuit: Circuit;
  show: Show;
  scheme: Scheme;
  transport: Clock;
  /** One switch for every small picture. The shared preview stays allocated. */
  enabled?: boolean;
  /** Read the graph's current scale without making wheel movement React state. */
  scale?: () => number;
  /** The node shown in the large bench, which keeps one of the live slots. */
  promoted?: string | null;
  /** Called only when the aggregate state changes, never once per frame. */
  onStatus?(status: NodePictureStatus): void;
  children(picture: (nodeId: string) => ReactNode): ReactNode;
}) {
  const offscreen = useRef<HTMLCanvasElement | null>(null);
  const faces = useRef(new Map<string, HTMLCanvasElement>());
  const faceRefs = useRef(new Map<string, (element: HTMLCanvasElement | null) => void>());
  const faceIds = useRef(new WeakMap<HTMLCanvasElement, string>());
  const visible = useRef(new Set<string>());
  const observer = useRef<IntersectionObserver | null>(null);
  const now = useRef({ circuit, show, scheme, transport, enabled, scale, promoted, onStatus });
  const lastStatus = useRef<NodePictureStatus | undefined>(undefined);
  now.current = { circuit, show, scheme, transport, enabled, scale, promoted, onStatus };

  useEffect(() => {
    const first = faces.current.values().next().value;
    const root = first?.closest('.wdg-graph') ?? null;
    if (!root || typeof IntersectionObserver === 'undefined') return;

    const watch = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = faceIds.current.get(entry.target as HTMLCanvasElement);
          if (!id) continue;
          if (entry.isIntersecting) visible.current.add(id);
          else visible.current.delete(id);
        }
      },
      { root },
    );
    observer.current = watch;
    for (const face of faces.current.values()) watch.observe(face);

    return () => {
      watch.disconnect();
      observer.current = null;
    };
  }, []);

  useEffect(() => {
    const canvas = offscreen.current;
    if (!canvas) return;
    const preview = createPreview(canvas);
    const numbers = createNumberEvaluator();
    const traces = new Map<string, ScopeSample[]>();
    let scopesFor: Circuit | null = null;
    let scopes = new Map<string, string>();
    const traceColor =
      getComputedStyle(document.documentElement).getPropertyValue('--signal-n').trim() ||
      '#f7c65a';
    let raf = 0;
    let last = performance.now();

    const loop = (stamp: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min((stamp - last) / 1000, 0.1);
      last = stamp;
      const at = now.current;
      const beat = at.transport.beat();
      const seconds = at.transport.seconds();
      // The same stand-in set the bench uses, so a flow built on the set is
      // not black here and lit there. See [`withStandIns`](../state/useRoom.ts).
      const show = withStandIns(at.show, beat);
      const inputs = { show, beat, seconds, dt, pace: at.scheme.defaults.pace };

      // Which faces are scopes is a fact about the wiring, so it is settled
      // once per circuit rather than asked again every frame.
      if (scopesFor !== at.circuit) {
        scopes = scopeOutlets(at.circuit, numbers.sample(at.circuit, inputs));
        scopesFor = at.circuit;
        const kept = new Set(scopes.values());
        for (const id of [...traces.keys()]) if (!kept.has(id)) traces.delete(id);
      }

      const ids = at.circuit.nodes.map((node) => node.id).filter((id) => faces.current.has(id));
      const scoped = ids.filter((id) => scopes.has(id));
      const zoom = at.scale();
      const budget = budgetPictures({
        ids: ids.filter((id) => !scopes.has(id)),
        visible: visible.current,
        promoted: at.promoted,
        out: at.circuit.nodes.find((node) => node.kind === 'out')?.id,
        enabled: at.enabled,
        scale: zoom,
      });
      const scopesOn = at.enabled && zoom >= LIVE_PICTURE_ZOOM_FLOOR;
      const live = new Set(budget.live);
      const paused = new Set(budget.paused);
      for (const [id, face] of faces.current) {
        const state = scopes.has(id)
          ? visible.current.has(id)
            ? scopesOn
              ? 'live'
              : 'paused'
            : 'culled'
          : live.has(id)
            ? 'live'
            : paused.has(id)
              ? 'paused'
              : 'culled';
        markFace(face, state);
      }
      const scopeShown = scoped.filter((id) => visible.current.has(id));
      publishStatus(lastStatus, at.onStatus, {
        mounted: ids.length,
        visible: budget.counts.visible + scopeShown.length,
        live: budget.counts.live + (scopesOn ? scopeShown.length : 0),
        paused: budget.counts.paused + (scopesOn ? 0 : scopeShown.length),
        culled: budget.counts.culled + (scoped.length - scopeShown.length),
        reason: !at.enabled
          ? 'off'
          : zoom < LIVE_PICTURE_ZOOM_FLOOR
            ? 'zoom'
            : budget.counts.paused > 0
              ? 'budget'
              : null,
      });

      if (scopesOn && scoped.length > 0) {
        const sample = numbers.sample(at.circuit, inputs);
        const quantum = Math.max(1, Math.round(show.quantum || 4));
        for (const id of scoped) {
          const outlet = scopes.get(id);
          if (!outlet) continue;
          const value = sample.outlet(outlet);
          let buffer = traces.get(outlet);
          if (!buffer) traces.set(outlet, (buffer = []));
          // Sampled even off-screen, so scrolling a face away and back does
          // not put a hole in its trace; only the drawing waits for the eye.
          pushScopeSample(buffer, { beat, value: value ?? null }, quantum);
          const face = faces.current.get(id);
          if (!face || !visible.current.has(id)) continue;
          drawScope(
            face,
            scopeSweeps(buffer, quantum),
            scopeHead(beat, value, quantum),
            quantum,
            traceColor,
          );
        }
      }

      // Every gate is before the feed, the graph probe and the GL draw. One
      // empty frame therefore costs one small schedule and nothing in WebGL.
      if (budget.live.length === 0) return;
      preview.begin({
        circuit: at.circuit,
        show,
        scheme: at.scheme,
        beat,
        seconds,
        dt,
      });
      for (const id of budget.live) {
        const face = faces.current.get(id);
        if (!face) continue;
        const probed = probeAt(at.circuit, id);
        if (!probed) continue;
        preview.draw(probed);
        const ctx = face.getContext('2d');
        if (!ctx) continue;
        ctx.drawImage(canvas, 0, 0, face.width, face.height);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      preview.free();
    };
  }, []);

  const picture = (id: string) => (
    <canvas
      key={id}
      className="nodeshot"
      width={FACE.w}
      height={FACE.h}
      data-picture-state="live"
      ref={refFor(id, faces, faceRefs, faceIds, visible, observer)}
    />
  );

  return (
    <>
      {children(picture)}
      <canvas ref={offscreen} className="probe-canvas" width={SHOT.w} height={SHOT.h} aria-hidden />
    </>
  );
}

type FaceState = 'live' | 'paused' | 'culled';

/** Mark a frozen frame once; a resumed GL blit replaces the label completely. */
function markFace(face: HTMLCanvasElement, state: FaceState): void {
  if (face.dataset.pictureState === state) return;
  face.dataset.pictureState = state;
  if (state !== 'paused') return;
  const ctx = face.getContext('2d');
  if (!ctx) return;
  const width = 58;
  const height = 18;
  const x = (face.width - width) / 2;
  const y = (face.height - height) / 2;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = '#fff';
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('paused', face.width / 2, face.height / 2);
}

function refFor(
  id: string,
  faces: { current: Map<string, HTMLCanvasElement> },
  refs: { current: Map<string, (element: HTMLCanvasElement | null) => void> },
  ids: { current: WeakMap<HTMLCanvasElement, string> },
  visible: { current: Set<string> },
  observer: { current: IntersectionObserver | null },
): (element: HTMLCanvasElement | null) => void {
  let ref = refs.current.get(id);
  if (ref) return ref;
  ref = (element) => {
    const before = faces.current.get(id);
    if (before) {
      observer.current?.unobserve(before);
      ids.current.delete(before);
    }
    if (element) {
      faces.current.set(id, element);
      ids.current.set(element, id);
      // Fail open until an observer reports otherwise, and forever in a
      // browser without IntersectionObserver.
      visible.current.add(id);
      observer.current?.observe(element);
    } else {
      faces.current.delete(id);
      visible.current.delete(id);
    }
  };
  refs.current.set(id, ref);
  return ref;
}

function publishStatus(
  last: { current: NodePictureStatus | undefined },
  callback: ((status: NodePictureStatus) => void) | undefined,
  status: NodePictureStatus,
): void {
  const before = last.current;
  if (
    before &&
    before.mounted === status.mounted &&
    before.visible === status.visible &&
    before.live === status.live &&
    before.paused === status.paused &&
    before.culled === status.culled &&
    before.reason === status.reason
  ) {
    return;
  }
  last.current = status;
  callback?.(status);
}

/**
 * The shape of a face, and it is the wall's.
 *
 * Sixteen by nine because that is what the picture is going to be projected as,
 * and because a face whose shape disagrees with the bench's is a face you cannot
 * compare to it. It used to be a 300×150 buffer squeezed into a 104×58 canvas
 * and then cropped to a 34-pixel strip by `object-fit`, which between them
 * turned every circle into an ellipse and threw away the top and bottom of the
 * frame.
 */
const FACE = { w: 208, h: 117 };

/**
 * The buffer every face is drawn in before it is blitted down.
 *
 * Bigger than a face, because one canvas serves them all and a node is as wide
 * as its faceplate makes it. Downsampling into the 2D canvas is also the only
 * antialiasing anything here gets: the context is `antialias: false` and every
 * picture is procedural, so a hard edge drawn at face size crawls.
 */
const SHOT = { w: 320, h: 180 };
