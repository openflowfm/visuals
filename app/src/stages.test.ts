import { describe, expect, it } from 'vitest';
import type { Preset, Problem } from './api.ts';
import { FEED_GAP, STAGES, WIDE, addLayer, cords, layersOf, layout, offers, problemsOf, removeLayer, stageFor, stageOfProblem } from './stages.ts';

const wave = () => ({ values: { enabled: 0 }, init: '', frame: '', point: '' });
const shape = () => ({ values: { enabled: 0 }, init: '', frame: '' });

/** A preset that draws nothing but MilkDrop's pipeline: no waveform, no vectors, no borders. */
function blank(values: Record<string, number> = {}): Preset {
  return {
    values: { fWaveAlpha: 0, mv_a: 0, ob_a: 0, ib_a: 0, ...values },
    init: '',
    frame: '',
    vertex: '',
    waves: [wave(), wave(), wave(), wave()],
    shapes: [shape(), shape(), shape(), shape()],
    warp: '',
    comp: '',
  };
}

const ids = (p: Preset, problems: Problem[] = []) => layersOf(p, problems).map((s) => s.id);

describe('which layers show', () => {
  it('shows none for a preset that draws none', () => {
    expect(ids(blank())).toEqual([]);
  });

  it('shows enabled custom waves and shapes, and not the disabled ones', () => {
    const p = blank();
    p.waves[2].values.enabled = 1;
    p.shapes[0].values.enabled = 1;
    p.shapes[1].frame = 'x = 0.3;';
    expect(ids(p)).toEqual(['wave2', 'shape0']);
  });

  it('shows the waveform, vectors and borders when they are visible', () => {
    expect(ids(blank({ fWaveAlpha: 0.5 }))).toEqual(['wave']);
    expect(ids(blank({ mv_a: 1, nMotionVectorsX: 12, nMotionVectorsY: 9 }))).toEqual(['vectors']);
    expect(ids(blank({ mv_a: 1, nMotionVectorsX: 0 }))).toEqual([]);
    expect(ids(blank({ ob_a: 0.4, ob_size: 0.02 }))).toEqual(['border']);
    expect(ids(blank({ ib_a: 0.4, ib_size: 0 }))).toEqual([]);
  });

  it('takes the default when the file leaves a value out', () => {
    const p = blank();
    delete p.values.fWaveAlpha;
    expect(ids(p)).toEqual(['wave']);
  });

  it('shows a layer per-frame code turns up, whatever the file says', () => {
    const p = blank();
    p.frame = 'wave_a = bass*0.5;\nob_a == 1;';
    expect(ids(p)).toEqual(['wave']);
  });

  it('hides a layer per-frame code only ever zeroes, and will not offer to add it', () => {
    const p = blank({ fWaveAlpha: 0.8 });
    p.frame = 'wave_a = 0;\n// wave_a = bass;\nzoom = 1;';
    expect(ids(p)).toEqual([]);
    expect(offers(p).find((o) => o.kind === 'waveform')!.full).toBe("motion's code sets wave_a = 0");
    expect(addLayer(p, 'waveform')).toBeNull();
  });

  it('shows a disabled layer whose code has a problem, so the problem has somewhere to be', () => {
    expect(ids(blank(), [{ stage: 'shape3.frame', message: 'bad', line: 1 }])).toEqual(['shape3']);
  });
});

describe('adding a layer', () => {
  it('takes the first free custom wave slot, with starter code that draws', () => {
    const p = blank();
    p.waves[0].values.enabled = 1;
    const added = addLayer(p, 'wave')!;
    expect(added.id).toBe('wave1');
    expect(added.preset.waves[1].values.enabled).toBe(1);
    expect(added.preset.waves[1].point).toMatch(/x = /);
    expect(ids(added.preset)).toEqual(['wave0', 'wave1']);
    // Nothing else moved.
    expect(added.preset.waves[0]).toEqual(p.waves[0]);
    expect(p.waves[1].values.enabled).toBe(0);
  });

  it('turns a slot that still has code back on as it was', () => {
    const p = blank();
    p.shapes[0].frame = 'rad = 0.3;';
    p.shapes[0].values = { enabled: 0, sides: 7 };
    const added = addLayer(p, 'shape')!;
    expect(added.id).toBe('shape0');
    expect(added.preset.shapes[0]).toEqual({ ...p.shapes[0], values: { enabled: 1, sides: 7 } });
  });

  it('keeps the file spelling of a key', () => {
    const p = blank();
    p.waves[0].values = { Enabled: 0 } as Record<string, number>;
    expect(addLayer(p, 'wave')!.preset.waves[0].values.Enabled).toBe(1);
  });

  it('refuses a fifth, and the menu says so', () => {
    let p = blank();
    for (let i = 0; i < 4; i++) p = addLayer(p, 'shape')!.preset;
    expect(ids(p)).toEqual(['shape0', 'shape1', 'shape2', 'shape3']);
    expect(addLayer(p, 'shape')).toBeNull();
    expect(offers(p).find((o) => o.kind === 'shape')!.full).toBe('all 4 in use');
    expect(offers(p).find((o) => o.kind === 'wave')!.full).toBeUndefined();
  });

  it('turns on the waveform, vectors and borders, once', () => {
    const p = blank();
    for (const [kind, id] of [['waveform', 'wave'], ['vectors', 'vectors'], ['border', 'border']] as const) {
      const added = addLayer(p, kind)!;
      expect(added.id).toBe(id);
      expect(ids(added.preset)).toEqual([id]);
      expect(addLayer(added.preset, kind)).toBeNull();
    }
  });
});

describe('removing a layer', () => {
  it('turns a custom layer off and keeps its code', () => {
    const p = addLayer(blank(), 'wave')!.preset;
    const off = removeLayer(p, 'wave0')!;
    expect(ids(off)).toEqual([]);
    expect(off.waves[0].point).toBe(p.waves[0].point);
    // Adding again brings back what was there.
    expect(addLayer(off, 'wave')!.preset.waves[0]).toEqual(p.waves[0]);
  });

  it('turns the built-in layers off', () => {
    for (const id of ['wave', 'vectors', 'border']) {
      const p = blank({ fWaveAlpha: 0.8, mv_a: 1, ob_a: 0.5, ib_a: 0.5 });
      expect(ids(p)).toContain(id);
      expect(ids(removeLayer(p, id)!)).not.toContain(id);
    }
  });

  it('will not pretend to remove a layer per-frame code turns on', () => {
    const p = blank();
    p.frame = 'mv_a = 1;';
    expect(removeLayer(p, 'vectors')).toBeNull();
  });
});

describe('problems', () => {
  it('land on the node they belong to', () => {
    expect(stageOfProblem('init')).toBe('motion');
    expect(stageOfProblem('frame')).toBe('motion');
    expect(stageOfProblem('vertex')).toBe('motion');
    expect(stageOfProblem('equations')).toBe('motion');
    expect(stageOfProblem('wave0.point')).toBe('wave0');
    expect(stageOfProblem('shape2.frame')).toBe('shape2');
    expect(stageOfProblem('waves.2')).toBe('wave2');
    expect(stageOfProblem('shapes.1.init')).toBe('shape1');
    expect(stageOfProblem('warp')).toBe('warp');
    expect(stageOfProblem('comp')).toBe('comp');
  });

  it('are listed on that node and no other', () => {
    const problems: Problem[] = [
      { stage: 'wave1.frame', message: 'a', line: 2 },
      { stage: 'comp', message: 'b', line: null },
    ];
    const on = (id: string) => problemsOf(problems, STAGES.find((s) => s.id === id)!).map((p) => p.message);
    expect(on('wave1')).toEqual(['a']);
    expect(on('comp')).toEqual(['b']);
    expect(on('wave')).toEqual([]);
    expect(on('motion')).toEqual([]);
  });
});

describe('the drawing', () => {
  it('wires the chain in order and every layer into the feedback, one port a side', () => {
    const p = blank({ fWaveAlpha: 1 });
    p.shapes[1].values.enabled = 1;
    const c = cords(layersOf(p));
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
    const p = blank({ fWaveAlpha: 1, mv_a: 1 });
    for (const i of [0, 1, 2, 3]) p.waves[i].values.enabled = 1;
    for (const i of [0, 1]) p.shapes[i].values.enabled = 1;
    const layers = layersOf(p);
    expect(layers.length).toBeGreaterThan(4);
    const at = layout(layers);
    // One column, outlets in line with warp's: nothing stands between a layer and the gap.
    for (const s of layers) {
      expect(at[s.id].x).toBe(at.warp.x);
      expect(at[s.id].y).toBeGreaterThan(at.warp.y + 150);
    }
    expect(new Set(layers.map((s) => at[s.id].y)).size).toBe(layers.length);
    // The gap the cords rise through is wider than a cord's 30 px reach either side.
    expect(at.feedback.x - (at.warp.x + WIDE)).toBe(FEED_GAP);
    expect(FEED_GAP).toBeGreaterThanOrEqual(60);
    expect(at.add.x).toBe(at.feedback.x);
  });

  it('falls back to motion when the selection is gone', () => {
    expect(stageFor(blank(), 'wave2').id).toBe('motion');
    expect(stageFor(blank(), null).id).toBe('motion');
    expect(stageFor(blank({ fWaveAlpha: 1 }), 'wave').id).toBe('wave');
  });
});
