import { useEffect, useRef, type ReactNode } from 'react';
import type { Circuit, Scheme, Show } from '../../protocol.ts';
import { createPreview } from '../render/preview.ts';
import { probeAt } from './probe.ts';
import type { Clock } from '../state/useShow.ts';
import { withStandIns } from '../state/useRoom.ts';

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
  children,
}: {
  circuit: Circuit;
  show: Show;
  scheme: Scheme;
  transport: Clock;
  children(picture: (nodeId: string) => ReactNode): ReactNode;
}) {
  const offscreen = useRef<HTMLCanvasElement | null>(null);
  const faces = useRef(new Map<string, HTMLCanvasElement>());
  const now = useRef({ circuit, show, scheme, transport });
  now.current = { circuit, show, scheme, transport };

  useEffect(() => {
    const canvas = offscreen.current;
    if (!canvas) return;
    const preview = createPreview(canvas);
    let raf = 0;
    let last = performance.now();

    const loop = (stamp: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min((stamp - last) / 1000, 0.1);
      last = stamp;
      const at = now.current;
      const beat = at.transport.beat();
      preview.begin({
        circuit: at.circuit,
        // The same stand-in set the bench uses, so a look built on the set is
        // not black here and lit there. See [`withStandIns`](../state/useRoom.ts).
        show: withStandIns(at.show, beat),
        scheme: at.scheme,
        beat,
        seconds: at.transport.seconds(),
        dt,
      });
      for (const [id, face] of faces.current) {
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
      ref={(el) => {
        if (el) faces.current.set(id, el);
        else faces.current.delete(id);
      }}
    />
  );

  return (
    <>
      {children(picture)}
      <canvas ref={offscreen} className="probe-canvas" width={SHOT.w} height={SHOT.h} aria-hidden />
    </>
  );
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
