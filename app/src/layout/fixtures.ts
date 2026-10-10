/**
 * What the macOS layout's stories run on (only `app/src/layout/*.stories.tsx`
 * import this): the shared fixtures (`app/src/stories/fixtures.ts`) shaped as
 * the layout's parts take them, so the shell's story and each part's own tell
 * the same moment: Warm-up playing its third preset.
 */
import type { LibraryRow } from '../api.ts';
import { playsFrom } from '../home.ts';
import { DATA, LISTS, PLAYING_DECK, PLAYLISTS, RECENT, ROWS, STILL, WARM_UP } from '../stories/fixtures.ts';
import { sidebarSections, type SidebarSection } from './InsetSidebar.tsx';

/** The index's row for a preset's path, when the slice has it. */
export const rowAt = (path: string): LibraryRow | null => ROWS.find((r) => r.path === path) ?? null;
const rowsAt = (paths: readonly string[]): LibraryRow[] => paths.map(rowAt).filter((r): r is LibraryRow => r !== null);

/** The preset playing, the preview's picture, and where it plays from. */
export const NOW = {
  preset: PLAYING_DECK.current ? rowAt(PLAYING_DECK.current) : null,
  picture: STILL,
  playing: PLAYING_DECK.auto && !PLAYING_DECK.hold,
  from: playsFrom(PLAYING_DECK, PLAYLISTS),
  path: PLAYING_DECK.current,
};

/** The starred presets' keys. */
export const STARRED: string[] = Object.entries(DATA.presets)
  .filter(([, p]) => p.star)
  .map(([key]) => key);

/** The sidebar's sections, with the library's and the starred counts. */
export const SIDEBAR: SidebarSection[] = sidebarSections(LISTS, { library: ROWS.length, starred: STARRED.length });

/** The main column's sections: recently played, the playlist playing, a style. */
export const SECTIONS: { title: string; rows: LibraryRow[] }[] = [
  { title: 'Recently played', rows: rowsAt(RECENT) },
  { title: WARM_UP.name, rows: rowsAt(WARM_UP.items.map((i) => i.path)) },
  { title: 'Hypnotic', rows: ROWS.filter((r) => r.style === 'Hypnotic') },
];
