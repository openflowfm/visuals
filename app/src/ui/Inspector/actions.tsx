import type { ReactNode } from 'react';
import type { Prepared } from '../model/librarySearch';
import { say, Say } from '../model/words';
import type { InspectorProps } from '../model/inspector-model';
import { flipFor, playlistsWith, pressedFor } from '../PresetDrawer/PresetDrawer';
import { Popover } from '../Popover/Popover';
import { Icon } from '../Icon/Icon';

/**
 * **Job.** The inspector's actions on the presets it is about (one, or several picked
 * together): each a button with a name a screen reader and voice control find it by, its state
 * in aria-pressed (mixed when only some of them have it), and a glyph from the layout's icons. A
 * toggle turns it on for all of them unless every one already has it, as the library's drawer
 * does. The inspector lays them out and styles them by `className`; what they do and say stays
 * here.
 *
 * **Changed.** Only the import paths (the zen ports of PresetDrawer, Popover and the icons); the
 * back glyph's class is `vs-inspector-back-glyph` (Inspector.css turns it).
 *
 * **Kept.** Every export, prop, accessible name, title and word.
 */

/** What every action takes. */
interface ActionProps {
  /** The presets it acts on: one, or several picked together. */
  chosen: readonly Prepared[];
  className?: string;
  /** What shows beside the glyph ('' for the glyph alone). */
  children?: ReactNode;
}

const keysOf = (chosen: readonly Prepared[]) => chosen.map((p) => p.row.key);
const them = (chosen: readonly Prepared[]) => (chosen.length > 1 ? 'them' : 'it');

/** Star: toggles, aria-pressed. */
export function StarAction({ chosen, className, children, onSet }: ActionProps & Pick<InspectorProps, 'onSet'>) {
  const star = flipFor(chosen, (p) => p.star);
  return (
    <button
      type="button"
      className={className}
      aria-label="star"
      aria-pressed={pressedFor(chosen, (p) => p.star)}
      title={star ? `Star ${them(chosen)}` : 'Take the star off'}
      onClick={() => onSet(keysOf(chosen), { star })}
    >
      <Icon name="star" />
      {children ?? <span aria-hidden="true">{star ? 'Star' : 'Starred'}</span>}
    </button>
  );
}

/** Never play: toggles, aria-pressed; random, shuffle and moving on by itself skip it. */
export function NeverAction({ chosen, className, children, onSet }: ActionProps & Pick<InspectorProps, 'onSet'>) {
  const hide = flipFor(chosen, (p) => p.hidden);
  return (
    <button
      type="button"
      className={className}
      aria-label={say('hidden')}
      aria-pressed={pressedFor(chosen, (p) => p.hidden)}
      title={hide ? `Never play ${them(chosen)}: random, shuffle and ${say('auto-advance')} skip ${them(chosen)}. A playlist you made still plays ${them(chosen)}.` : `Play ${them(chosen)} again`}
      onClick={() => onSet(keysOf(chosen), { hidden: hide })}
    >
      <Icon name="never" />
      {children ?? <span aria-hidden="true">{Say('hidden')}</span>}
    </button>
  );
}

/** Add to a playlist: a menu of the manual playlists. */
export function AddAction({ chosen, className, children, playlists, onAddTo }: ActionProps & Pick<InspectorProps, 'playlists' | 'onAddTo'>) {
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
      title={`Add ${them(chosen)} to a playlist`}
      role="menu"
      align="right"
      className={className}
    >
      {(close: () => void) =>
        manuals.length ? (
          manuals.map((l) => (
            <button
              key={l.id}
              type="button"
              role="menuitem"
              onClick={() => {
                onAddTo(
                  l.id,
                  chosen.map((p) => p.row.path),
                );
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
export function EditAction({ className, children, onEdit }: Omit<ActionProps, 'chosen'> & Pick<InspectorProps, 'onEdit'>) {
  if (!onEdit) return null;
  return (
    <button type="button" className={className} aria-label="open in the editor" title="Open it in the preset editor" onClick={onEdit}>
      <Icon name="edit" />
      {children ?? <span aria-hidden="true">Edit</span>}
    </button>
  );
}

/** Back to the preset playing, from one picked. */
export function BackAction({ className, children, onBack }: Omit<ActionProps, 'chosen'> & Pick<InspectorProps, 'onBack'>) {
  return (
    <button type="button" className={className} aria-label={`back to ${say('stage')}`} title={`Back to the preset playing`} onClick={onBack}>
      <Icon name="chevron-right" className="vs-inspector-back-glyph" />
      {children ?? <span aria-hidden="true">{Say('stage')}</span>}
    </button>
  );
}

/** Play the one picked (shown only with `onPlay`). */
export function PlayAction({ className, children, onPlay }: Omit<ActionProps, 'chosen'> & Pick<InspectorProps, 'onPlay'>) {
  if (!onPlay) return null;
  return (
    <button type="button" className={className} aria-label="play it" title="Play it now" onClick={onPlay}>
      <Icon name="play" />
      {children ?? <span aria-hidden="true">Play</span>}
    </button>
  );
}

/** Close the inspector (shown only with `onClose`). */
export function CloseAction({ className, onClose }: { className?: string } & Pick<InspectorProps, 'onClose'>) {
  if (!onClose) return null;
  return (
    <button type="button" className={className} aria-label={`close ${say('inspector')}`} title={`Close ${say('inspector')} (Esc)`} onClick={onClose}>
      <Icon name="close" size={12} />
    </button>
  );
}

/** The playlists holding the preset, or null until they are read. */
export const holding = (p: Prepared, playlists: InspectorProps['playlists']): string[] | null => (playlists ? playlistsWith(p.row.path, playlists) : null);
