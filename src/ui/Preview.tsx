import { useEffect, useRef } from 'react';
import type { LookDef } from '../../protocol.ts';
import { createPreview } from '../render/preview.ts';
import type { Clock } from '../state/useShow.ts';

/**
 * A stack of looks, drawn on the show's clock.
 *
 * Editing a shader against the stage means editing something you cannot see:
 * the panel is over it, the section's energy may have dialled the effect to
 * nothing, and the layer carrying it may not be playing. So the bench draws its
 * own frame — but on **Link's beat**, so a wave wired to the beat is in time
 * with the room while you build it, which is the whole difference between this
 * and a shader toy.
 *
 * The meter is synthetic and deliberately so. A real one would be some track's,
 * and picking which track is a question with no good answer here; a pulse on
 * each beat shows what `level` does to the picture without pretending to be a
 * measurement.
 */
export function Preview({
  stack,
  energy,
  color,
  pace,
  quantum,
  clock,
  meters,
  onError,
}: {
  /** The stack, bottom first. One look is a stack of one; several is a composition. */
  stack: readonly { def: LookDef; amount: number }[];
  energy: number;
  color: number;
  pace: number;
  quantum: number;
  clock: Clock;
  /** Real meters, by track name, for a look that named one. See `PreviewFrame`. */
  meters?: (name: string) => number;
  onError(next: string | null): void;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  // Read by the loop rather than closed over, so changing a knob doesn't tear
  // down the GL context and rebuild every program.
  const now = useRef({ stack, energy, color, pace, quantum, meters, onError });
  now.current = { stack, energy, color, pace, quantum, meters, onError };

  useEffect(() => {
    if (!canvas.current) return;
    const preview = createPreview(canvas.current);
    let raf = 0;
    let said: string | null = null;

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const at = now.current;
      const beat = clock.beat();
      preview.frame({
        stack: at.stack,
        energy: at.energy,
        level: 0.25 + 0.75 * (1 - (beat % 1)) ** 3,
        color: at.color,
        pace: at.pace,
        quantum: at.quantum,
        beat,
        seconds: clock.seconds(),
        meters: at.meters,
      });
      // Only on a change: a driver message arriving sixty times a second would
      // re-render the pane sixty times a second.
      if (preview.error !== said) {
        said = preview.error;
        at.onError(said);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      preview.free();
    };
  }, [clock]);

  return <canvas ref={canvas} className="preview" />;
}
