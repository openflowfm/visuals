import { useEffect, useId, useRef, useState } from 'react';
import { Slider } from '@openflow/widgets/controls/Slider.tsx';
import type { Param } from '@openflow/widgets/param/param.ts';
import type { PresetTune } from '../../api.ts';
import { formatMultiplier } from '../../controls.ts';
import type { Prepared } from '../../librarySearch.ts';
import { say } from '../../words.ts';
import { asMade, TUNE_POSITION_MAX, TUNE_POSITION_MIN, TUNE_STEPS, tuneAt, tuneOf, tunePosition, type InspectorProps, type Tune } from './model.ts';
import './tune.css';

/** How long a slider rests before its value is kept: a drag or held arrow key sends once, not on every step. */
export const TUNE_SEND_AFTER = 300;

const position = (name: string): Param => ({ kind: 'float', min: TUNE_POSITION_MIN, max: TUNE_POSITION_MAX, defaultValue: 0, steps: TUNE_STEPS, name });
const SPEED = position(say('preset speed'));
const SENSITIVITY = position(say('preset sensitivity'));

/**
 * "For this preset": the preset's own speed and how much it reacts, each a
 * multiplier on the playlist's or live value while it plays, for a preset that
 * moves too fast (or too little) beside the rest. Two sliders on a log scale,
 * ¼× to 4× with 1× in the middle, and "as made" to put both back once either
 * differs. What the sliders show runs ahead of what is kept: a change is sent
 * as `onSet([key], { tune })` once the slider rests, and any still waiting is
 * sent when the inspector moves to another preset. Mount it keyed by the
 * preset's key.
 */
export function TuneCard({ subject, onSet }: { subject: Prepared; onSet: InspectorProps['onSet'] }) {
  const key = subject.row.key;
  const kept = tuneOf(subject.mine);
  const [shown, setShown] = useState<Tune>(kept);
  const waiting = useRef<PresetTune | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const heading = useId();

  // Sends whatever waits; read through a ref so the timer and the unmount see the latest `onSet`.
  const send = useRef(() => {});
  send.current = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const tune = waiting.current;
    waiting.current = null;
    if (tune) onSet([key], { tune });
  };
  useEffect(() => () => send.current(), []);

  // Follow what is kept (a change from elsewhere, or this one coming back), unless one is waiting to go.
  useEffect(() => {
    if (!waiting.current) setShown({ speed: kept.speed, sensitivity: kept.sensitivity });
  }, [kept.speed, kept.sensitivity]);

  const change = (which: keyof Tune, at: number) => {
    const value = tuneAt(at);
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
    onSet([key], { clear_tune: true });
  };

  const slider = (param: Param, which: keyof Tune, title: string) => (
    <Slider
      param={param}
      value={tunePosition(shown[which])}
      onChange={(at) => change(which, at)}
      display={formatMultiplier(shown[which])}
      orientation="horizontal"
      layout="inside"
      length="auto"
      name={param.name}
      label={param.name}
      className="insp-tune-slider"
      title={`${title} (double-click puts it back to 1×)`}
    />
  );

  return (
    <div className="insp-tune" role="group" aria-labelledby={heading}>
      <div className="insp-tune-head">
        <p className="insp-kicker" id={heading}>
          {say('preset tune')}
        </p>
        {!asMade(shown) && (
          <button type="button" className="insp-tune-reset" onClick={reset} title={`Play it ${say('preset tune reset')}: its own speed and ${say('preset sensitivity')}`}>
            {say('preset tune reset')}
          </button>
        )}
      </div>
      {slider(SPEED, 'speed', 'How fast this preset moves, whatever plays it')}
      {slider(SENSITIVITY, 'sensitivity', `How much this preset reacts to the music, whatever plays it`)}
    </div>
  );
}
