import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Slider, Text, type Param } from '@satoramoto/zen';
import { detentSays, TUNE_DETENTS, TUNE_POSITION_MAX, TUNE_POSITION_MIN, TUNE_STEPS, tuneDragged, tuneNudged, tunePosition, tuneSays, tuneStepped, tuneTyped } from '../model/inspector-model';

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

const SPAN = TUNE_POSITION_MAX - TUNE_POSITION_MIN;
/** A multiplier's place along the rail, 0 (¼×) to 1 (4×). */
const along = (multiplier: number) => (tunePosition(multiplier) - TUNE_POSITION_MIN) / SPAN;

/**
 * **Job.** One tune value as an instrument's control: a log rail from ¼× to 4× with detents at
 * each doubling (a drag catches on them within a sixth of a doubling, the arrows step between
 * them, Shift+arrow nudges a twelfth, Home/End go to the ends), filled from 1× to the value, the
 * fraction under each detent, and a readout that takes a typed value ("0.5", "1/2", "½", "2x").
 * Double-click, Delete or Backspace put it back to 1×. With `value` null (several presets that
 * differ) it reads "Mixed" with no knob or fill, and any move sets the value for all of them.
 *
 * **Built on.** zen's `Slider` in its `row` layout for the rail (its gesture: a drag grabs the
 * value where it is, ⌘ for fine; its double-click back to the default, 1×), its own caption and
 * reading turned off: the caption and the readout above it are zen `Text`s, so the readout can be
 * a button that turns into a field. The detents' keys are taken here, in the capture phase, before
 * zen's arrows step by a twelfth. Tune.css draws the ticks and labels.
 */
export function TuneSlider({ name, value, onChange, disabled = false, title }: TuneSliderProps) {
  const caption = useId();
  const readoutButton = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const wasEditing = useRef(false);
  const mixed = value === null;
  const says = disabled ? NONE : mixed ? MIXED : tuneSays(value);

  useEffect(() => {
    if (editing !== null && !wasEditing.current) input.current?.select();
    if (editing === null && wasEditing.current) readoutButton.current?.focus();
    wasEditing.current = editing !== null;
  }, [editing]);

  const set = (v: number) => {
    if (disabled || v === value) return;
    onChange(v);
  };

  // The detents' keys, before zen's Slider takes the arrows (a twelfth each) and Home/End.
  const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || (e.target as HTMLElement).getAttribute('role') !== 'slider') return;
    const from = value ?? 1;
    let v: number;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        v = e.shiftKey ? tuneNudged(from, 1) : tuneStepped(from, 1);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        v = e.shiftKey ? tuneNudged(from, -1) : tuneStepped(from, -1);
        break;
      case 'Home':
        v = TUNE_DETENTS[0];
        break;
      case 'End':
        v = TUNE_DETENTS[TUNE_DETENTS.length - 1];
        break;
      case 'Delete':
      case 'Backspace':
        v = 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    set(v);
  };

  // Whether the typing is still open: the blur that follows Enter or Escape (as the field goes) mustn't commit again.
  const typing = useRef(false);
  const startTyping = () => {
    typing.current = true;
    setEditing(mixed ? '' : String(value));
  };
  const commit = () => {
    if (!typing.current || editing === null) return;
    typing.current = false;
    const v = tuneTyped(editing);
    setEditing(null);
    if (v !== null) set(v);
  };
  const onInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      // Only the typing ends: the inspector closes on an Escape nobody took.
      e.preventDefault();
      e.stopPropagation();
      typing.current = false;
      setEditing(null);
    }
  };

  return (
    <div className="vs-tune-slider" data-disabled={disabled || undefined} data-mixed={(mixed && !disabled) || undefined} onKeyDownCapture={onKeyDownCapture}>
      <div className="vs-tune-slider-line">
        <Text role="caption" className="vs-tune-slider-caption" id={caption} truncate>
          {name}
        </Text>
        {editing !== null ? (
          <input
            ref={input}
            className="vs-tune-slider-entry"
            type="text"
            inputMode="decimal"
            aria-label={`${name}, as a multiple`}
            value={editing}
            onChange={(e) => setEditing(e.target.value)}
            onKeyDown={onInputKey}
            onBlur={commit}
            autoFocus
            spellCheck={false}
            autoComplete="off"
          />
        ) : (
          <Text
            as="button"
            type="button"
            ref={readoutButton}
            role="caption"
            weight="strong"
            tabular
            className="vs-tune-slider-readout"
            disabled={disabled}
            aria-label={`${name} ${says}, type a value`}
            title="Type a value"
            onClick={startTyping}
          >
            {says}
          </Text>
        )}
      </div>
      <Slider
        param={PARAM}
        value={mixed || disabled ? 0 : tunePosition(value)}
        onChange={(at) => set(tuneDragged(at))}
        display={says}
        orientation="horizontal"
        layout="row"
        fill={!mixed && !disabled}
        origin="center"
        length="auto"
        name=""
        label={name}
        showValue={false}
        disabled={disabled}
        className="vs-tune-rail"
        title={disabled ? undefined : title}
      />
      <div className="vs-tune-slider-labels" aria-hidden="true">
        {TUNE_DETENTS.map((d) => (
          <span key={d} className="vs-tune-slider-label" data-centre={d === 1 || undefined} style={{ '--vs-tune-at': along(d) } as CSSProperties}>
            {detentSays(d)}
          </span>
        ))}
      </div>
    </div>
  );
}
