import type { ReactNode } from 'react';
import type { Prepared } from '../../librarySearch.ts';
import { playlistsWith } from '../../PresetDrawer.tsx';
import { Popover } from '../../Popover.tsx';
import { say, Say } from '../../words.ts';
import { Icon } from '../icons.tsx';
import type { InspectorProps } from './model.ts';

/**
 * The inspector's actions on one preset: each a button with a name a screen
 * reader and voice control find it by, its state in aria-pressed, and a glyph
 * from the layout's icons. The inspector lays them out and styles them by
 * `className`; what they do and say stays here.
 */

/** What every action takes. */
interface ActionProps {
  p: Prepared;
  className?: string;
  /** What shows beside the glyph ('' for the glyph alone). */
  children?: ReactNode;
}

/** Star: toggles, aria-pressed. */
export function StarAction({ p, className, children, onSet }: ActionProps & Pick<InspectorProps, 'onSet'>) {
  return (
    <button type="button" className={className} aria-label="star" aria-pressed={p.star} title={p.star ? 'Take the star off' : 'Star it'} onClick={() => onSet([p.row.key], { star: !p.star })}>
      <Icon name="star" />
      {children ?? <span aria-hidden="true">{p.star ? 'Starred' : 'Star'}</span>}
    </button>
  );
}

/** Never play: toggles, aria-pressed; random, shuffle and moving on by itself skip it. */
export function NeverAction({ p, className, children, onSet }: ActionProps & Pick<InspectorProps, 'onSet'>) {
  return (
    <button
      type="button"
      className={className}
      aria-label={say('hidden')}
      aria-pressed={p.hidden}
      title={p.hidden ? 'Play it again' : `Never play it: random, shuffle and ${say('auto-advance')} skip it. A playlist you made still plays it.`}
      onClick={() => onSet([p.row.key], { hidden: !p.hidden })}
    >
      <Icon name="never" />
      {children ?? <span aria-hidden="true">{Say('hidden')}</span>}
    </button>
  );
}

/** Add to a playlist: a menu of the manual playlists. */
export function AddAction({ p, className, children, playlists, onAddTo }: ActionProps & Pick<InspectorProps, 'playlists' | 'onAddTo'>) {
  const manuals = (playlists ?? []).filter((l) => l.kind === 'manual');
  return (
    <Popover
      label={
        <>
          <Icon name="plus" />
          {children ?? <span aria-hidden="true">Playlist</span>}
        </>
      }
      name="add to a playlist"
      title="Add it to a playlist"
      role="menu"
      align="right"
      className={className}
    >
      {(close) =>
        manuals.length ? (
          manuals.map((l) => (
            <button
              key={l.id}
              type="button"
              role="menuitem"
              onClick={() => {
                onAddTo(l.id, [p.row.path]);
                close();
              }}
            >
              {l.name}
            </button>
          ))
        ) : (
          <button type="button" role="menuitem" disabled>
            No playlists yet: + in the sidebar makes one
          </button>
        )
      }
    </Popover>
  );
}

/** Open it in the preset editor (lab builds: shown only with `onEdit`). */
export function EditAction({ className, children, onEdit }: Omit<ActionProps, 'p'> & Pick<InspectorProps, 'onEdit'>) {
  if (!onEdit) return null;
  return (
    <button type="button" className={className} aria-label="open in the editor" title="Open it in the preset editor" onClick={onEdit}>
      <Icon name="edit" />
      {children ?? <span aria-hidden="true">Edit</span>}
    </button>
  );
}

/** Back to the preset playing, from one picked. */
export function BackAction({ className, children, onBack }: Omit<ActionProps, 'p'> & Pick<InspectorProps, 'onBack'>) {
  return (
    <button type="button" className={className} aria-label={`back to ${say('stage')}`} title={`Back to the preset playing`} onClick={onBack}>
      <Icon name="chevron-right" className="insp-back-glyph" />
      {children ?? <span aria-hidden="true">{Say('stage')}</span>}
    </button>
  );
}

/** Play the one picked (shown only with `onPlay`). */
export function PlayAction({ className, children, onPlay }: Omit<ActionProps, 'p'> & Pick<InspectorProps, 'onPlay'>) {
  if (!onPlay) return null;
  return (
    <button type="button" className={className} aria-label="play it" title="Play it now" onClick={onPlay}>
      <Icon name="play" />
      {children ?? <span aria-hidden="true">Play</span>}
    </button>
  );
}

/** The playlists holding the preset, or null until they are read. */
export const holding = (p: Prepared, playlists: InspectorProps['playlists']): string[] | null => (playlists ? playlistsWith(p.row.path, playlists) : null);
