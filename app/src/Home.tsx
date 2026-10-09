import { Header, Hints, type View } from './views.tsx';

/** Whether the home is ready to be the start view; kept in `homeReady.ts` so `views.tsx` can read it without a circular import. */
export { HOME_READY } from './homeReady.ts';

/**
 * The playlists home (#96): your playlists and what you played last, to pick up
 * where you left off. A placeholder until 0.5; `HOME_READY` keeps it out of the
 * view switch until then.
 */
export function Home({ start, onMode }: { start: string | null; onMode(view: View, path: string | null): void }) {
  return (
    <div className="app" data-view="home">
      <Header view="home" onChange={(next) => next !== 'home' && onMode(next, start)} />
      <main>
        <p className="home-placeholder">Playlists home comes in 0.5.</p>
      </main>
      <Hints />
    </div>
  );
}
