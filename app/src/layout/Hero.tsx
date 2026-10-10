import type { LibraryRow } from '../api.ts';
import { tileBy, tileName } from '../PresetTile.tsx';
import { Icon } from './icons.tsx';
import './hero.css';

/**
 * The Now Playing card at the top of the main column (HomeLayout's `hero`
 * slot, inside its "now playing" region): the preview large, the preset's name
 * and author, where it plays from, and its actions. Stub: the hero lane draws
 * it (corners of `--lay-hero-radius`), keeping these props.
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
  /** Add it to a playlist (the hero lane opens the picker). */
  onAdd(): void;
}

/** The card. */
export function Hero({ preset, picture, playing, from, starred, onPlayPause, onNext, onStar, onAdd }: HeroProps) {
  const name = preset ? tileName(preset.title, preset.path) : 'Nothing playing';
  const by = preset ? tileBy(preset.authors, preset.style) : '';
  return (
    <div className="hero">
      <div className="hero-pic">{picture && <img src={picture} alt="" draggable={false} />}</div>
      <div className="hero-info">
        <h2 className="hero-name">{name}</h2>
        {by && <p className="hero-by">{by}</p>}
        {from && <p className="hero-from">{from}</p>}
        <div className="hero-actions">
          <button type="button" aria-label={playing ? 'Pause' : 'Play'} onClick={onPlayPause}>
            <Icon name={playing ? 'pause' : 'play'} />
          </button>
          <button type="button" aria-label="Next" onClick={onNext}>
            <Icon name="next" />
          </button>
          <button type="button" aria-label={starred ? 'Unstar' : 'Star'} aria-pressed={starred} onClick={onStar}>
            <Icon name="star" />
          </button>
          <button type="button" aria-label="Add to a playlist" onClick={onAdd}>
            <Icon name="plus" />
          </button>
        </div>
      </div>
    </div>
  );
}
