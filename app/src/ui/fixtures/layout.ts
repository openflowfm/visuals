/**
 * What the macOS layout's stories run on: the shared fixtures (`./fixtures.ts`)
 * shaped as the layout's parts take them, so the shell's story and each part's
 * own tell the same moment: Warm-up playing its third preset.
 *
 * A port of visual[flow]'s `app/src/layout/fixtures.ts`: the same exports.
 */
import type { LibraryRow } from '../model/api';
import { playsFrom } from '../model/home';
import { sidebarSections, type SidebarSection } from '../model/sidebar-model';
import { DATA, LISTS, PLAYING_DECK, PLAYLISTS, ROWS, STILL } from './fixtures';

/** The index's row for a preset's path, when the slice has it. */
export const rowAt = (path: string): LibraryRow | null => ROWS.find((r) => r.path === path) ?? null;

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
