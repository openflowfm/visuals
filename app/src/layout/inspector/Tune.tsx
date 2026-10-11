import { useEffect, useId, useRef, useState } from 'react';
import type { PresetTune } from '../../api.ts';
import type { Prepared } from '../../librarySearch.ts';
import { say } from '../../words.ts';
import { tuneOf, tuneShared, type InspectorProps, type Tune } from './model.ts';
import { TuneSlider } from './TuneSlider.tsx';
import './tune.css';

/** How long a slider rests before its value is kept: a drag or held arrow key sends once, not on every step. */
export const TUNE_SEND_AFTER = 300;

/** The card's heading for several presets at once (words.ts has the one for a single preset). */
export const FOR_THESE = 'for these presets';

/** Each value shown: a multiplier, or null where the presets differ ("Mixed"). */
type Shown = { [K in keyof Tune]: number | null };

/**
 * "For this preset": the preset's own speed and how much it reacts, each a
 * multiplier on the playlist's or live value while it plays, for a preset that
 * moves too fast (or too little) beside the rest. Two `TuneSlider`s on a log
 * scale, ¼× to 4× with 1× in the middle, and "as made" to put both back once
 * either differs.
 *
 * With several presets ("for these presets") a value they share shows as it
 * is and one they differ on reads "Mixed"; moving it sets it on all of them.
 * With none (nothing playing, a playlist) the card stays in place, disabled,
 * so the inspector's sections never jump.
 *
 * What the sliders show runs ahead of what is kept: a change is sent as
 * `onSet(keys, { tune })` once the slider rests, and any still waiting is
 * sent when the card goes. Mount it keyed by its presets' keys.
 */
export function TuneCard({ subjects, onSet }: { subjects: readonly Prepared[]; onSet: InspectorProps['onSet'] }) {
  const keys = subjects.map((s) => s.row.key);
  const tunes = subjects.map((s) => tuneOf(s.mine));
  const kept: Shown = { speed: tuneShared(tunes, 'speed'), sensitivity: tuneShared(tunes, 'sensitivity') };
  const none = subjects.length === 0;
  const [shown, setShown] = useState<Shown>(kept);
  const waiting = useRef<PresetTune | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const heading = useId();

  // Sends whatever waits; read through a ref so the timer and the unmount see the latest keys and `onSet`.
  const send = useRef(() => {});
  send.current = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const tune = waiting.current;
    waiting.current = null;
    if (tune && keys.length) onSet(keys, { tune });
  };
  useEffect(() => () => send.current(), []);

  // Follow what is kept (a change from elsewhere, or this one coming back), unless one is waiting to go.
  useEffect(() => {
    if (!waiting.current) setShown({ speed: kept.speed, sensitivity: kept.sensitivity });
  }, [kept.speed, kept.sensitivity]);

  const change = (which: keyof Tune, value: number) => {
    if (none) return;
    setShown((t) => (t[which] === value ? t : { ...t, [which]: value }));
    waiting.current = { ...waiting.current, [which]: value };
    clearTimeout(timer.current);
    timer.current = setTimeout(() => send.current(), TUNE_SEND_AFTER);
  };
  const reset = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    waiting.current = null;
    setShown({ speed: 1, sensitivity: 1 });
    onSet(keys, { clear_tune: true });
  };

  // "as made" shows while any of them differs from 1× (a "Mixed" value always does).
  const tuned = !none && (shown.speed !== 1 || shown.sensitivity !== 1);
  const several = subjects.length > 1;

  return (
    <div className="insp-tune" role="group" aria-labelledby={heading} data-appearance="dark">
      <div className="insp-tune-head">
        <p className="insp-tune-title" id={heading}>
          {several ? FOR_THESE : say('preset tune')}
        </p>
        {tuned && (
          <button
            type="button"
            className="insp-tune-reset"
            onClick={reset}
            title={`Play ${several ? 'them' : 'it'} ${say('preset tune reset')}: ${several ? 'their' : 'its'} own speed and ${say('preset sensitivity')}`}
          >
            {say('preset tune reset')}
          </button>
        )}
      </div>
      <TuneSlider
        name={say('preset speed')}
        value={shown.speed}
        onChange={(v) => change('speed', v)}
        disabled={none}
        title={`How fast ${several ? 'these presets move' : 'this preset moves'}, whatever plays ${several ? 'them' : 'it'} (double-click puts it back to 1×)`}
      />
      <TuneSlider
        name={say('preset sensitivity')}
        value={shown.sensitivity}
        onChange={(v) => change('sensitivity', v)}
        disabled={none}
        title={`How much ${several ? 'these presets react' : 'this preset reacts'} to the music, whatever plays ${several ? 'them' : 'it'} (double-click puts it back to 1×)`}
      />
    </div>
  );
}
