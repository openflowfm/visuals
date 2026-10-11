import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { detentSays, TUNE_DETENTS, TUNE_POSITION_MAX, TUNE_POSITION_MIN, tuneDragged, tuneNudged, tunePosition, tuneSays, tuneStepped, tuneTyped } from './model.ts';

/** The knob's width in px: its centre runs half of it in from each end of the rail (tune.css reads it as `--tune-knob-w`). */
export const TUNE_KNOB_W = 26;

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

const SPAN = TUNE_POSITION_MAX - TUNE_POSITION_MIN;
/** A multiplier's place along the rail, 0 (¼×) to 1 (4×). */
const along = (multiplier: number) => (tunePosition(multiplier) - TUNE_POSITION_MIN) / SPAN;

/**
 * One tune value as an instrument's control: a log rail from ¼× to 4× with
 * detents at each doubling (a drag catches on them, the arrows step between
 * them, Shift+arrow nudges a twelfth), filled from 1× to the value, a glass
 * knob, the fraction under each detent, and a readout that takes a typed
 * value. Double-click, Delete or Backspace put it back to 1×.
 */
export function TuneSlider({ name, value, onChange, disabled = false, title }: TuneSliderProps) {
  const caption = useId();
  const rail = useRef<HTMLDivElement>(null);
  const readoutButton = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [held, setHeld] = useState(false);
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

  const at = (clientX: number) => {
    const r = rail.current?.getBoundingClientRect();
    if (!r || r.width <= TUNE_KNOB_W) return null;
    const f = Math.min(1, Math.max(0, (clientX - r.left - TUNE_KNOB_W / 2) / (r.width - TUNE_KNOB_W)));
    return tuneDragged(TUNE_POSITION_MIN + f * SPAN);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    rail.current?.focus();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // No capture (an old engine, or a test DOM): the drag still follows while over the rail.
    }
    setHeld(true);
    const v = at(e.clientX);
    if (v !== null) set(v);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!held) return;
    const v = at(e.clientX);
    if (v !== null) set(v);
  };
  const letGo = (e: PointerEvent<HTMLDivElement>) => {
    if (!held) return;
    setHeld(false);
    try {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // As above.
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const from = value ?? 1;
    let v: number | null = null;
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

  const a = mixed || disabled ? 0.5 : along(value);
  const style = { '--tune-knob-w': `${TUNE_KNOB_W}px`, '--tune-at': a, '--tune-fill-from': Math.min(a, 0.5), '--tune-fill-size': Math.abs(a - 0.5) } as CSSProperties;

  return (
    <div className="tune-slider" data-disabled={disabled || undefined} data-mixed={(mixed && !disabled) || undefined} data-held={held || undefined} style={style}>
      <div className="tune-slider-line">
        <span className="tune-slider-caption" id={caption}>
          {name}
        </span>
        {editing !== null ? (
          <input
            ref={input}
            className="tune-slider-entry"
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
          <button ref={readoutButton} type="button" className="tune-slider-readout" disabled={disabled} aria-label={`${name} ${says}, type a value`} title="Type a value" onClick={startTyping}>
            {says}
          </button>
        )}
      </div>
      <div
        ref={rail}
        className="tune-slider-rail"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-labelledby={caption}
        aria-orientation="horizontal"
        aria-valuemin={TUNE_POSITION_MIN}
        aria-valuemax={TUNE_POSITION_MAX}
        aria-valuenow={mixed || disabled ? 0 : tunePosition(value)}
        aria-valuetext={says}
        aria-disabled={disabled || undefined}
        title={disabled ? undefined : title}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={letGo}
        onPointerCancel={letGo}
        onLostPointerCapture={() => setHeld(false)}
        onKeyDown={onKeyDown}
        onDoubleClick={() => set(1)}
      >
        <span className="tune-slider-track" />
        {TUNE_DETENTS.map((d) => (
          <span key={d} className="tune-slider-tick" data-centre={d === 1 || undefined} style={{ '--tune-tick': along(d) } as CSSProperties} />
        ))}
        {!mixed && !disabled && <span className="tune-slider-fill" />}
        {!mixed && !disabled && <span className="tune-slider-knob" />}
      </div>
      <div className="tune-slider-labels" aria-hidden="true">
        {TUNE_DETENTS.map((d) => (
          <span key={d} className="tune-slider-label" style={{ '--tune-tick': along(d) } as CSSProperties}>
            {detentSays(d)}
          </span>
        ))}
      </div>
    </div>
  );
}
