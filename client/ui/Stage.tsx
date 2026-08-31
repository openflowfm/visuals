import { useEffect, useRef } from 'react';
import type { Scheme, Show } from '../../protocol.ts';
import { createCompositor } from '../render/compositor.ts';
import type { Clock } from '../state/useShow.ts';

/**
 * The whole show, drawn small, against a scheme you hand it.
 *
 * This is what makes an A/B honest. Two of these side by side get the **same
 * show** and the **same clock** and differ only in the scheme, so what you are
 * looking at is the edit and nothing else. Two reactive pictures sampled at two
 * different moments of the music differ for a dozen reasons that have nothing
 * to do with the change, which is the failure mode a naive before-and-after has
 * and the reason it would be worse than no preview at all.
 *
 * **It reads the clock and never advances it.** `App` owns the advance, once per
 * frame, and a stage that also advanced it would run the beat at two or three
 * times tempo the moment a second one appeared — the bug that makes an A/B
 * disagree with the stage it is supposed to be predicting.
 */
export function Stage({
  showRef,
  scheme,
  clock,
  frozen,
  warp,
  className,
}: {
  showRef: { readonly current: Show };
  scheme: Scheme | null;
  clock: Clock;
  /**
   * Hold the picture where it is.
   *
   * A moving frame is the right way to judge a change to something reactive and
   * the wrong way to judge a change to a colour, so the choice is the operator's.
   * The clock keeps running underneath — letting go resumes with the room rather
   * than where the freeze started.
   */
  frozen?: boolean;
  /**
   * Bend the clock without leaving it.
   *
   * `loop 4 bars` is this and nothing else: the same four bars of *motion*
   * repeating, so a change to something that moves can be judged against the
   * same four bars twice rather than against whatever the song does next. The
   * show underneath does not loop — the clips playing are still the clips
   * playing — because looping the set would be a second transport, and this app
   * does not have one of those.
   */
  warp?: (beat: number) => number;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  // Read by the loop rather than closed over: rebuilding the loop on every
  // keystroke in the editor would tear down the GL context and every program
  // with it, which reads as the preview flickering while you type.
  const now = useRef({ scheme, frozen, warp });
  now.current = { scheme, frozen, warp };

  useEffect(() => {
    if (!canvas.current) return;
    let compositor;
    try {
      compositor = createCompositor(canvas.current);
    } catch {
      return;
    }
    const stage = compositor;
    let raf = 0;
    let last = performance.now();

    const loop = (stamp: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min((stamp - last) / 1000, 0.1);
      last = stamp;
      const at = now.current;
      if (at.frozen) return;
      const beat = at.warp ? at.warp(clock.beat()) : clock.beat();
      stage.frame(showRef.current, at.scheme, beat, clock.seconds(), dt);
    };
    raf = requestAnimationFrame(loop);

    const resize = () => stage.resize();
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      stage.free();
    };
  }, [clock, showRef]);

  return <canvas ref={canvas} className={className} />;
}
