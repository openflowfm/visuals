import { useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { LibraryChange } from './api.ts';
import type { Playlist } from './playlists.ts';
import { parseTags, valueLabel, type Prepared } from './librarySearch.ts';
import { flipFor, playlistsWith, pressedFor, tagCounts } from './PresetDrawer.tsx';
import { Popover } from './Popover.tsx';
import { Preview } from './views.tsx';
import { say } from './words.ts';
import './nowpanel.css';

export interface NowPanelProps {
  /** What the panel is about: the preset playing (one), or several presets picked in the grid with ⌘/⇧ (bulk star, never play, tags; title "n selected"). Empty when nothing plays yet or the preset isn't in the index. */
  chosen: Prepared[];
  /** The preset playing, for its name and folder when it isn't in the index (chosen empty); null before anything plays. */
  current: { path: string; name: string; group: string } | null;
  /** Where it plays from, without the place: e.g. "from the library", "from Chill" (the caller computes it). */
  from: string;
  /** Every playlist (for "in" and "+ playlist ▾"); null until read. */
  playlists: Playlist[] | null;
  /** Change star / never play / tags on these preset keys. */
  onSet(keys: string[], change: LibraryChange): void;
  /** Add these preset paths to a manual playlist, by id. */
  onAddTo(playlist: string, paths: string[]): void;
  onClose(): void;
  /** Why the last change didn't stick, or null (role=alert line). */
  error: string | null;
}

const PLAYLIST_LABEL = '+ playlist ▾';

/**
 * The home's right-hand panel (decision 67): the big preview of the preset
 * playing, its name, star, never play, + playlist, what it is and my tags; or,
 * for several picked in the grid, their star, never play and tags at once.
 *
 * The preview is a hole the engine's view shows through, so nothing here paints
 * a background: the panel's colour is the preview's own spread shadow, clipped
 * by the panel (nowpanel.css).
 */
export function NowPanel({ chosen, current, from, playlists, onSet, onAddTo, onClose, error }: NowPanelProps) {
  const keys = chosen.map((p) => p.row.key);
  const paths = chosen.map((p) => p.row.path);
  const many = chosen.length > 1;
  const one = chosen.length === 1 ? chosen[0] : null;
  const none = chosen.length === 0;
  const star = flipFor(chosen, (p) => p.star);
  const hide = flipFor(chosen, (p) => p.hidden);
  const manuals = (playlists ?? []).filter((l) => l.kind === 'manual');

  const name = many ? `${chosen.length.toLocaleString('en-US')} selected` : (one?.title ?? current?.name ?? null);
  const folder = many ? null : (one?.style ?? current?.group ?? null);

  return (
    <section className="now-panel" aria-label={say('stage')}>
      <header className="now-head">
        <span className="now-caps">{say('stage')}</span>
        <button type="button" className="now-close" aria-label={`close ${say('stage')}`} title={`Close ${say('stage')}`} onClick={onClose}>
          ✕
        </button>
      </header>

      <div className="now-cell">
        <Preview className="now-preview" />
      </div>

      <div className="now-body">
        <div className="now-title">
          {name === null ? (
            <p className="now-nothing">nothing playing yet</p>
          ) : (
            <>
              <h2 title={one ? one.row.key : undefined}>{name}</h2>
              <p className="now-from">{folder ? `${folder} · ${from}` : from}</p>
            </>
          )}
        </div>

        <div className="now-actions">
          <button
            type="button"
            className="now-btn"
            aria-label="star"
            aria-pressed={none ? undefined : pressedFor(chosen, (p) => p.star)}
            disabled={none}
            title={star ? 'Star it' : 'Take the star off'}
            onClick={() => onSet(keys, { star })}
          >
            <span aria-hidden="true">★</span> {star ? 'star' : 'starred'}
          </button>
          <button
            type="button"
            className="now-btn"
            aria-label={say('hidden')}
            aria-pressed={none ? undefined : pressedFor(chosen, (p) => p.hidden)}
            disabled={none}
            title={hide ? `Never play it: random, shuffle and ${say('auto-advance')} skip it. A playlist you made still plays it.` : 'Play it again'}
            onClick={() => onSet(keys, { hidden: hide })}
          >
            {say('hidden')}
          </button>
          {none ? (
            <button type="button" className="now-btn" aria-label="add to a playlist" disabled>
              {PLAYLIST_LABEL}
            </button>
          ) : (
            <Popover label={PLAYLIST_LABEL} name="add to a playlist" title={many ? 'Add them to a playlist' : 'Add it to a playlist'} role="menu" className="now-pop">
              {(close) =>
                manuals.length ? (
                  manuals.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onAddTo(l.id, paths);
                        close();
                      }}
                    >
                      {l.name}
                    </button>
                  ))
                ) : (
                  <button type="button" role="menuitem" disabled>
                    no playlists yet: + in the sidebar makes one
                  </button>
                )
              }
            </Popover>
          )}
        </div>

        {one && <Details p={one} playlists={playlists} />}

        {!none && <Tags chosen={chosen} keys={keys} onSet={onSet} />}

        {error && (
          <p className="now-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

const Fact = ({ name, children }: { name: string; children: ReactNode }) => (
  <>
    <dt>{name}</dt>
    <dd>{children}</dd>
  </>
);

/** One preset's author, style, speed and the playlists holding it. */
function Details({ p, playlists }: { p: Prepared; playlists: Playlist[] | null }) {
  const holding = playlists && playlistsWith(p.row.path, playlists);
  return (
    <dl className="now-facts">
      {p.authors.length > 0 && <Fact name="author">{p.authors.join(' & ')}</Fact>}
      <Fact name="style">{p.subStyle ? `${p.style} › ${p.subStyle}` : p.style}</Fact>
      {p.values.speed.length > 0 && <Fact name="speed">{valueLabel('speed', p.values.speed[0])}</Fact>}
      <Fact name="in">{holding === null ? '…' : holding.length ? holding.join(', ') : 'no playlists'}</Fact>
    </dl>
  );
}

/** My tags on `chosen`, each removable, and "+ tag", which becomes a text box. */
function Tags({ chosen, keys, onSet }: { chosen: Prepared[]; keys: string[]; onSet: NowPanelProps['onSet'] }) {
  const [adding, setAdding] = useState(false);
  const [typing, setTyping] = useState('');
  const tags = tagCounts(chosen);
  const n = chosen.length;

  // Esc closes the box; the blur that follows must not add what was typed.
  const cancelled = useRef(false);
  const commit = () => {
    if (cancelled.current) return;
    const add = parseTags(typing);
    if (add.length) onSet(keys, { add_tags: add });
    setTyping('');
    setAdding(false);
  };
  const onKey = (ev: KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      commit();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      cancelled.current = true;
      setTyping('');
      setAdding(false);
    } else {
      return;
    }
    ev.stopPropagation();
  };

  return (
    <div className="now-tags-block">
      <div className="now-caps">{say('user tags')}</div>
      <div className="now-tags" role="group" aria-label={say('user tags')}>
        {tags.map(({ tag, count }) => (
          <span key={tag} className="now-chip" data-some={count < n ? '' : undefined} title={count < n ? `on ${count} of ${n}` : undefined}>
            {tag}
            {count < n && <span className="now-chip-count">{count}</span>}
            <button
              type="button"
              className="now-chip-x"
              aria-label={`take the tag ${tag} off${count < n ? ` (on ${count} of ${n})` : ''}`}
              title={`Take “${tag}” off${n > 1 ? ' all of them' : ''}`}
              onClick={() => onSet(keys, { remove_tags: [tag] })}
            >
              ×
            </button>
          </span>
        ))}
        {adding ? (
          <input
            className="now-chip now-tag-input"
            type="text"
            aria-label="add tags"
            placeholder="tags, split by commas"
            title={`Enter adds${n > 1 ? ' to all of them' : ''}, Esc cancels`}
            autoFocus
            value={typing}
            onChange={(ev) => setTyping(ev.target.value)}
            onKeyDown={onKey}
            onBlur={commit}
          />
        ) : (
          <button
            type="button"
            className="now-chip now-chip-add"
            title={`Add a tag${n > 1 ? ' to all of them' : ''}`}
            onClick={() => {
              cancelled.current = false;
              setAdding(true);
            }}
          >
            + tag
          </button>
        )}
      </div>
    </div>
  );
}
