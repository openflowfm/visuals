import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { ON_WALL } from './state/useWall.ts';
import { Boundary } from './ui/Boundary.tsx';

/**
 * The outermost boundary, and the wall's is deliberately silent.
 *
 * React unmounts the whole tree from an uncaught render error, so without one of
 * these the failure mode is a white page. On the console that is worth a
 * sentence and a reload button. On the projector it is not: a wall that has lost
 * its picture should be black, because a paragraph of English thrown twenty feet
 * across a room is worse than nothing at all.
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boundary what="the renderer" quiet={ON_WALL}>
      <App />
    </Boundary>
  </StrictMode>,
);
