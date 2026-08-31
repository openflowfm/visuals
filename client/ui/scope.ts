import type { Circuit } from '../../protocol.ts';
import type { NumberSample } from '../render/evaluateNumber.ts';
import { previewOutletOf } from './probe.ts';

/**
 * The oscilloscope face: what a number outlet looks like.
 *
 * A number used to be shown the way `colorway` would show it — bridged into a
 * frame of the active colour at that brightness. That crossing is honest as a
 * wiring ("this is what it does to a picture") and useless as a reading: a
 * blinking rectangle cannot tell a sine from a saw, and the bridge's `colorway`
 * charges its colour with the room's energy besides, so the face throbbed with
 * a signal that was not the node's. The outlet readout beside it came off the
 * CPU evaluator and told the truth, which made the face's lie visible.
 *
 * So a face whose outlet is a *number* is a scope now, drawn from the same
 * evaluator the readouts already use — one path, so the face and the number
 * beside it cannot disagree. The sweep is synced to the bar rather than
 * free-running: the write head crosses the face once per quantum and wraps, so
 * a synced square at 1/4 is four stationary steps rather than a crawl, and a
 * phase offset is a visible shift instead of nothing.
 *
 * Everything here is unit-space geometry so it can be tested without a canvas:
 * `x` is position through the bar's sweep, `y` is the value, both 0–1. Only
 * `drawScope` touches pixels.
 */

/** One reading of a scoped outlet, at the beat it was taken. */
export interface ScopeSample {
  beat: number;
  /** The outlet's value, or null for a tick the evaluator could not answer. */
  value: number | null;
}

/** An unbroken run of the trace, in unit space. */
export type ScopeSweep = { x: number; y: number }[];

/**
 * More than a bar's worth of frames at any plausible tempo, and a hard wall
 * against a very slow one filling memory: past the cap the oldest go first, so
 * the trace loses its tail rather than its head.
 */
export const SCOPE_SAMPLE_CAP = 600;

const fract = (value: number): number => value - Math.floor(value);
const clamp = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * Which faces are scopes, as node id → the outlet id the scope watches.
 *
 * Two questions, both asked of what already decides them. The outlet is
 * whichever one the face would have shown (`previewOutletOf`), so the picked
 * chip keeps working. And it must be a number the CPU evaluator can actually
 * answer — `polar`'s radius is a number *per pixel* and a flow's door crosses
 * a boundary the evaluator does not walk, and both of those stay pictures,
 * because a scope with nothing to plot is worse than the bridge it replaced.
 * Answerability is a fact about the wiring, not the moment, so one sample per
 * circuit settles it.
 */
export function scopeOutlets(circuit: Circuit, sample: NumberSample): Map<string, string> {
  const scoped = new Map<string, string>();
  for (const node of circuit.nodes) {
    const outlet = previewOutletOf(circuit, node.id);
    if (!outlet || outlet.kind !== 'n') continue;
    const id = `${node.id}/${outlet.name}`;
    if (sample.outlet(id) === undefined) continue;
    scoped.set(node.id, id);
  }
  return scoped;
}

/**
 * Append one reading and keep the buffer exactly one window deep.
 *
 * Mutates in place — one array per outlet lives for the life of the loop, and
 * an allocation per face per frame is the kind of garbage a rAF loop should
 * not make. A sample as old as the window is dropped rather than kept: the
 * head is about to overwrite that column, and a stale point under the fresh
 * one draws a seam. A beat that moved *backwards* clears the buffer whole,
 * because Link resyncs and the room dial both jump, and a trace stitched
 * across a jump is noise wearing the shape of a signal.
 */
export function pushScopeSample(
  samples: ScopeSample[],
  next: ScopeSample,
  window: number,
  cap = SCOPE_SAMPLE_CAP,
): ScopeSample[] {
  const last = samples[samples.length - 1];
  if (last && next.beat < last.beat) samples.length = 0;
  samples.push(next);
  const oldest = next.beat - window;
  let keep = 0;
  while (keep < samples.length && samples[keep].beat <= oldest) keep++;
  if (keep > 0) samples.splice(0, keep);
  if (samples.length > cap) samples.splice(0, samples.length - cap);
  return samples;
}

/**
 * The buffer as polylines, split where a line must not be drawn.
 *
 * Two breaks. The **wrap**: every sample plots at its position through the
 * bar, so when the head crosses the right edge the next sample lands back at
 * the left, and joining those two points would draw a line across the whole
 * face. The **gap**: a null value is a tick with no answer, and bridging one
 * would invent a reading. Values are clamped here because that is what any
 * inlet this outlet feeds will do to them — `playback`'s raw beat pegs at the
 * top of the frame, which is the honest drawing of a number beyond the range.
 */
export function scopeSweeps(samples: readonly ScopeSample[], quantum: number): ScopeSweep[] {
  const sweeps: ScopeSweep[] = [];
  let open: ScopeSweep | null = null;
  let lastX = Infinity;
  for (const sample of samples) {
    if (sample.value === null) {
      open = null;
      continue;
    }
    const x = fract(sample.beat / quantum);
    if (!open || x < lastX) {
      open = [];
      sweeps.push(open);
    }
    open.push({ x, y: clamp(sample.value) });
    lastX = x;
  }
  return sweeps;
}

/** Where the write head sits right now, or nowhere when there is no answer. */
export function scopeHead(
  beat: number,
  value: number | undefined,
  quantum: number,
): { x: number; y: number } | null {
  if (value === undefined) return null;
  return { x: fract(beat / quantum), y: clamp(value) };
}

/**
 * One frame of one scope, into the face's own 2D canvas.
 *
 * The trace draws in the same amber the number cords wear, so the face is
 * legible as "this is what an `n` cord from here carries" without a caption.
 * A beat line per quantum division and a midline are the whole grid — enough
 * to read sync and level against, faint enough to never be mistaken for the
 * signal. The vertical padding keeps a full-scale square wave off the border.
 */
export function drawScope(
  face: HTMLCanvasElement,
  sweeps: readonly ScopeSweep[],
  head: { x: number; y: number } | null,
  quantum: number,
  color: string,
): void {
  const ctx = face.getContext('2d');
  if (!ctx) return;
  const { width, height } = face;
  const pad = Math.round(height * 0.09);
  const xAt = (x: number) => x * width;
  const yAt = (y: number) => pad + (1 - y) * (height - pad * 2);

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);

  const beats = Math.max(1, Math.round(quantum));
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.14;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let at = 1; at < beats; at++) {
    const x = Math.round(xAt(at / beats)) + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  const mid = Math.round(yAt(0.5)) + 0.5;
  ctx.moveTo(0, mid);
  ctx.lineTo(width, mid);
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const sweep of sweeps) {
    if (sweep.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(xAt(sweep[0].x), yAt(sweep[0].y));
    for (let at = 1; at < sweep.length; at++) ctx.lineTo(xAt(sweep[at].x), yAt(sweep[at].y));
    ctx.stroke();
  }

  if (head) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(xAt(head.x), yAt(head.y), 3, 0, Math.PI * 2);
    ctx.fill();
  }
}
