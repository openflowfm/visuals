import { Header, Hints, type View } from './views.tsx';

/** Whether the home is ready to be the start view; kept in `homeReady.ts` so `views.tsx` can read it without a circular import. */
export { HOME_READY } from './homeReady.ts';

/**
 * The playlists home (#96): your playlists and what you played last, to pick up
 * where you left off. A placeholder until its 0.5 lane (#96) lands; `HOME_READY`
 * keeps it out of the view switch until then.
 */
export function Home({ start, onMode }: { start: string | null; onMode(view: View, path: string | null): void }) {
  return (
    <div className="app" data-view="home">
      <Header view="home" onChange={(next) => next !== 'home' && onMode(next, start)} />
      <main>
        <p className="home-placeholder">The playlists home is coming in a later 0.5 lane.</p>
      </main>
      <Hints />
    </div>
  );
}
