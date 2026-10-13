import type { ReactNode } from 'react';
import { Group } from '@satoramoto/zen';
import type { LibraryRow } from '../model/api';
import { Numbers } from '../Numbers/Numbers';
import { tileBy, tileName } from '../PresetTile/PresetTile';
import { Icon } from '../Icon/Icon';
import { Text } from '@satoramoto/zen';
import { Surface } from '@satoramoto/zen';
import type { Forms } from '@satoramoto/zen';
import './Hero.css';

/** The class the picture's box wears: the app passes `<Preview className={HERO_PIC} />`. */
export const HERO_PIC = 'vs-hero-pic';

/** The hero's forms: `full` (the picture up to its cap), then `compact` (a shorter picture). */
export type HeroForm = 'full' | 'compact';

export const HERO_FORMS: Forms<HeroForm> = [
  // full: the picture up to the original's 440px cap; it wants the main column the original kept beside a docked sidebar (588px: 600px of content less the screen's wider seams), so the side panels go before it narrows
  { id: 'full', min: { w: { control: 10 }, h: { unit: 72 } }, ideal: { w: { unit: 147 }, h: { unit: 110 } }, grow: { w: true }, max: { h: { unit: 110 } } },
  // compact: a shorter picture, for a short window
  { id: 'compact', min: { w: { control: 8 }, h: { unit: 40 } }, ideal: { w: { control: 10 }, h: { unit: 72 } }, grow: { w: true, h: true }, max: { h: { unit: 80 } } },
];

/**
 * **Job.** The Now Playing card at the top of the main column (HomeLayout's `hero` slot, inside
 * its "now playing" region): the preview large, the preset's name and author, where it plays
 * from, and its actions, as type (decision 68).
 *
 * **Changed.** The actions are a library `Group` (unlabelled: the card names them). Sizes and
 * tones read the contract and the layout's `--vs-lay-*`. The picture's box is `vs-hero-pic`
 * (`HERO_PIC`); a `Preview` placed straight in the card is styled as the box whatever class it
 * was given, so the app's `<Preview className="hero-pic" />` still works. The preview's corners
 * are Views' `Preview`'s own opaque painted corners, at the hero's radius. Nothing animates.
 *
 * **Kept.** Props, copy, accessible names and titles; the picture as one box with nothing laid
 * over it (in the app the native preview's hole), its spread shadow painting the main column
 * around it, its 16:9 shape and cap; the words beside it in a card of 680px and up, under it
 * narrower (the card's own container query, not the screen's); the picture alone (`preset` left
 * out) centred.
 *
 * From the original: with `preset` left out (round 2, Ryan's call: the playing preset's name and
 * where it plays from are in the transport bar) the hero is the picture alone, marked
 * `data-only`: centred, as wide as its room at 16:9, and never taller than the room the
 * assembled screen gave the hero's slot, where it narrows and stays centred. The original capped
 * it at half the measured column; now the screen decides the hero's height from its forms
 * (`HERO_FORMS`, `Hero.forms`: `full` up to the original's 440px cap, `compact` shorter), and the
 * slot (`.vs-lay-hero`, a size container) is the cap.
 *
 * **Tuning knobs** (Hero.css, on `.vs-hero`):
 * - `--vs-hero-cap`: the picture's tallest, about two fifths of the window, clamped to 160–440px
 *   on the scale; for the picture alone, the hero slot's height (`100cqh`: outside a size
 *   container, the viewport's).
 * - `--vs-hero-name-size` (24px): the name, a fifth over the heading size.
 * - `--vs-hole-radius`: Views' `Preview`'s corner knob, set here to the hero's
 *   `--vs-lay-hero-radius`.
 * - `--vs-hole-corner`: Views' `Preview`'s corner tone, set here to the spread's `--surface-0`
 *   (the preview isn't clipped, so its painted corners survive).
 * - `--vs-hero-fade` (160ms): how long the floating `controls` fade in and out (none under
 *   reduced motion); `--vs-hero-scrim` (85%): how much of the window's tint the scrim starts with
 *   at the picture's foot.
 */
export interface HeroProps {
  /** The preset playing, from the index; null before anything plays. Left out (round 2: the hero is only the picture, its name in the transport bar): no name or actions column. */
  preset?: LibraryRow | null;
  /** The preview's picture: in a story a still or the preset's thumbnail (a URL); in the app a node, `<Preview className={HERO_PIC} />`, rendered as the picture's box itself. Null: nothing drawn yet. */
  picture: ReactNode | string | null;
  /** Whether the deck is moving on by itself (pause shows) or holding (play shows). */
  playing?: boolean;
  /** Where it plays from, as `playsFrom` says it: "from Warm-up, 3 of 10". */
  from?: string;
  /** Whether the preset is starred. */
  starred?: boolean;
  onPlayPause?(): void;
  onNext?(): void;
  onStar?(): void;
  /** Add it to a playlist (the caller opens its picker). */
  onAdd?(): void;
  /**
   * Controls floating over the picture's foot (Home: the transport, `TransportBar
   * layout="overlay"`), on a scrim from the window's tint: shown while the picture is hovered,
   * while focus is in them or a popover of theirs is open, and always with no hover (touch).
   */
  controls?: ReactNode;
}

/** An action's word: strong, at the body size (a step larger on play and pause, Hero.css); its button carries the name. */
function ActWord({ children }: { children: string }) {
  return (
    <Text weight="strong" leading="normal" className="vs-hero-act-word" aria-hidden="true">
      {children}
    </Text>
  );
}

/** The card. */
export function Hero({ preset, picture, playing = false, from = '', starred = false, onPlayPause, onNext, onStar, onAdd, controls }: HeroProps) {
  const info = preset !== undefined;
  const name = preset ? tileName(preset.title, preset.path) : null;
  const by = preset ? tileBy(preset.authors, preset.style) : '';
  const pic =
    picture && typeof picture !== 'string' ? (
      // The app's `<Preview />`: the box itself, the native preview's hole, so nothing wraps it.
      picture
    ) : (
      <div className={HERO_PIC} data-empty={picture ? undefined : ''}>
        {typeof picture === 'string' && picture ? (
          <img src={picture} alt={name ? `preview of ${name}` : 'preview'} draggable={false} />
        ) : (
          <Text role="caption" leading="normal" className="vs-hero-pic-none">
            {preset ? 'Drawing…' : 'Nothing playing yet'}
          </Text>
        )}
      </div>
    );
  return (
    <div className="vs-hero" data-none={preset ? undefined : ''} data-only={info ? undefined : ''}>
      <div className="vs-hero-row">
        {controls ? (
          // The picture and its controls in one box the picture's size; the scrim (a Surface: the
          // native preview can't be blurred, so a gradient from the window's tint) lies over its foot.
          <div className="vs-hero-stage">
            {pic}
            <Surface radius="none" className="vs-hero-controls">
              {controls}
            </Surface>
          </div>
        ) : (
          pic
        )}
        {info && (
          <div className="vs-hero-info">
            <Text as="p" leading="normal" className="vs-hero-label">
              Now playing
            </Text>
            {name ? (
              <Text as="h2" weight="strong" className="vs-hero-name" title={name}>
                {name}
              </Text>
            ) : (
              <Text as="h2" weight="strong" className="vs-hero-name" data-none="">
                Nothing playing
              </Text>
            )}
            {by && (
              <Text as="p" leading="normal" className="vs-hero-by">
                {by}
              </Text>
            )}
            {from && (
              <Text as="p" role="caption" leading="normal" className="vs-hero-from">
                <Numbers text={from} />
              </Text>
            )}
            <Group name="actions" label={false} className="vs-hero-actions" wrap>
              <button
                type="button"
                className="vs-hero-act vs-hero-play"
                aria-label={playing ? 'pause' : 'play'}
                title={playing ? 'Hold on this preset' : 'Move on by itself again'}
                onClick={onPlayPause}
              >
                <Icon name={playing ? 'pause' : 'play'} />
                <ActWord>{playing ? 'Pause' : 'Play'}</ActWord>
              </button>
              <button type="button" className="vs-hero-act" aria-label="next preset" title="Next preset (→)" onClick={onNext}>
                <Icon name="next" />
                <ActWord>Next</ActWord>
              </button>
              <button
                type="button"
                className="vs-hero-act"
                aria-label="star"
                aria-pressed={preset ? starred : undefined}
                disabled={!preset}
                title={starred ? 'Take the star off' : 'Star it'}
                onClick={onStar}
              >
                <Icon name="star" />
                <ActWord>{starred ? 'Starred' : 'Star'}</ActWord>
              </button>
              <button type="button" className="vs-hero-act" aria-label="add to a playlist" title="Add it to a playlist" disabled={!preset} onClick={onAdd}>
                <Icon name="plus" />
                <ActWord>Playlist</ActWord>
              </button>
            </Group>
          </div>
        )}
      </div>
    </div>
  );
}
Hero.forms = HERO_FORMS;
