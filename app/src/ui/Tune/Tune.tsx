import { useEffect, useRef, useState } from 'react';
import { Group } from '@satoramoto/zen';
import { Text } from '@satoramoto/zen';
import type { PresetTune } from '../model/api';
import type { Prepared } from '../model/librarySearch';
import { say } from '../model/words';
import { tuneOf, tuneShared, type InspectorProps, type Tune } from '../model/inspector-model';
import { TuneSlider } from './TuneSlider';
import './Tune.css';

/** How long a slider rests before its value is kept: a drag or held arrow key sends once, not on every step. */
export const TUNE_SEND_AFTER = 300;

/** Each value shown: a multiplier, or null where the presets differ ("Mixed"). */
type Shown = { [K in keyof Tune]: number | null };

/**
 * **Job.** "For this preset": the preset's own speed and how much it reacts, each a multiplier on
 * the playlist's or live value while it plays, for a preset that moves too fast (or too little)
 * beside the rest. Two `TuneSlider`s on a log rail, ¼× to 4× with 1× in the middle and detents at
 * each doubling, and "as made" to put both back once either differs.
 *
 * With several presets ("for these presets") a value they share shows as it is and one they differ
 * on reads "Mixed"; moving it sets it on all of them, and "as made" clears all of them.
 *
 * What the sliders show runs ahead of what is kept: a change is sent as `onSet(keys, { tune })` once
 * the slider rests, and any still waiting is sent when the card goes. Mount it keyed by its
 * presets' keys.
 *
 * **Changed.** The card is a zen `Group` named by its heading, with "as made" as the group's aside;
 * the sliders are TuneSlider (zen's `Slider` row with the original's detents, labels, "Mixed" and
 * typed readout), no longer zen's plain Slider row.
 *
 * **Kept.** The behaviour (log scale, the rest before sending, double-click back to 1×, sending what
 * waits on unmount), the names, titles and words.
 */
export function TuneCard({ subjects, onSet }: { subjects: readonly Prepared[]; onSet: InspectorProps['onSet'] }) {
  const keys = subjects.map((s) => s.row.key);
  const tunes = subjects.map((s) => tuneOf(s.mine));
  const kept: Shown = { speed: tuneShared(tunes, 'speed'), sensitivity: tuneShared(tunes, 'sensitivity') };
  const [shown, setShown] = useState<Shown>(kept);
  const waiting = useRef<PresetTune | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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
  const tuned = shown.speed !== 1 || shown.sensitivity !== 1;
  const several = subjects.length > 1;
  const it = several ? 'them' : 'it';

  return (
    <Group
      name={several ? say('preset tune many') : say('preset tune')}
      direction="column"
      gap={2}
      className="vs-tune"
      aside={
        tuned && (
          <Text as="button" type="button" className="vs-tune-reset" onClick={reset} title={`Play ${it} ${say('preset tune reset')}: ${several ? 'their' : 'its'} own speed and ${say('preset sensitivity')}`}>
            {say('preset tune reset')}
          </Text>
        )
      }
    >
      <TuneSlider
        name={say('preset speed')}
        value={shown.speed}
        onChange={(v) => change('speed', v)}
        title={`How fast ${several ? 'these presets move' : 'this preset moves'}, whatever plays ${it} (double-click puts it back to 1×)`}
      />
      <TuneSlider
        name={say('preset sensitivity')}
        value={shown.sensitivity}
        onChange={(v) => change('sensitivity', v)}
        title={`How much ${several ? 'these presets react' : 'this preset reacts'} to the music, whatever plays ${it} (double-click puts it back to 1×)`}
      />
    </Group>
  );
}
