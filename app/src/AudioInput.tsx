import { useCallback, useEffect, useRef, useState } from 'react';
import { Meter } from '@openflow/widgets/controls/Meter.tsx';
import { Select } from '@openflow/widgets/controls/Select.tsx';
import * as api from './api.ts';
import { meterLevel } from './shell.ts';

/**
 * The left and right levels. A leaf of its own: it re-renders twenty times a
 * second, and nothing else in the header has to.
 */
function Levels() {
  const [[l, r], setLevels] = useState<[number, number]>([0, 0]);
  useEffect(() => {
    let live = true;
    const tick = async () => {
      while (live) {
        const [nl, nr] = await api.levels().catch(() => [0, 0] as [number, number]);
        if (!live) return;
        const next: [number, number] = [meterLevel(nl), meterLevel(nr)];
        // Silence stays silent without a render.
        setLevels((was) => (was[0] === next[0] && was[1] === next[1] ? was : next));
        await new Promise((done) => setTimeout(done, 50));
      }
    };
    tick();
    return () => {
      live = false;
    };
  }, []);
  const hint = 'what the bench hears, left above right: −60 dB empty to 0 dB full';
  return (
    <span className="vf-meters" data-hint={hint}>
      <Meter value={l} label="left level" width={4} length={44} />
      <Meter value={r} label="right level" width={4} length={44} />
    </span>
  );
}

/**
 * What the bench listens to: an input, which two of its channels are left and
 * right, and a meter for each, so a quiet channel is obvious before a preset
 * looks dead. The choice is the app's — it is saved and comes back next launch —
 * so this only reads it and asks for changes.
 *
 * Inputs are told apart by name *and* channel count: macOS names every
 * aggregate device "Aggregate Device".
 */
export function AudioInput({ onError }: { onError(message: string): void }) {
  const [inputs, setInputs] = useState<api.Input[] | null>(null);
  const [heard, setHeard] = useState<api.Heard>({ choice: null, channels: 0 });
  const [problem, setProblem] = useState<string | null>(null);

  // Held in a ref so a caller passing a new function each render doesn't refetch (or loop on a failure).
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const refresh = useCallback(() => api.listening().then(setHeard, (e) => errorRef.current(String(e))), []);

  useEffect(() => {
    api.inputs().then(setInputs, () => setInputs([]));
    refresh();
  }, [refresh]);

  const choice = heard.choice;
  const list = inputs ?? [];
  const current = list.findIndex((i) => i.name === choice?.name && i.channels === choice?.size);

  const choose = (input: api.Input, l: number, r: number) =>
    api.listenTo(input.name, l, r, input.channels).then(
      () => {
        setProblem(null);
        refresh();
      },
      (e) => setProblem(`${input.name}: ${String(e)}`),
    );

  // First run with nothing plugged in: say what to do instead of an empty picker.
  if (inputs && inputs.length === 0) {
    return (
      <span className="audio-input">
        <span
          className="vf-warning"
          title="The presets react to sound. Connect a microphone or an audio interface (or allow microphone access in System Settings › Privacy), then restart."
        >
          no audio input: connect one and restart
        </span>
      </span>
    );
  }

  const count = heard.channels || 2;
  const channels = Array.from({ length: count }, (_, i) => i + 1);
  const channel = (which: 'left' | 'right') => {
    const at = choice?.[which] ?? (which === 'left' ? 1 : 2);
    return (
      <Select
        items={channels.map((n) => `${which === 'left' ? 'L' : 'R'} ${n}`)}
        index={at - 1}
        onChange={(i) => {
          const input = list[current];
          if (!input || !choice) return;
          const n = i + 1;
          choose(input, which === 'left' ? n : choice.left, which === 'right' ? n : choice.right);
        }}
        label={`${which} channel`}
        title={`which of the input's channels the presets hear as ${which}`}
        disabled={!choice || current < 0}
      />
    );
  };

  // An input the app remembers but can't find any more is shown first, by name.
  const missing = current < 0;
  const items = [...(missing ? [choice?.name ? `${choice.name} (not found)` : 'choose an input'] : []), ...list.map((i) => `${i.name} (${i.channels} ch)`)];

  return (
    <span className="audio-input">
      <Select
        items={items}
        index={missing ? 0 : current}
        onChange={(i) => {
          const next = list[missing ? i - 1 : i];
          if (!next) return;
          // Keep the channels when the new input has them — moving between two
          // interfaces wired the same way shouldn't need choosing twice.
          const keep = choice && choice.left <= next.channels && choice.right <= next.channels;
          choose(next, keep ? choice.left : 1, keep ? choice.right : Math.min(2, next.channels));
        }}
        label="audio input"
        title="the audio input the presets react to"
        width={180}
      />
      {channel('left')}
      {channel('right')}
      <Levels />
      {problem && (
        <span className="vf-warning" title={problem}>
          couldn’t switch input
        </span>
      )}
    </span>
  );
}
