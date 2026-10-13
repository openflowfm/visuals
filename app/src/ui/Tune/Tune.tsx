import { useEffect, useRef, useState } from 'react';
import { Group } from '@satoramoto/zen';
import { Slider } from '@satoramoto/zen';
import { Text } from '@satoramoto/zen';
import type { Param } from '@satoramoto/zen';
import type { PresetTune } from '../model/api';
import { formatMultiplier } from '../model/controls';
import type { Prepared } from '../model/librarySearch';
import { say } from '../model/words';
import { asMade, TUNE_POSITION_MAX, TUNE_POSITION_MIN, TUNE_STEPS, tuneAt, tuneOf, tunePosition, type InspectorProps, type Tune } from '../model/inspector-model';
import './Tune.css';

/** How long a slider rests before its value is kept: a drag or held arrow key sends once, not on every step. */
export const TUNE_SEND_AFTER = 300;

const position = (name: string): Param => ({ kind: 'float', min: TUNE_POSITION_MIN, max: TUNE_POSITION_MAX, defaultValue: 0, steps: TUNE_STEPS, name });
const SPEED = position(say('preset speed'));
const SENSITIVITY = position(say('preset sensitivity'));

/**
 * **Job.** "For this preset": the preset's own speed and how much it reacts, each a multiplier on
 * the playlist's or live value while it plays, for a preset that moves too fast (or too little)
 * beside the rest. Two sliders on a log scale, ¼× to 4× with 1× in the middle (filled from there),
 * and "as made" to put both back once either differs. What the sliders show runs ahead of what is
 * kept: a change is sent as `onSet([key], { tune })` once the slider rests, and any still waiting
 * is sent when the inspector moves to another preset. Mount it keyed by the preset's key.
 *
 * **Changed.** The card is a `Group` named by its heading, with "as made" as the group's aside.
 * The sliders are the library's Apple-style `Slider` row (`row`: the name leading, the reading
 * trailing, a thin groove lit from 1× in the system accent, the knob the slider's own, a tick at
 * the 1× detent); the kit's tokens the original read aren't part of the contract.
 *
 * **Kept.** The behaviour (log scale, steps, the rest before sending, double-click back to 1×,
 * sending what waits on unmount), the names, titles and words.
 */
export function TuneCard({ subject, onSet }: { subject: Prepared; onSet: InspectorProps['onSet'] }) {
  const key = subject.row.key;
  const kept = tuneOf(subject.mine);
  const [shown, setShown] = useState<Tune>(kept);
  const waiting = useRef<PresetTune | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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
      layout="row"
      fill
      origin="center"
      length="auto"
      name={param.name}
      label={param.name}
      className="vs-tune-slider"
      title={`${title} (double-click puts it back to 1×)`}
    />
  );

  return (
    <Group
      name={say('preset tune')}
      direction="column"
      gap={2}
      className="vs-tune"
      aside={
        !asMade(shown) && (
          <Text as="button" type="button" className="vs-tune-reset" onClick={reset} title={`Play it ${say('preset tune reset')}: its own speed and ${say('preset sensitivity')}`}>
            {say('preset tune reset')}
          </Text>
        )
      }
    >
      {slider(SPEED, 'speed', 'How fast this preset moves, whatever plays it')}
      {slider(SENSITIVITY, 'sensitivity', `How much this preset reacts to the music, whatever plays it`)}
    </Group>
  );
}
