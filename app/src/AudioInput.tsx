import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from './api.ts';

/**
 * What the bench listens to: an input, which two of its channels are left and
 * right, and a meter for each, so a quiet channel is obvious before a preset
 * looks dead. The choice is the app's — it is saved and comes back next launch —
 * so this only reads it and asks for changes.
 */
export function AudioInput({ onError }: { onError(message: string): void }) {
  const [inputs, setInputs] = useState<api.Input[]>([]);
  const [heard, setHeard] = useState<api.Heard>({ choice: null, channels: 0 });
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
        if (left.current) left.current.style.width = `${Math.round(l * 100)}%`;
        if (right.current) right.current.style.width = `${Math.round(r * 100)}%`;
        await new Promise((done) => setTimeout(done, 50));
      }
    };
    tick();
    return () => {
      live = false;
    };
  }, []);

  const choose = (name: string | null, l: number, r: number) =>
    api.listenTo(name, l, r).then(refresh, (e) => onError(String(e)));

  const choice = heard.choice;
  const name = choice?.name ?? '';
  const count = inputs.find((i) => i.name === name)?.channels || heard.channels || 2;
  const channel = (which: 'left' | 'right') => (
    <select
      value={choice?.[which] ?? (which === 'left' ? 1 : 2)}
      onChange={(e) => {
        const n = Number(e.target.value);
        choose(name || null, which === 'left' ? n : (choice?.left ?? 1), which === 'right' ? n : (choice?.right ?? 2));
      }}
      title={`${which} channel`}
      disabled={!choice}
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
        value={name}
        onChange={(e) => {
          // A different input starts on its first two channels.
          const next = inputs.find((i) => i.name === e.target.value);
          choose(e.target.value, 1, next && next.channels >= 2 ? 2 : 1);
        }}
        title="audio input"
      >
        {!inputs.some((i) => i.name === name) && <option value={name}>{name || 'no input'}</option>}
        {inputs.map((i, n) => (
          <option key={`${n}:${i.name}`} value={i.name}>
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
    </span>
  );
}
