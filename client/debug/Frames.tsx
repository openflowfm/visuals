import { useEffect, useRef, useState } from 'react';
import { Facts, type Fact } from '@openflow/widgets/debug/Facts.tsx';
import { Group, Harness, Shelf, Status, Toolbar } from '@openflow/widgets/debug/Harness.tsx';
import { Plot } from '@openflow/widgets/debug/Plot.tsx';
import { inkOf } from '@openflow/widgets/debug/ink.ts';
import type { FrameStats } from '../render/meter.ts';

/**
 * What the compositor measured, and what it has been measuring.
 *
 * The stats arrive as a window already reduced to percentiles, which is the
 * right thing to quote and the wrong thing to watch: a rig that was fine and
 * went wrong looks identical to one that has been wrong all along. So the
 * readings are kept as they come in and drawn — the shape over the last minute
 * is what says whether a number is a state or an event.
 */

/** Two minutes at one reading every half second, which is what the app sends. */
const KEPT = 240;

const ms = (n: number) => `${n.toFixed(1)} ms`;

export function Frames({ frames, glError }: { frames: FrameStats | null; glError: string | null }) {
  const history = useRef<FrameStats[]>([]);
  const [, redraw] = useState(0);

  useEffect(() => {
    if (!frames) return;
    history.current = [...history.current, frames].slice(-KEPT);
    redraw((n) => n + 1);
  }, [frames]);

  const kept = history.current;
  const late = frames ? frames.lateShare : 0;
  const items: Fact[] = frames
    ? [
        { name: 'rate', value: `${frames.hz.toFixed(1)} Hz` },
        { name: 'frames', value: frames.frames, title: 'In the measured window' },
        { name: 'late', value: `${(late * 100).toFixed(1)}%`, tone: late > 0.01 ? 'bad' : 'good' },
        { name: 'interval p50', value: ms(frames.interval.p50) },
        { name: 'interval p99', value: ms(frames.interval.p99), tone: 'quiet' },
        { name: 'cpu p50', value: ms(frames.cpu.p50) },
        { name: 'cpu p99', value: ms(frames.cpu.p99), tone: 'quiet' },
        {
          name: 'gpu p50',
          value: frames.gpu ? ms(frames.gpu.p50) : 'not reported',
          tone: frames.gpu ? 'normal' : 'quiet',
          title: frames.gpu ? undefined : 'The driver will not say',
        },
      ]
    : [{ name: 'frames', value: 'nothing measured yet', tone: 'quiet' }];

  return (
    <Harness
      title="Frames"
      status={
        glError ? (
          <Status tone="bad">{glError}</Status>
        ) : frames && late > 0.01 ? (
          <Status tone="bad">dropping</Status>
        ) : (
          <Status tone="good">keeping up</Status>
        )
      }
    >
      <Toolbar>
        <Group caption="Window">
          <Status tone="quiet">{kept.length} readings kept</Status>
        </Group>
      </Toolbar>
      <Shelf>
        <Facts items={items} />
      </Shelf>
      <Plot
        title="Interval, over the readings kept"
        height={130}
        caption="The median in full, the 99th behind it. A projector shows the 99th."
        draw={(g, width, height) => {
          if (kept.length < 2) return;
          // Scaled to the worst 99th in the window rather than to a fixed
          // ceiling: a rig at 144Hz and one at 30 are both worth reading, and
          // neither should draw as a flat line at the bottom.
          const top = Math.max(...kept.map((one) => one.interval.p99), 20) * 1.15;
          const at = (i: number) => (i / (kept.length - 1)) * width;
          const y = (v: number) => height - 4 - (v / top) * (height - 12);

          for (const [pick, ink, wide] of [
            [(one: FrameStats) => one.interval.p99, 'caption', 1],
            [(one: FrameStats) => one.interval.p50, 'fill', 1.5],
          ] as const) {
            g.strokeStyle = inkOf(g.canvas, ink);
            g.lineWidth = wide;
            g.beginPath();
            kept.forEach((one, i) => (i ? g.lineTo(at(i), y(pick(one))) : g.moveTo(at(i), y(pick(one)))));
            g.stroke();
          }

          // Where a 60Hz frame lands, so a reading is placed rather than read.
          g.strokeStyle = inkOf(g.canvas, 'edge');
          g.setLineDash([3, 3]);
          g.beginPath();
          g.moveTo(0, Math.round(y(1000 / 60)) + 0.5);
          g.lineTo(width, Math.round(y(1000 / 60)) + 0.5);
          g.stroke();
          g.setLineDash([]);
        }}
      />
    </Harness>
  );
}
