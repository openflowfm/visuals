import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import {
  CORNER_NAMES,
  isSquare,
  type Corner,
  type CornerName,
  type Corners,
} from '../render/output.ts';
import { GAIN_RANGE } from '../state/useOutput.ts';
import './align.css';

/**
 * Four handles, for pointing a projector that isn't square to the wall.
 *
 * The picture itself is warped by the compositor's last pass; these are just the
 * corners of it, drawn where they actually are. Which means you drag the handle
 * that is nearest the part of the wall you are looking at, rather than reasoning
 * about which end of a "keystone" slider is which — the reason cheap projectors'
 * own two-slider correction is so unpleasant to use.
 *
 * The grid comes on with the mode and is drawn in **source** space, so it
 * arrives on the wall already warped. Line the grid up until it is square where
 * the picture is going and the picture is square too; there is nothing else to
 * check.
 */
const LABELS: Record<CornerName, string> = {
  tl: 'top left',
  tr: 'top right',
  br: 'bottom right',
  bl: 'bottom left',
};

export function Align({
  corners,
  gain,
  moveCorner,
  setGain,
  reset,
  onClose,
}: {
  corners: Corners;
  gain: number;
  moveCorner(name: CornerName, to: Corner): void;
  setGain(next: number): void;
  reset(): void;
  onClose(): void;
}) {
  const held = useRef<number | null>(null);

  const drag = (name: CornerName) => ({
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      e.currentTarget.focus();
      held.current = e.pointerId;
    },
    onPointerMove: (e: PointerEvent<HTMLButtonElement>) => {
      if (held.current !== e.pointerId) return;
      moveCorner(name, [e.clientX / window.innerWidth, e.clientY / window.innerHeight]);
    },
    onPointerUp: (e: PointerEvent<HTMLButtonElement>) => {
      if (held.current === e.pointerId) held.current = null;
    },
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
      const step: Record<string, Corner> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const by = step[e.key];
      if (!by) return;
      // Held for one pixel, loose for four — the same bargain every control in
      // this repo makes with Shift, and four is about as coarse as an alignment
      // ever wants to be.
      e.preventDefault();
      e.stopPropagation();
      const pixels = e.shiftKey ? 1 : 4;
      const [x, y] = corners[name];
      moveCorner(name, [
        x + (by[0] * pixels) / window.innerWidth,
        y + (by[1] * pixels) / window.innerHeight,
      ]);
    },
  });

  return (
    <div className="align">
      {CORNER_NAMES.map((name) => {
        const [x, y] = corners[name];
        return (
          <button
            key={name}
            type="button"
            className="pin"
            data-corner={name}
            style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
            aria-label={`${LABELS[name]} corner`}
            title={LABELS[name]}
            {...drag(name)}
          />
        );
      })}

      <div className="alignbar">
        <b>output</b>
        <span>drag a corner, or arrow it — hold shift for one pixel</span>
        <label className="gain">
          bright
          <input
            type="range"
            min={GAIN_RANGE.min}
            max={GAIN_RANGE.max}
            step={0.01}
            value={gain}
            aria-label="Master brightness"
            onChange={(e) => setGain(Number(e.target.value))}
          />
          <i>{Math.round(gain * 100)}%</i>
        </label>
        <button type="button" onClick={reset} disabled={isSquare(corners)}>
          square
        </button>
        <button type="button" onClick={onClose}>
          done
        </button>
      </div>
    </div>
  );
}
