import { Numbers } from '../Numbers.tsx';
import { SourcePicker } from '../SourcePicker.tsx';
import { FrameRate } from '../views.tsx';
import { Icon } from './icons.tsx';
import './transport-bar.css';

/**
 * The bar along the bottom of the macOS layout's main column (HomeLayout's
 * `bar` slot): the transport, the hero above being
 * the picture alone. ◀ play/pause ▶ R on the left; in the middle the preset
 * playing and where it plays from (`now`), then the time on it and how long
 * until the next one (the time on it alone once that has run out); the audio input on the right, and before it a warning only while the
 * picture draws slowly (`FrameRate slowOnly`). No preview,
 * so no hole: the bar paints nothing, sitting over the hero's spread shadow,
 * which paints the main column.
 */
export interface TransportBarProps {
  /** Whether the deck is moving on by itself (pause shows) or holding (play shows). */
  playing: boolean;
  onPlayPause(): void;
  /** Step: -1 previous, 1 next, 0 random. */
  onStep(by: -1 | 0 | 1): void;
  /** Words added to the step buttons' tooltips, e.g. " in the playlist" ('' when none). */
  stepIn: string;
  /**
   * Seconds on the preset playing and its length before the deck moves on (the
   * deck's `seconds`); a null length when it stays until moved on (held, on
   * Link's bars, moving on by itself off): the time on it counts, with no end.
   * Null when nothing plays.
   */
  position: { elapsed: number; length?: number | null } | null;
  onAudioError(e: unknown): void;
  /** The preset playing, left of the time: its name, and where it plays from as `playsFrom` says it ("from Warm-up · 3 of 10"); null or left out: nothing playing. One line, the name brighter, ellipsised before the controls or the audio input give way. */
  now?: { name: string; from?: string } | null;
}

/** Seconds as m:ss. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The bar. */
export function TransportBar({ playing, onPlayPause, onStep, stepIn, position, onAudioError, now }: TransportBarProps) {
  const endless = position !== null && (position.length === null || position.length === undefined);
  // Once the length has run out (the deck about to move on, or held there), there is nothing left to count down: the time on it alone, as with no end.
  const spent = position !== null && !endless && position.elapsed >= Math.max(0, position.length ?? 0);
  const open = endless || spent;
  const length = position && !open ? Math.max(0, position.length ?? 0) : 0;
  const elapsed = position ? (open ? Math.max(0, position.elapsed) : Math.min(Math.max(0, position.elapsed), length)) : 0;
  return (
    <div className="lay-transport" role="region" aria-label="transport">
      <div className="lay-transport-keys">
        <button type="button" className="lay-transport-key lay-transport-prev" aria-label="previous preset" title={`Previous preset${stepIn} (←)`} onClick={() => onStep(-1)}>
          <Icon name="previous" />
        </button>
        <button
          type="button"
          className="lay-transport-key lay-transport-play"
          aria-label={playing ? 'pause' : 'play'}
          title={playing ? 'Hold on this preset' : 'Move on by itself again'}
          onClick={onPlayPause}
        >
          <Icon name={playing ? 'pause' : 'play'} size={18} />
        </button>
        <button type="button" className="lay-transport-key" aria-label="next preset" title={`Next preset${stepIn} (→)`} onClick={() => onStep(1)}>
          <Icon name="next" />
        </button>
        <button type="button" className="lay-transport-key lay-transport-random" aria-label="random preset" title={`Random preset${stepIn} (R)`} onClick={() => onStep(0)}>
          R
        </button>
      </div>
      <div className="lay-transport-mid">
        {now && (
          <p className="lay-transport-now" title={now.from ? `${now.name} ${now.from}` : now.name}>
            <span className="lay-transport-name">{now.name}</span>
            {now.from && (
              <span className="lay-transport-from">
                <Numbers text={now.from} />
              </span>
            )}
          </p>
        )}
        <div className="lay-transport-time" data-off={position ? undefined : ''} data-open={open ? '' : undefined}>
          {open ? (
            <>
              {/* No end to count down to (or none left): the time on it, and a track with nothing to fill. */}
              <span className="lay-transport-num" role="timer" aria-label={`time on this preset: ${clock(elapsed)}${endless ? ', until moved on' : ''}`}>
                {clock(elapsed)}
              </span>
              <div className="lay-transport-track" aria-hidden="true" />
              <span className="lay-transport-num" aria-hidden="true" />
            </>
          ) : position ? (
            <>
              <span className="lay-transport-num">{clock(elapsed)}</span>
              <div
                className="lay-transport-track"
                role="progressbar"
                aria-label="time on this preset"
                aria-valuemin={0}
                aria-valuemax={length}
                aria-valuenow={elapsed}
                aria-valuetext={`${clock(elapsed)} of ${clock(length)}`}
              >
                <div className="lay-transport-fill" style={{ width: length ? `${(elapsed / length) * 100}%` : '0%' }} />
              </div>
              <span className="lay-transport-num">−{clock(length - elapsed)}</span>
            </>
          ) : (
            <div className="lay-transport-track" aria-hidden="true" />
          )}
        </div>
      </div>
      <div className="lay-transport-right">
        <FrameRate slowOnly />
        <SourcePicker onError={onAudioError} channels="none" width={180} />
      </div>
    </div>
  );
}
