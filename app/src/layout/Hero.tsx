import type { LibraryRow } from '../api.ts';
import { Numbers } from '../HomeBar.tsx';
import { tileBy, tileName } from '../PresetTile.tsx';
import { Icon } from './icons.tsx';
import './hero.css';

/**
 * The Now Playing card at the top of the main column (HomeLayout's `hero`
 * slot, inside its "now playing" region): the preview large, the preset's name
 * and author, where it plays from, and its actions, as type (decision 68).
 *
 * The picture is one box (`.hero-pic`) with nothing laid over it: in the app it
 * would be the native preview's hole (as NowPanel's `Preview` is), so the words
 * and actions sit beside it in a wide card and under it in a narrow one, and
 * its corners are `--lay-hero-radius`.
 */
export interface HeroProps {
  /** The preset playing, from the index; null before anything plays. */
  preset: LibraryRow | null;
  /** The preview's picture: in a story a still or the preset's thumbnail (the app's would be the native preview showing through). Null: nothing drawn yet. */
  picture: string | null;
  /** Whether the deck is moving on by itself (pause shows) or holding (play shows). */
  playing: boolean;
  /** Where it plays from, as `playsFrom` says it: "from Warm-up, 3 of 10". */
  from: string;
  /** Whether the preset is starred. */
  starred: boolean;
  onPlayPause(): void;
  onNext(): void;
  onStar(): void;
  /** Add it to a playlist (the caller opens its picker). */
  onAdd(): void;
}

/** The card. */
export function Hero({ preset, picture, playing, from, starred, onPlayPause, onNext, onStar, onAdd }: HeroProps) {
  const name = preset ? tileName(preset.title, preset.path) : null;
  const by = preset ? tileBy(preset.authors, preset.style) : '';
  return (
    <div className="hero" data-none={preset ? undefined : ''}>
      <div className="hero-row">
        <div className="hero-pic" data-empty={picture ? undefined : ''}>
          {picture ? <img src={picture} alt={name ? `preview of ${name}` : 'preview'} draggable={false} /> : <span className="hero-pic-none">{preset ? 'Drawing…' : 'Nothing playing yet'}</span>}
        </div>
        <div className="hero-info">
          <p className="hero-label">Now playing</p>
          {name ? (
            <h2 className="hero-name" title={name}>
              {name}
            </h2>
          ) : (
            <h2 className="hero-name" data-none="">
              Nothing playing
            </h2>
          )}
          {by && <p className="hero-by">{by}</p>}
          {from && (
            <p className="hero-from">
              <Numbers text={from} />
            </p>
          )}
          <div className="hero-actions">
            <button type="button" className="hero-act hero-play" aria-label={playing ? 'pause' : 'play'} title={playing ? 'Hold on this preset' : 'Move on by itself again'} onClick={onPlayPause}>
              <Icon name={playing ? 'pause' : 'play'} />
              <span aria-hidden="true">{playing ? 'Pause' : 'Play'}</span>
            </button>
            <button type="button" className="hero-act" aria-label="next preset" title="Next preset (→)" onClick={onNext}>
              <Icon name="next" />
              <span aria-hidden="true">Next</span>
            </button>
            <button
              type="button"
              className="hero-act"
              aria-label="star"
              aria-pressed={preset ? starred : undefined}
              disabled={!preset}
              title={starred ? 'Take the star off' : 'Star it'}
              onClick={onStar}
            >
              <Icon name="star" />
              <span aria-hidden="true">{starred ? 'Starred' : 'Star'}</span>
            </button>
            <button type="button" className="hero-act" aria-label="add to a playlist" title="Add it to a playlist" disabled={!preset} onClick={onAdd}>
              <Icon name="plus" />
              <span aria-hidden="true">Playlist</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
