import { useRef } from 'react';
import { Slider, stepDetent, type Param, type ParamKeyStep } from '@satoramoto/zen';
import { detentSays, TUNE_CATCH, TUNE_DETENTS, TUNE_POSITION_MAX, TUNE_POSITION_MIN, TUNE_STEPS, tuneAt, tuneNudged, tunePosition, tuneSays, tuneTyped } from '../model/inspector-model';

/** What the readout says when several presets differ. */
export const MIXED = 'Mixed';
/** What the readout says with nothing to tune. */
export const NONE = '–';

export interface TuneSliderProps {
  /** Its caption and accessible name ("speed"). */
  name: string;
  /** The multiplier shown; null when the presets it stands for differ ("Mixed": no knob, no fill). */
  value: number | null;
  /** A new multiplier, from a drag, a key, a double-click or one typed. */
  onChange(multiplier: number): void;
  /** Nothing to tune: dimmed, no knob, not focusable, readout "–". */
  disabled?: boolean;
  /** The hover hint on the rail. */
  title?: string;
}

/** The rail's parameter: the multiplier's log2, −2 (¼×) to 2 (4×), on twelfths of a doubling; its default (double-click) 1×. */
const PARAM: Param = { kind: 'float', min: TUNE_POSITION_MIN, max: TUNE_POSITION_MAX, defaultValue: 0, steps: TUNE_STEPS };

/** The detents on the rail, as positions (−2 to 2); zen draws the one at the default (1×) tallest. */
const DETENTS = TUNE_DETENTS.map(tunePosition);

/** The keys zen's Slider asks first: the arrows step to the next detent (Shift nudges a twelfth), Delete and Backspace go back to 1×. Home/End are zen's own, the ends. */
const keyStep: ParamKeyStep = ({ key, shiftKey }, at) => {
  const way = key === 'ArrowRight' || key === 'ArrowUp' ? 1 : key === 'ArrowLeft' || key === 'ArrowDown' ? -1 : 0;
  if (way) return shiftKey ? tunePosition(tuneNudged(tuneAt(at), way)) : stepDetent(DETENTS, at, way);
  if (key === 'Delete' || key === 'Backspace') return PARAM.defaultValue;
  return undefined;
};

/** A detent's fraction under the rail ("¼", "1"). */
const detentLabel = (at: number) => detentSays(tuneAt(at));

/**
 * **Job.** One tune value as an instrument's control: a log rail from ¼× to 4× with detents at
 * each doubling (a drag catches on them within a sixth of a doubling, the arrows step between
 * them, Shift+arrow nudges a twelfth, Home/End go to the ends), filled from 1× to the value, the
 * fraction under each detent, and a readout that takes a typed value ("0.5", "1/2", "½", "2x").
 * Double-click, Delete or Backspace put it back to 1×. With `value` null (several presets that
 * differ) it reads "Mixed" with no knob or fill, and any move sets the value for all of them.
 *
 * **Built on.** zen's `Slider` in its `row` layout, whole: its caption and reading on one line
 * over the rail, its gesture (a drag grabs the value where it is, ⌘ for fine; double-click back to
 * the default, 1×), the detents' ticks and the catch (`snap`), the fractions under them
 * (`detentLabel`), the keys (`keyStep`), Mixed (`mixed`) and the typed readout (`typed`: Enter
 * sets, Escape cancels and goes no further, leaving the field sets, focus back to the readout).
 * A typed value is kept as typed (clamped, not put on a twelfth); everything else goes through
 * `tuneAt`.
 */
export function TuneSlider({ name, value, onChange, disabled = false, title }: TuneSliderProps) {
  const mixed = value === null;
  const says = disabled ? NONE : mixed ? MIXED : tuneSays(value);
  // The multiplier last typed, so the change it makes is kept as typed rather than put on a twelfth.
  const typedValue = useRef<number | null>(null);

  const set = (at: number) => {
    const t = typedValue.current;
    typedValue.current = null;
    const v = t !== null && at === tunePosition(t) ? t : tuneAt(at);
    if (disabled || v === value) return;
    onChange(v);
  };

  return (
    <Slider
      param={PARAM}
      value={mixed || disabled ? 0 : tunePosition(value)}
      onChange={set}
      display={says}
      orientation="horizontal"
      layout="row"
      mixed={mixed && !disabled}
      detents={DETENTS}
      snap={TUNE_CATCH}
      keyStep={keyStep}
      detentLabel={detentLabel}
      typed={{
        parse: (text) => {
          const v = tuneTyped(text);
          typedValue.current = v;
          return v === null ? null : tunePosition(v);
        },
        format: () => (value === null ? '' : String(value)),
      }}
      fill={!disabled}
      origin="center"
      length="auto"
      name={name}
      label={name}
      showValue
      disabled={disabled}
      className="vs-tune-slider"
      title={disabled ? undefined : title}
    />
  );
}
