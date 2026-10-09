/**
 * Whether the playlists home (#96) is ready to be the app's start view. Its own
 * module, with no imports, so `views.tsx` can read it while building the view
 * list without a circular import through `Home.tsx` (which uses the views'
 * header). The home lane turns it on when the home is done.
 */
export const HOME_READY: boolean = false;
