import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from './api.ts';

/** A peak as a meter reads it: in decibels, −60 dB empty to 0 dB full. A linear
 * meter shows a signal at −30 dB as a one-pixel sliver. */
const fill = (peak: number) => Math.round(Math.max(0, Math.min(1, 1 + (20 * Math.log10(Math.max(peak, 1e-6))) / 60)) * 100);

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
  const [inputs, setInputs] = useState<api.Input[]>([]);
  const [heard, setHeard] = useState<api.Heard>({ choice: null, channels: 0 });
  const [problem, setProblem] = useState<string | null>(null);
  const left = useRef<HTMLSpanElement>(null);
  const right = useRef<HTMLSpanElement>(null);

  const refresh = useCallback(() => api.listening().then(setHeard, (e) => onError(String(e))), [onError]);

  useEffect(() => {
    api.inputs().then(setInputs, () => {});
    refresh();
  }, [refresh]);

  // The meters, written straight to the DOM: twenty updates a second through
  // React state would re-render the header for a bar's width.
  useEffect(() => {
    let live = true;
    const tick = async () => {
      while (live) {
        const [l, r] = await api.levels().catch(() => [0, 0] as [number, number]);
        if (left.current) left.current.style.width = `${fill(l)}%`;
        if (right.current) right.current.style.width = `${fill(r)}%`;
        await new Promise((done) => setTimeout(done, 50));
      }
    };
    tick();
    return () => {
      live = false;
    };
  }, []);

  const choice = heard.choice;
  const current = inputs.findIndex((i) => i.name === choice?.name && i.channels === choice?.size);

  const choose = (input: api.Input, l: number, r: number) =>
    api.listenTo(input.name, l, r, input.channels).then(
      () => {
        setProblem(null);
        refresh();
      },
      (e) => setProblem(`${input.name}: ${String(e)}`),
    );

  const count = heard.channels || 2;
  const channel = (which: 'left' | 'right') => (
    <select
      value={choice?.[which] ?? (which === 'left' ? 1 : 2)}
      onChange={(e) => {
        const at = inputs[current];
        if (!at || !choice) return;
        const n = Number(e.target.value);
        choose(at, which === 'left' ? n : choice.left, which === 'right' ? n : choice.right);
      }}
      title={`${which} channel`}
      disabled={!choice || current < 0}
    >
      {Array.from({ length: count }, (_, i) => i + 1).map((n) => (
        <option key={n} value={n}>
          {which === 'left' ? 'L' : 'R'} {n}
        </option>
      ))}
    </select>
  );

  return (
    <span className="audio-input">
      <select
        value={current}
        onChange={(e) => {
          const next = inputs[Number(e.target.value)];
          if (!next) return;
          // Keep the channels when the new input has them — moving between two
          // interfaces wired the same way shouldn't need choosing twice.
          const keep = choice && choice.left <= next.channels && choice.right <= next.channels;
          choose(next, keep ? choice.left : 1, keep ? choice.right : Math.min(2, next.channels));
        }}
        title="audio input"
      >
        {current < 0 && <option value={-1}>{choice?.name ?? 'no input'}</option>}
        {inputs.map((i, n) => (
          <option key={`${n}:${i.name}`} value={n}>
            {i.name} ({i.channels} ch)
          </option>
        ))}
      </select>
      {channel('left')}
      {channel('right')}
      <span className="audio-meters" title="left and right level">
        <span>
          <span ref={left} />
        </span>
        <span>
          <span ref={right} />
        </span>
      </span>
      {problem && (
        <span className="problem" title={problem}>
          couldn’t switch input
        </span>
      )}
    </span>
  );
}
