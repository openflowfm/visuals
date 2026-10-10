import { SourcePicker } from '../SourcePicker.tsx';
import { Icon } from './icons.tsx';
import './transport-bar.css';

/**
 * The bar along the bottom of the macOS layout's main column (HomeLayout's
 * `bar` slot): today's HomeBar reduced to the transport, since the hero above
 * carries the preview, the name and where it plays from. ◀ play/pause ▶ R on
 * the left, the time on the preset and how long until the next one in the
 * middle, the audio input on the right. No preview, so no hole: the bar paints
 * the window's own surface.
 */
export interface TransportBarProps {
  /** Whether the deck is moving on by itself (pause shows) or holding (play shows). */
  playing: boolean;
  onPlayPause(): void;
  /** Step: -1 previous, 1 next, 0 random. */
  onStep(by: -1 | 0 | 1): void;
  /** Words added to the step buttons' tooltips, e.g. " in the playlist" ('' when none). */
  stepIn: string;
  /** Seconds on the preset playing and its length before the deck moves on (the deck's `seconds`); null when nothing plays or it stays until moved on. */
  position: { elapsed: number; length: number } | null;
  onAudioError(e: unknown): void;
}

/** Seconds as m:ss. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The bar. */
export function TransportBar({ playing, onPlayPause, onStep, stepIn, position, onAudioError }: TransportBarProps) {
  const length = position ? Math.max(0, position.length) : 0;
  const elapsed = position ? Math.min(Math.max(0, position.elapsed), length) : 0;
  return (
    <div className="lay-transport" role="region" aria-label="transport">
      <div className="lay-transport-keys">
        <button type="button" className="lay-transport-key lay-transport-prev" aria-label="previous preset" title={`Previous preset${stepIn} (←)`} onClick={() => onStep(-1)}>
          <Icon name="next" />
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
      <div className="lay-transport-time" data-off={position ? undefined : ''}>
        {position ? (
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
      <div className="lay-transport-right">
        <SourcePicker onError={onAudioError} channels="none" width={180} />
      </div>
    </div>
  );
}
