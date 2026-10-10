import { Button } from '@openflow/widgets/controls/Button.tsx';
import { SourcePicker } from './SourcePicker.tsx';
import { FrameRate, Preview } from './views.tsx';
import { Say } from './words.ts';
import './homebar.css';

export interface HomeBarProps {
  /** The preset playing; null before anything plays (say "nothing playing" quietly). */
  name: string | null;
  /** Where it comes from, with its place, e.g. "from the library · 7 of 412" (the caller computes it). */
  from: string;
  /** Step: -1 previous, 1 next, 0 random. */
  onStep(by: -1 | 0 | 1): void;
  /** Words added to the step buttons' tooltips, e.g. " in the playlist" ('' when none). */
  stepIn: string;
  /** The Now Playing panel is open. */
  panel: boolean;
  /** Show or hide the panel; `from` says which control asked: the toggle, or the small preview (which only opens it, and hands focus to it). */
  onPanel(from: 'toggle' | 'mini'): void;
  /** Show the small preview at the bar's left (the panel, which has the big one, is closed). Clicking it opens the panel (onPanel('mini')). */
  mini: boolean;
  onLive(): void;
  onAudioError(e: unknown): void;
}

/**
 * The home's bottom bar (decision 67, Apple Music's transport): what plays and
 * where from on the left, ◀ ▶ R in the middle, and the audio input, the Now
 * Playing panel's toggle and "go live" on the right. With `mini` it carries a
 * small preview, which is a hole the engine's view shows through: nothing
 * behind it paints, and the preview's own spread shadow paints the bar.
 */
export function HomeBar({ name, from, onStep, stepIn, panel, onPanel, mini, onLive, onAudioError }: HomeBarProps) {
  return (
    <div className="home-bar" role="region" aria-label="now playing" data-mini={mini ? '' : undefined}>
      {mini && (
        <button type="button" className="home-bar-mini-button" aria-label="show the now playing panel" title="Show the now playing panel" onClick={() => onPanel('mini')}>
          <Preview className="home-bar-mini" />
        </button>
      )}
      <div className="home-bar-who">
        <div className="home-bar-text">
          {name ? (
            <b className="home-bar-name" title={name}>
              {name}
            </b>
          ) : (
            <span className="home-bar-name" data-none="">
              Nothing playing
            </span>
          )}
          {from && (
            <span className="home-bar-from" title={from}>
              <Numbers text={from} />
            </span>
          )}
        </div>
      </div>
      <div className="home-bar-transport">
        <Button onPress={() => onStep(-1)} label="previous preset" title={`previous preset${stepIn} (←)`}>
          ◀
        </Button>
        <Button onPress={() => onStep(1)} label="next preset" title={`next preset${stepIn} (→)`}>
          ▶
        </Button>
        <Button onPress={() => onStep(0)} label="random preset" title={`random preset${stepIn} (R)`}>
          R
        </Button>
      </div>
      <div className="home-bar-right">
        <SourcePicker onError={onAudioError} channels="none" width={180} />
        <FrameRate slowOnly />
        <button type="button" className="home-bar-panel" aria-label="now playing panel" aria-pressed={panel} title="Show or hide the now playing panel" onClick={() => onPanel('toggle')}>
          ◫
        </button>
        <button type="button" className="home-bar-live" title="Live: the output full screen on a display, with performing controls" onClick={onLive}>
          <span className="home-bar-led" aria-hidden="true" />
          {Say('live mode')}
        </button>
      </div>
    </div>
  );
}

/** `text` with its numbers ("7 of 9,795") in the numbers' face. */
export function Numbers({ text }: { text: string }) {
  const parts = text.split(/(\d[\d,.]*(?: of \d[\d,.]*)?)/);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 ? (
          <span key={i} className="home-bar-num">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}
