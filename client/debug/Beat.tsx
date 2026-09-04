import { useEffect, useRef, useState } from 'react';
import { Facts, type Fact } from '@openflow/widgets/debug/Facts.tsx';
import { Group, Harness, Shelf, Status, Toolbar } from '@openflow/widgets/debug/Harness.tsx';
import { Legend } from '@openflow/widgets/debug/Legend.tsx';
import { Plot } from '@openflow/widgets/debug/Plot.tsx';
import { Toggle } from '@openflow/widgets/controls/Toggle.tsx';
import { inkOf } from '@openflow/widgets/debug/ink.ts';
import type { Show } from '../../protocol.ts';
import type { Clock } from '../state/useShow.ts';

/**
 * The clock, drawn rather than stated.
 *
 * A tempo reads fine while the thing it describes is wrong. What a show
 * actually needs to know is whether the beat is *advancing evenly* — a Link
 * peer that joins, a tab that was backgrounded, a frame that took 300ms all
 * show up as a step or a kink here and as nothing at all in a number.
 *
 * So this samples `beat()` against the wall clock every frame and draws the two
 * against each other. Steady is a straight ramp. Anything else is the thing
 * that was wrong, at the moment it went wrong.
 */

/** Ten seconds at 60Hz, which is long enough to see a correction settle. */
const KEPT = 600;

interface Sample {
  beat: number;
  at: number;
}

export function Beat({ clock, show }: { clock: Clock; show: Show }) {
  const kept = useRef<Sample[]>([]);
  const [running, setRunning] = useState(true);
  const [, redraw] = useState(0);

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    const started = performance.now();
    const tick = () => {
      kept.current = [
        ...kept.current,
        { beat: clock.beat(), at: (performance.now() - started) / 1000 },
      ].slice(-KEPT);
      redraw((n) => n + 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [clock, running]);

  const samples = kept.current;
  const first = samples[0];
  const last = samples[samples.length - 1];
  // Beats per second measured off the window, against what Link says the tempo
  // is. The two disagreeing is the whole reason to draw this.
  const measured =
    first && last && last.at > first.at ? ((last.beat - first.beat) / (last.at - first.at)) * 60 : 0;
  const drift = show.tempo ? measured - show.tempo : 0;

  const items: Fact[] = [
    { name: 'link', value: show.clock ? `${show.peers} peer${show.peers === 1 ? '' : 's'}` : 'not joined', tone: show.clock ? 'good' : 'bad' },
    { name: 'tempo', value: `${show.tempo.toFixed(2)} bpm` },
    { name: 'measured', value: measured ? `${measured.toFixed(2)} bpm` : '—', tone: Math.abs(drift) > 0.5 ? 'bad' : 'good' },
    { name: 'drift', value: measured ? `${drift >= 0 ? '+' : ''}${drift.toFixed(2)}` : '—', tone: 'quiet' },
    { name: 'quantum', value: show.quantum },
    { name: 'phase', value: (((clock.beat() % show.quantum) + show.quantum) % show.quantum).toFixed(2) },
  ];

  return (
    <Harness
      title="Beat"
      status={show.clock ? <Status tone="good">on link</Status> : <Status tone="bad">free running</Status>}
    >
      <Toolbar>
        <Group caption="Sampling">
          <Toggle on={running} onChange={setRunning} label="Sample every frame">
            live
          </Toggle>
        </Group>
        <Group caption="Window">
          <Status tone="quiet">{samples.length} frames</Status>
        </Group>
        <Group caption="Key">
          <Legend
            items={[
              { kind: 'line', ink: 'var(--wdg-fill)', label: 'beats' },
              { kind: 'dashed', ink: 'var(--wdg-caption)', label: 'steady, at the reported tempo' },
            ]}
          />
        </Group>
      </Toolbar>
      <Shelf>
        <Facts items={items} />
      </Shelf>
      <Plot
        title="Beats against the wall clock"
        height={150}
        caption="A steady clock is a straight ramp. A step or a kink is the moment it was corrected."
        draw={(g, width, height) => {
          if (samples.length < 2 || !first || !last) return;
          const span = Math.max(0.001, last.at - first.at);
          const low = first.beat;
          const high = Math.max(last.beat, low + 0.001);
          const at = (s: Sample) => ((s.at - first.at) / span) * width;
          const y = (beat: number) => height - 6 - ((beat - low) / (high - low)) * (height - 14);

          // What it would be if it never moved off the reported tempo.
          g.strokeStyle = inkOf(g.canvas, 'caption');
          g.setLineDash([4, 4]);
          g.beginPath();
          g.moveTo(0, y(low));
          g.lineTo(width, y(low + (show.tempo / 60) * span));
          g.stroke();
          g.setLineDash([]);

          g.strokeStyle = inkOf(g.canvas, 'fill');
          g.lineWidth = 1.5;
          g.beginPath();
          samples.forEach((s, i) => (i ? g.lineTo(at(s), y(s.beat)) : g.moveTo(at(s), y(s.beat))));
          g.stroke();
        }}
      />
    </Harness>
  );
}
