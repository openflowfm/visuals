import { useEffect, useRef, type ReactNode } from 'react';
import type { Circuit, LookDef } from '../../protocol.ts';
import { createPreview } from '../render/preview.ts';
import { probeAt } from './probe.ts';
import type { Clock } from '../state/useShow.ts';

/**
 * A picture per node, out of one GL context.
 *
 * Each face shows what *that node* has made, not a thumbnail of the finished
 * look — a dozen copies of the same image would teach nothing, while a picture
 * per step turns the canvas into something you can read along the chain.
 * [`probe.ts`](./probe.ts) builds each one by cutting the circuit off at an
 * outlet and bringing the result back to a colour through the vocabulary's own
 * two crossings.
 *
 * **One context, blitted per node.** A context each is the obvious build and the
 * wrong one: browsers keep about sixteen alive and start evicting the oldest,
 * and this page already has a bench and, on the binding side, two more stages.
 * So one offscreen context draws every node in turn and each frame is copied
 * into that node's own small 2D canvas — one texture copy per node and no extra
 * contexts at all.
 *
 * It renders through a child function rather than owning the canvas, because
 * what a node *is* belongs to the graph and what a node *looks like* belongs
 * here, and the two should not have to know each other.
 */
export function NodePictures({
  circuit,
  looks,
  transport,
  energy,
  level,
  children,
}: {
  circuit: Circuit;
  /** The library, so a face showing a `look` node is not black. See `preview.ts`. */
  looks: Record<string, LookDef>;
  transport: Clock;
  energy: number;
  /** A held meter, or undefined to run the beat envelope the bench runs. */
  level?: number;
  children(picture: (nodeId: string) => ReactNode): ReactNode;
}) {
  const offscreen = useRef<HTMLCanvasElement | null>(null);
  const faces = useRef(new Map<string, HTMLCanvasElement>());
  const now = useRef({ circuit, looks, transport, energy, level });
  now.current = { circuit, looks, transport, energy, level };

  useEffect(() => {
    const canvas = offscreen.current;
    if (!canvas) return;
    const preview = createPreview(canvas);
    let raf = 0;

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const at = now.current;
      const beat = at.transport.beat();
      for (const [id, face] of faces.current) {
        const probed = probeAt(at.circuit, id);
        if (!probed) continue;
        preview.frame({
          circuit: probed,
          looks: at.looks,
          energy: at.energy,
          level: at.level ?? 0.25 + 0.75 * (1 - (beat % 1)) ** 3,
          color: 0xffb347,
          pace: 0,
          quantum: 4,
          beat,
          seconds: at.transport.seconds(),
        });
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
      width={104}
      height={58}
      ref={(el) => {
        if (el) faces.current.set(id, el);
        else faces.current.delete(id);
      }}
    />
  );

  return (
    <>
      {children(picture)}
      <canvas ref={offscreen} className="probe-canvas" aria-hidden />
    </>
  );
}
