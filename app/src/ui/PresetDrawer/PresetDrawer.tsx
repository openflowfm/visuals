import { useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { ActionButtonFace as ButtonFace } from '@satoramoto/zen';
import { Layer } from '@satoramoto/zen';
import { Text } from '@satoramoto/zen';
import type { LibraryChange } from '../model/api';
import type { Playlist } from '../model/playlists';
import { SWATCH, parseTags, valueLabel, type Colour, type Prepared } from '../model/librarySearch';
import { say } from '../model/words';
import './PresetDrawer.css';

/** Each tag on any of `chosen`, with how many of them have it: the most first, then by name. */
export function tagCounts(chosen: readonly Prepared[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of chosen) for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** The names of the playlists holding the preset at `path`, each once. */
export function playlistsWith(path: string, playlists: readonly Playlist[]): string[] {
  return playlists.filter((l) => l.items.some((i) => i.path === path)).map((l) => l.name);
}

/** What the star (or the never-play) button does to `chosen`: on for all unless every one already has it. */
export const flipFor = (chosen: readonly Prepared[], has: (p: Prepared) => boolean): boolean => !chosen.every(has);

/** What the "in playlists" line says. */
export const inPlaylistsSays = (names: readonly string[] | null): string => (names === null ? 'in playlists: …' : names.length ? `in playlists: ${names.join(', ')}` : 'in no playlists');

/** A toggle's state over `chosen`, for aria-pressed: on when every one has it, mixed when only some do. */
export function pressedFor(chosen: readonly Prepared[], has: (p: Prepared) => boolean): boolean | 'mixed' {
  const n = chosen.filter(has).length;
  return n > 0 && n === chosen.length ? true : n > 0 ? 'mixed' : false;
}

/** How many of `chosen` the filter keeps out of `shown`. */
export function hiddenCount(chosen: readonly Prepared[], shown: readonly Prepared[]): number {
  const keys = new Set(shown.map((p) => p.row.key));
  return chosen.filter((p) => !keys.has(p.row.key)).length;
}

/** The drawer's title for a selection: says how many the filter hides, so a bulk edit never touches presets out of sight unsaid. */
export function selectedSays(selected: number, hidden: number): string {
  const n = `${selected.toLocaleString('en-US')} selected`;
  return hidden > 0 ? `${n}, ${hidden.toLocaleString('en-US')} hidden by the filter` : n;
}

export interface PresetDrawerProps {
  /** The selected presets, one or more. */
  chosen: Prepared[];
  /** How many of `chosen` the filter hides. */
  hiddenByFilter: number;
  /** Every playlist, or null until read. */
  playlists: Playlist[] | null;
  /** Path of the preset playing. */
  current: string | null;
  /** Make `change` to the presets at `keys`. */
  onSet(keys: string[], change: LibraryChange): void;
  onLoad(p: Prepared): void;
  onClose(): void;
  /** Why the last change didn't stick, or null. */
  error: string | null;
}

/**
 * **Job.** The selection's drawer (the lab editor's column, under the grid): one preset's big
 * picture, its groups, its tags and the playlists it's in; or, for several, their tags at once.
 * Star and never-play apply to every one chosen.
 *
 * **Changed.** It is a `Layer level="raised"`, a tone step under the grid, where the original drew
 * a top rule and its own panel fill (near borderless). Its × and its star / never-play toggles are
 * the core `ButtonFace` (quiet, small; a toggle presses in) in place of outlined pills with an
 * amber border; tags are quiet tinted pills and the box is the filled field, no outlines. Classes
 * are `vs-drawer*`.
 *
 * **Kept.** Every export, the props, the copy, the labels and titles, `aria-pressed` (incl.
 * `mixed`), the tag box's keys (Enter adds, Esc clears, blur adds), and what each control sets.
 *
 * **Tuning knobs.** `--vs-drawer-strip-radius` (the strip's thumbnails: 2px, a quarter of
 * `--radius-control`; the scale has no thumbnail radius).
 */
export function PresetDrawer({ chosen, hiddenByFilter, playlists, current, onSet, onLoad, onClose, error }: PresetDrawerProps) {
  const [typing, setTyping] = useState('');
  const keys = chosen.map((p) => p.row.key);
  const one = chosen.length === 1 ? chosen[0] : null;
  const star = flipFor(chosen, (p) => p.star);
  const hide = flipFor(chosen, (p) => p.hidden);
  const tags = tagCounts(chosen);

  const addTags = () => {
    const add = parseTags(typing);
    if (!add.length) return;
    onSet(keys, { add_tags: add });
    setTyping('');
  };
  const onTagKey = (ev: KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      addTags();
    } else if (ev.key === 'Escape' && typing) {
      setTyping('');
    } else {
      return;
    }
    ev.stopPropagation();
  };

  return (
    <Layer level="raised" as="section" className="vs-drawer" aria-label={one ? `preset ${one.title}` : `${chosen.length} presets`}>
      <header className="vs-drawer-head">
        <Text weight="strong" className="vs-drawer-title" title={one ? one.row.key : undefined}>
          {one && !hiddenByFilter ? one.title : selectedSays(chosen.length, hiddenByFilter)}
        </Text>
        <ButtonFace tone="quiet" size="small" aria-label="close, let go of the selection" title="Let go of the selection (Esc)" onClick={onClose}>
          ×
        </ButtonFace>
      </header>

      {one ? (
        <button
          type="button"
          className="vs-drawer-picture"
          aria-label={one.row.path === current ? `${one.title}, playing` : `play ${one.title}`}
          title={one.row.path === current ? 'playing' : 'load it'}
          onClick={() => onLoad(one)}
        >
          {one.row.thumbnail ? <img src={one.row.thumbnail} alt="" /> : <Text className="vs-drawer-none">{one.style}</Text>}
        </button>
      ) : (
        <div className="vs-drawer-strip" aria-hidden="true">
          {chosen.slice(0, 8).map((p) => (p.row.thumbnail ? <img key={p.row.key} src={p.row.thumbnail} alt="" /> : <Text key={p.row.key} className="vs-drawer-none" />))}
        </div>
      )}

      {one && <Groups p={one} />}

      <div className="vs-drawer-actions">
        <ButtonFace tone="quiet" size="small" aria-label="star" aria-pressed={pressedFor(chosen, (p) => p.star)} title={star ? 'Star it' : 'Take the star off'} onClick={() => onSet(keys, { star })}>
          <span aria-hidden="true">★</span> {star ? 'star' : 'starred'}
        </ButtonFace>
        <ButtonFace
          tone="quiet"
          size="small"
          aria-label={say('hidden')}
          aria-pressed={pressedFor(chosen, (p) => p.hidden)}
          title={hide ? `Never play it: random, shuffle and ${say('auto-advance')} skip it. A playlist you made still plays it.` : 'Play it again'}
          onClick={() => onSet(keys, { hidden: hide })}
        >
          {hide ? say('hidden') : 'never played'}
        </ButtonFace>
      </div>

      <div className="vs-drawer-tags" role="group" aria-label="tags">
        {tags.map(({ tag, count }) => (
          <Text key={tag} className="vs-drawer-tag" data-some={count < chosen.length ? '' : undefined} title={count < chosen.length ? `on ${count} of ${chosen.length}` : undefined}>
            {tag}
            {count < chosen.length && (
              <Text tabular className="vs-drawer-tag-count vs-num">
                {count}
              </Text>
            )}
            <button
              type="button"
              className="vs-drawer-tag-x"
              aria-label={`take the tag ${tag} off${count < chosen.length ? ` (on ${count} of ${chosen.length})` : ''}`}
              title={`Take “${tag}” off${chosen.length > 1 ? ' all of them' : ''}`}
              onClick={() => onSet(keys, { remove_tags: [tag] })}
            >
              ×
            </button>
          </Text>
        ))}
        <input
          className="vs-drawer-tag-input"
          type="text"
          aria-label="add tags"
          placeholder={tags.length ? 'add a tag' : 'add tags, split by commas'}
          title={`Enter adds the tag${chosen.length > 1 ? ' to all of them' : ''}`}
          value={typing}
          onChange={(ev) => setTyping(ev.target.value)}
          onKeyDown={onTagKey}
          onBlur={addTags}
        />
      </div>

      {one && (
        <Text as="p" className="vs-drawer-note">
          {inPlaylistsSays(playlists && playlistsWith(one.row.path, playlists))}
        </Text>
      )}
      {error && (
        <Text as="p" className="vs-drawer-note vs-drawer-error" ariaRole="alert">
          {error}
        </Text>
      )}
    </Layer>
  );
}

const Fact = ({ name, children }: { name: string; children: ReactNode }) => (
  <>
    <dt>{name}</dt>
    <dd>{children}</dd>
  </>
);

/** One preset's groups, as the chips name them. */
function Groups({ p }: { p: Prepared }) {
  const v = p.values;
  return (
    <Text as="dl" className="vs-drawer-facts">
      <Fact name="style">{p.subStyle ? `${p.style} › ${p.subStyle}` : p.style}</Fact>
      {p.authors.length > 0 && <Fact name="author">{p.authors.join(' & ')}</Fact>}
      {v.colour.length > 0 && (
        <Fact name="colour">
          {v.colour.map((c) => (
            <span key={c} className="vs-drawer-colour">
              <span className="vs-drawer-swatch" aria-hidden="true" style={{ background: SWATCH[c as Colour] }} />
              {c}
            </span>
          ))}
        </Fact>
      )}
      {v.speed.length > 0 && <Fact name="speed">{valueLabel('speed', v.speed[0])}</Fact>}
      {v.intensity.length > 0 && <Fact name="intensity">{valueLabel('intensity', v.intensity[0])}</Fact>}
      {!p.row.look && <Fact name="look">not drawn yet</Fact>}
    </Text>
  );
}
