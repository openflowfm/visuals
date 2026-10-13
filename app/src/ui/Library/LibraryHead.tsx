import type { ReactNode } from 'react';
import { Segmented, Text } from '@satoramoto/zen';
import { LIBRARY_VIEWS, LIBRARY_VIEW_WORDS, type LibraryView } from '../model/libraryView';
import './LibraryHead.css';

export interface LibraryHeadProps {
  /** The source shown: "Library", "Starred", a playlist's name. */
  title: string;
  /** How many presets the room shows (the grid's tiles, the map's dots); null while unknown. */
  count: number | null;
  /** The count's tooltip ("12 of 250 presets shown" while filtering). */
  countTitle?: string;
  view: LibraryView;
  onView(next: LibraryView): void;
  /** False hides the switch (quick add, where only the grid adds). */
  switchable?: boolean;
  /** What goes after the switch (the map's colour picker in Map view). */
  aside?: ReactNode;
}

/**
 * **Job.** The library's own header row on Home, between the hero and the room under it (wireframe
 * B): the source's name and how many presets it shows, then the **Grid | Map** switch and, in Map
 * view, the map's colour picker (`aside`). The switch is zen's `Segmented`, so the theme's tabs
 * material draws it as the header's view switch is drawn: words, the chosen one underlined.
 *
 * **Changed.** New: the library's grid had no head of its own on the inspector view (the sidebar
 * named the source, the inspector's card counted it); the switch needs one, and the count follows
 * the search and the filter as the room does.
 *
 * **Kept.** The search and "Filter ▾" stay in the header's toolbar; the hero keeps its size.
 *
 * **Tuning knobs** (LibraryHead.css): `--vs-library-head-pad`, the row's padding above and below
 * (`--space-2`).
 */
export function LibraryHead({ title, count, countTitle, view, onView, switchable = true, aside }: LibraryHeadProps) {
  return (
    <div className="vs-libhead">
      <Text as="h2" role="display" size="body" weight="strong" leading="normal" className="vs-libhead-title">
        {title}
      </Text>
      {count !== null && (
        <Text role="numeral" size="caption" weight="body" leading="normal" tabular className="vs-libhead-count" title={countTitle} ariaRole="status">
          {count.toLocaleString('en-US')}
        </Text>
      )}
      <span className="vs-libhead-fill" />
      {switchable && (
        <Segmented
          className="vs-libhead-views"
          items={LIBRARY_VIEW_WORDS}
          index={LIBRARY_VIEWS.indexOf(view)}
          onChange={(i) => onView(LIBRARY_VIEWS[i] ?? 'grid')}
          label="Show the library as"
          hint="Grid: the presets as pictures · Map: every preset a dot, by the map's axes"
        />
      )}
      {aside}
    </div>
  );
}
