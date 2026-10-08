import { useEffect, useState } from 'react';
import * as api from './api.ts';
import { usePlaceBench } from './hooks.ts';

/**
 * Call `then` once the preview is drawing: once `read` (the engine's stats)
 * counts frames. The stats count a second's frames at a time, so this is about a
 * second after the first one, by when the picture is surely on screen. Until
 * then `read` is asked every `every` ms; a failed read (no engine yet) is asked
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
 * The preview in the box `ref` points at: the native view the engine draws in is
 * placed under it and shows through it. True once it has drawn; until then the
 * box should say it is loading (`Preview` in views.tsx), so the page never shows
 * a hole.
 */
export function usePreview(ref: React.RefObject<HTMLElement | null>): boolean {
  usePlaceBench(ref);
  const [drawing, setDrawing] = useState(false);
  useEffect(() => whenDrawing(api.stats, () => setDrawing(true)), []);
  return drawing;
}
