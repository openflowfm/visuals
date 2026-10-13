/**
 * What the layout's stories (only they import this) put in the main column
 * under the hero: a region of today's tiles, wrapping, as tall as its presets
 * make it, so the column scrolls under the pinned hero. The app's own column is
 * Library's grid; this stands in for it so the layout's stories need none of
 * its wiring.
 *
 * A port of visual[flow]'s `app/src/layout/StoryGrid.tsx`: the same props. It
 * reads `--lay-tile` and `--lay-tile-gap`, which the home layout's stylesheet
 * declares, as the original's layout.css did.
 */
import type { KeyboardEvent } from 'react';
import type { LibraryRow } from '../model/api';
import { PresetTile, tileBy, tileName } from '../PresetTile/PresetTile';

/** What a tile says when pointed at, and to a screen reader: its name, style and authors (" — " between), then what's true of it now. */
function says(row: LibraryRow, playing: boolean, starred: boolean): string {
  const authors = row.authors.filter((a) => a.trim() && a.trim().toLowerCase() !== 'unknown');
  const full = `${tileName(row.title, row.path)} — ${row.style}${authors.length ? `, by ${authors.join(' & ')}` : ''}`;
  return [full, playing && 'playing', starred && 'starred'].filter(Boolean).join(' · ');
}

/** Enter or Space plays, as a button's would. */
const onActivate = (run: () => void) => (e: KeyboardEvent) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  run();
};

export interface StoryGridProps {
  /** The region's name. */
  title: string;
  rows: readonly LibraryRow[];
  /** The path of the preset playing; null: none. */
  playing?: string | null;
  /** The keys of the starred presets. */
  starred?: readonly string[];
  /** A tile's click; without it the tiles are only pictures. */
  onPlay?(row: LibraryRow): void;
}

export function StoryGrid({ title, rows, playing = null, starred = [], onPlay }: StoryGridProps) {
  return (
    <section aria-label={title} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(var(--lay-tile), 1fr))', gap: 'var(--lay-tile-gap)', minWidth: 0, contain: 'inline-size' }}>
      {rows.map((r) => {
        const on = r.path === playing;
        const star = starred.includes(r.key);
        const label = says(r, on, star);
        return (
          <PresetTile
            key={r.key}
            thumbnail={r.thumbnail}
            empty={r.style}
            name={tileName(r.title, r.path)}
            by={tileBy(r.authors, r.style)}
            playing={on}
            star={star}
            title={label}
            {...(onPlay
              ? {
                  role: 'button',
                  tabIndex: 0,
                  'aria-label': label,
                  'aria-current': on ? 'true' : undefined,
                  onClick: () => onPlay(r),
                  onKeyDown: onActivate(() => onPlay(r)),
                }
              : {})}
          />
        );
      })}
    </section>
  );
}
