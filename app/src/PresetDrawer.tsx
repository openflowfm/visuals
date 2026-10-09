import { useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { ButtonFace } from '@openflow/widgets/controls/ButtonFace.tsx';
import type { LibraryChange } from './api.ts';
import type { Playlist } from './playlists.ts';
import { SWATCH, parseTags, valueLabel, type Colour, type Prepared } from './librarySearch.ts';
import { say } from './words.ts';

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

export interface PresetDrawerProps {
  /** The selected presets, one or more. */
  chosen: Prepared[];
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
 * The selection's drawer: one preset's big picture, its groups, its tags and the
 * playlists it's in; or, for several, their tags at once. Star and never-play
 * apply to every one chosen.
 */
export function PresetDrawer({ chosen, playlists, current, onSet, onLoad, onClose, error }: PresetDrawerProps) {
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
    <section className="lib-drawer" aria-label={one ? `preset ${one.title}` : `${chosen.length} presets`}>
      <header className="lib-drawer-head">
        <span className="lib-drawer-title" title={one ? one.row.key : undefined}>
          {one ? one.title : `${chosen.length.toLocaleString('en-US')} presets`}
        </span>
        <div className="wdg wdg-button">
          <ButtonFace tone="quiet" aria-label="close" title="Let go of the selection (Esc)" onClick={onClose}>
            ×
          </ButtonFace>
        </div>
      </header>

      {one ? (
        <button type="button" className="lib-drawer-picture" title={one.row.path === current ? 'playing' : 'load it'} onClick={() => onLoad(one)}>
          {one.row.thumbnail ? <img src={one.row.thumbnail} alt="" /> : <span className="lib-thumb-none">{one.style}</span>}
        </button>
      ) : (
        <div className="lib-drawer-strip" aria-hidden="true">
          {chosen.slice(0, 8).map((p) => (p.row.thumbnail ? <img key={p.row.key} src={p.row.thumbnail} alt="" /> : <span key={p.row.key} className="lib-thumb-none" />))}
        </div>
      )}

      {one && <Groups p={one} />}

      <div className="lib-drawer-actions">
        <button type="button" className="lib-chip" aria-pressed={!star} title={star ? 'Star it' : 'Take the star off'} onClick={() => onSet(keys, { star })}>
          ★ {star ? 'star' : 'starred'}
        </button>
        <button
          type="button"
          className="lib-chip"
          aria-pressed={!hide}
          title={hide ? `Never play it: random, shuffle and ${say('auto-advance')} skip it. A playlist you made still plays it.` : 'Play it again'}
          onClick={() => onSet(keys, { hidden: hide })}
        >
          {hide ? 'never play' : 'never played'}
        </button>
      </div>

      <div className="lib-tags" aria-label="tags">
        {tags.map(({ tag, count }) => (
          <span key={tag} className="lib-tag" data-some={count < chosen.length ? '' : undefined} title={count < chosen.length ? `on ${count} of ${chosen.length}` : undefined}>
            {tag}
            {count < chosen.length && <span className="lib-tag-count">{count}</span>}
            <button
              type="button"
              className="lib-tag-x"
              aria-label={`take the tag ${tag} off`}
              title={`Take “${tag}” off${chosen.length > 1 ? ' all of them' : ''}`}
              onClick={() => onSet(keys, { remove_tags: [tag] })}
            >
              ×
            </button>
          </span>
        ))}
        <input
          className="lib-tag-input"
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

      {one && <p className="lib-drawer-note">{inPlaylistsSays(playlists && playlistsWith(one.row.path, playlists))}</p>}
      {error && (
        <p className="lib-drawer-note lib-drawer-error" role="alert">
          {error}
        </p>
      )}
    </section>
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
    <dl className="lib-facts">
      <Fact name="style">{p.subStyle ? `${p.style} › ${p.subStyle}` : p.style}</Fact>
      {p.authors.length > 0 && <Fact name="author">{p.authors.join(' & ')}</Fact>}
      {v.colour.length > 0 && (
        <Fact name="colour">
          {v.colour.map((c) => (
            <span key={c} className="lib-colour">
              <span className="lib-swatch" style={{ background: SWATCH[c as Colour] }} />
              {c}
            </span>
          ))}
        </Fact>
      )}
      {v.speed.length > 0 && <Fact name="speed">{valueLabel('speed', v.speed[0])}</Fact>}
      {v.intensity.length > 0 && <Fact name="intensity">{valueLabel('intensity', v.intensity[0])}</Fact>}
      {!p.row.look && <Fact name="look">not drawn yet</Fact>}
    </dl>
  );
}
