import type { ReactNode } from 'react';
import type { Prepared } from '../../librarySearch.ts';
import { flipFor, pressedFor } from '../../PresetDrawer.tsx';
import { Popover } from '../../Popover.tsx';
import type { Playlist } from '../../playlists.ts';
import { say, Say } from '../../words.ts';
import { Icon } from '../icons.tsx';
import type { InspectorProps } from './model.ts';

/**
 * The inspector's actions on the presets it is about (one, or several picked
 * together): each a button with a name a screen reader and voice control find
 * it by, its state in aria-pressed (mixed when only some of them have it), and
 * a glyph from the layout's icons. A toggle turns it on for all of them unless
 * every one already has it, as the library's drawer does. With nothing to act
 * on (nothing playing, or the source shown) they stay in place, disabled, so
 * the header never changes shape. The inspector lays them out and styles them
 * by `className`; what they do and say stays here.
 */

/** What every action takes. */
interface ActionProps {
  /** The presets it acts on: one, or several picked together; none leaves it disabled. */
  chosen: readonly Prepared[];
  className?: string;
  /** What shows beside the glyph ('' for the glyph alone). */
  children?: ReactNode;
}

const keysOf = (chosen: readonly Prepared[]) => chosen.map((p) => p.row.key);
const them = (chosen: readonly Prepared[]) => (chosen.length > 1 ? 'them' : 'it');
/** The tooltip of an action with nothing to act on. */
const NOTHING = 'Pick a preset first';

/** Star: toggles, aria-pressed. */
export function StarAction({ chosen, className, children, onSet }: ActionProps & Pick<InspectorProps, 'onSet'>) {
  const star = flipFor(chosen, (p) => p.star);
  const none = !chosen.length;
  return (
    <button
      type="button"
      className={className}
      aria-label="star"
      aria-pressed={pressedFor(chosen, (p) => p.star)}
      disabled={none}
      title={none ? NOTHING : star ? `Star ${them(chosen)}` : 'Take the star off'}
      onClick={() => onSet(keysOf(chosen), { star })}
    >
      <Icon name="star" />
      {children ?? <span aria-hidden="true">{star ? 'Star' : 'Starred'}</span>}
    </button>
  );
}

/**
 * Never play: toggles, aria-pressed; random, shuffle and moving on by itself
 * skip it. While it is on for all of them, `onWord` shows beside the glyph,
 * so it reads at a glance.
 */
export function NeverAction({ chosen, className, children, onWord, onSet }: ActionProps & Pick<InspectorProps, 'onSet'> & { onWord?: string }) {
  const hide = flipFor(chosen, (p) => p.hidden);
  const pressed = pressedFor(chosen, (p) => p.hidden);
  const none = !chosen.length;
  return (
    <button
      type="button"
      className={className}
      aria-label={say('hidden')}
      aria-pressed={pressed}
      disabled={none}
      title={
        none
          ? NOTHING
          : hide
            ? `Never play ${them(chosen)}: random, shuffle and ${say('auto-advance')} skip ${them(chosen)}. A playlist you made still plays ${them(chosen)}.`
            : `Play ${them(chosen)} again`
      }
      onClick={() => onSet(keysOf(chosen), { hidden: hide })}
    >
      <Icon name="never" />
      {pressed === true && onWord ? (
        <span className="insp-key-word" aria-hidden="true">
          {onWord}
        </span>
      ) : (
        (children ?? <span aria-hidden="true">{Say('hidden')}</span>)
      )}
    </button>
  );
}

/** Add to a playlist: a menu of the manual playlists; with nothing to add, a disabled button in its place. */
export function AddAction({ chosen, className, children, playlists, onAddTo }: ActionProps & Pick<InspectorProps, 'playlists' | 'onAddTo'>) {
  const label = (
    <>
      <Icon name="plus" />
      {children ?? <span aria-hidden="true">Playlist</span>}
    </>
  );
  if (!chosen.length)
    return (
      <button type="button" className={className} aria-label="add to a playlist" title={NOTHING} disabled>
        {label}
      </button>
    );
  const manuals = (playlists ?? []).filter((l) => l.kind === 'manual');
  return (
    <Popover label={label} name="add to a playlist" title={`Add ${them(chosen)} to a playlist`} role="menu" align="right" className={className}>
      {(close) =>
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

/** Open it in the preset editor (lab builds: shown only with `onEdit`); disabled unless it is about one preset. */
export function EditAction({ className, children, onEdit, disabled }: Omit<ActionProps, 'chosen'> & Pick<InspectorProps, 'onEdit'> & { disabled?: boolean }) {
  if (!onEdit) return null;
  return (
    <button type="button" className={className} aria-label="open in the editor" title={disabled ? 'Pick one preset to edit it' : 'Open it in the preset editor'} disabled={disabled} onClick={onEdit}>
      <Icon name="edit" />
      {children ?? <span aria-hidden="true">Edit</span>}
    </button>
  );
}

/** Back to the preset playing, from one picked. */
export function BackAction({ className, children, onBack }: Omit<ActionProps, 'chosen'> & Pick<InspectorProps, 'onBack'>) {
  return (
    <button type="button" className={className} aria-label={`back to ${say('stage')}`} title={`Back to the preset playing`} onClick={onBack}>
      <Icon name="chevron-right" className="insp-back-glyph" />
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

/**
 * The playlists holding any of `chosen`, in the playlists' order: each name,
 * with "(k of n)" when it holds only some of several. Null until the
 * playlists are read.
 */
export function holdingAll(chosen: readonly Prepared[], playlists: readonly Playlist[] | null): string[] | null {
  if (!playlists) return null;
  const n = chosen.length;
  const out: string[] = [];
  for (const l of playlists) {
    const paths = new Set(l.items.map((i) => i.path));
    const k = chosen.filter((p) => paths.has(p.row.path)).length;
    if (k) out.push(n > 1 && k < n ? `${l.name} (${k} of ${n})` : l.name);
  }
  return out;
}
