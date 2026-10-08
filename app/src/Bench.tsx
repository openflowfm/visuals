import { useEffect, useRef, useState } from 'react';
import * as api from './api.ts';
import { usePlaceBench } from './hooks.ts';

/**
 * Call `then` once the bench is drawing: once `read` (the bench's stats) counts
 * frames. The stats count a second's frames at a time, so this is about a
 * second after the first one, by when the picture is surely on screen. Until
 * then `read` is asked every `every` ms; a failed read (no bench yet) is asked
 * again. Returns a function that stops asking.
 */
export function whenDrawing(read: () => Promise<api.Stats>, then: () => void, every = 250): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ask = () => {
    read().then(
      (s) => {
        if (stopped) return;
        if (s.fps > 0) then();
        else timer = setTimeout(ask, every);
      },
      () => {
        if (!stopped) timer = setTimeout(ask, every);
      },
    );
  };
  ask();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

/**
 * Where the bench goes: the native view the engine draws in is placed under
 * this box, and shows through it. Until the bench has drawn, the box is a plain
 * surface saying the display is loading, so the page never shows a hole; once
 * it draws, the box paints nothing over the picture.
 */
export function Bench({ className }: { className: string }) {
  const ref = useRef<HTMLDivElement>(null);
  usePlaceBench(ref);
  const [drawing, setDrawing] = useState(false);
  useEffect(() => whenDrawing(api.stats, () => setDrawing(true)), []);
  return (
    <div className={className} ref={ref} data-loading={drawing ? undefined : ''}>
      {!drawing && (
        <span className="bench-loading" role="status">
          Loading the display…
        </span>
      )}
    </div>
  );
}
