import { describe, expect, it } from 'vitest';
import { LAYERS } from '../stages.ts';
import { FEED_GAP, WIDE, cords, layout } from './layout.ts';

const layers = (...ids: string[]) => ids.map((id) => LAYERS.find((s) => s.id === id)!);

describe('the drawing', () => {
  it('wires the chain in order and every layer into the feedback, one port a side', () => {
    const c = cords(layers('wave', 'shape1'));
    expect(c.map((x) => `${x.from} ${x.to}`)).toEqual([
      'audio:out motion:in',
      'motion:out warp:in',
      'warp:out feedback:in',
      'feedback:out comp:in',
      'comp:out out:in',
      'wave:out feedback:in',
      'shape1:out feedback:in',
    ]);
  });

  it('stacks the layers under warp, so their cords rise between warp and feedback', () => {
    const shown = layers('wave', 'wave0', 'wave1', 'wave2', 'wave3', 'shape0', 'shape1', 'vectors');
    const at = layout(shown);
    // One column, outlets in line with warp's: nothing stands between a layer and the gap.
    for (const s of shown) {
      expect(at[s.id].x).toBe(at.warp.x);
      expect(at[s.id].y).toBeGreaterThan(at.warp.y + 150);
    }
    expect(new Set(shown.map((s) => at[s.id].y)).size).toBe(shown.length);
    // The gap the cords rise through is wider than a cord's 30 px reach either side.
    expect(at.feedback.x - (at.warp.x + WIDE)).toBe(FEED_GAP);
    expect(FEED_GAP).toBeGreaterThanOrEqual(60);
    expect(at.add.x).toBe(at.feedback.x);
  });
});
