import { CHAIN, type Stage } from '../stages.ts';

/** Where the graph's nodes sit and how they're wired. */

export interface Cord {
  from: string;
  to: string;
  kind?: string;
}

export const port = (stage: string, side: 'in' | 'out') => `${stage}:${side}`;

/** A chain node's width, and the small ends'. */
export const WIDE = 168;
export const NARROW = 88;
const GAP = 24;
/** The gap between warp and feedback, wider: the layers' cords rise through it. */
export const FEED_GAP = 64;
const PAD = 12;
/** Where the layers start, under the chain, and how far apart they stack. */
const LAYER_TOP = 256;
const LAYER_PITCH = 120;

/** Where each node sits, with the add button as `add`. The chain runs along the
 * top; the layers stack in one column under warp, their outlets in line with
 * warp's, so every cord to the feedback rises through the gap between warp and
 * feedback and crosses no node (a cord leaves an outlet rightwards and reaches
 * an inlet from the left: from a second column further left it would run
 * through the first and under warp). The add button waits under the feedback,
 * where the layers' cords meet. */
export function layout(layers: Stage[]): Record<string, { x: number; y: number }> {
  const at: Record<string, { x: number; y: number }> = {};
  let x = PAD;
  for (const s of CHAIN) {
    at[s.id] = { x, y: PAD };
    x += (s.kind === 'source' || s.kind === 'out' ? NARROW : WIDE) + (s.id === 'warp' ? FEED_GAP : GAP);
  }
  layers.forEach((s, n) => {
    at[s.id] = { x: at.warp.x, y: LAYER_TOP + n * LAYER_PITCH };
  });
  at.add = { x: at.feedback.x, y: LAYER_TOP };
  return at;
}

/** The cords: the chain in order, and every layer into the feedback. */
export function cords(layers: Stage[]): Cord[] {
  const c = (a: string, b: string, kind: string): Cord => ({ from: port(a, 'out'), to: port(b, 'in'), kind });
  return [
    c('audio', 'motion', 'audio'),
    c('motion', 'warp', 'motion'),
    c('warp', 'feedback', 'picture'),
    c('feedback', 'comp', 'picture'),
    c('comp', 'out', 'picture'),
    ...layers.map((s) => c(s.id, 'feedback', 'draw')),
  ];
}
