import { describe, expect, it } from 'vitest';
import type { Preset, Problem } from './api.ts';
import { CHAIN, STAGES, addLayer, bakedIn, codeSets, layersOf, offers, problemsOf, removeLayer, shaderCode, stageFor, stageOfProblem } from './stages.ts';

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

describe('shader code', () => {
  it("reads a shader stage's code from the preset, and nothing for any other stage", () => {
    const p = { ...blank(), warp: 'ret = 1;', comp: '' };
    const stage = (id: string) => CHAIN.find((s) => s.id === id)!;
    expect(shaderCode(p, stage('warp'))).toBe('ret = 1;');
    expect(shaderCode(p, stage('comp'))).toBe('');
    expect(shaderCode(p, stage('motion'))).toBe('');
  });
});

describe('the selection', () => {
  it('falls back to motion when the selection is gone', () => {
    expect(stageFor(blank(), 'wave2').id).toBe('motion');
    expect(stageFor(blank(), null).id).toBe('motion');
    expect(stageFor(blank({ fWaveAlpha: 1 }), 'wave').id).toBe('wave');
  });
});

describe('what per-frame code sets', () => {
  it('ignores assignments inside block comments, closed or not', () => {
    expect(codeSets('/* wave_a = bass; */ zoom = 1;', 'wave_a')).toBeUndefined();
    expect(codeSets('zoom = 1;\n/*\nwave_a = 1;\n*/\nwave_a = 0;', 'wave_a')).toBe('off');
    expect(codeSets('zoom = 1; /* wave_a = 1;', 'wave_a')).toBeUndefined();
    expect(codeSets('// a /* b\nwave_a = 1;', 'wave_a')).toBe('on');
  });

  it('reads compound assignments', () => {
    expect(codeSets('wave_a += 1;', 'wave_a')).toBe('on');
    expect(codeSets('wave_a -= bass;', 'wave_a')).toBe('on');
    expect(codeSets('wave_a *= 0;', 'wave_a')).toBe('off');
    expect(codeSets('wave_a /= 0;', 'wave_a')).toBe('off');
    expect(codeSets('wave_a *= 0.5;', 'wave_a')).toBeUndefined();
    expect(codeSets('wave_a = 0;\nwave_a += bass;', 'wave_a')).toBe('on');
    expect(codeSets('wave_a == 1; wave_a <= 1; wave_a != 1;', 'wave_a')).toBeUndefined();
  });

  it('shows a layer only a block comment turns on, and lets it be removed', () => {
    const p = blank({ fWaveAlpha: 0 });
    p.frame = '/* wave_a = 1; */';
    expect(ids(p)).toEqual([]);
    const q = blank({ fWaveAlpha: 0.8 });
    q.frame = '/* wave_a = 1; */';
    expect(ids(removeLayer(q, 'wave')!)).toEqual([]);
  });

  it('shows a layer compound assignment turns on, and will not remove it', () => {
    const p = blank();
    p.frame = 'wave_a += 0.5;';
    expect(ids(p)).toEqual(['wave']);
    expect(removeLayer(p, 'wave')).toBeNull();
  });
});

describe('adding borders per-frame code half holds off', () => {
  it('adds the inner border when the code zeroes ob_a', () => {
    const p = blank();
    p.frame = 'ob_a = 0;';
    expect(offers(p).find((o) => o.kind === 'border')!.full).toBeUndefined();
    const added = addLayer(p, 'border')!;
    expect(added.preset.values.ib_a).toBeGreaterThan(0);
    expect(added.preset.values.ib_size).toBeGreaterThan(0);
    expect(ids(added.preset)).toEqual(['border']);
  });

  it('adds the outer border when the code zeroes ib_a', () => {
    const p = blank();
    p.frame = 'ib_a = 0;';
    const added = addLayer(p, 'border')!;
    expect(added.preset.values.ob_a).toBeGreaterThan(0);
    expect(ids(added.preset)).toEqual(['border']);
  });

  it('says which variables to change when the code zeroes both', () => {
    const p = blank();
    p.frame = 'ob_a = 0; ib_a = 0;';
    expect(offers(p).find((o) => o.kind === 'border')!.full).toBe("motion's code sets ob_a = 0");
    expect(addLayer(p, 'border')).toBeNull();
  });
});

describe('settings a written shader bakes in', () => {
  const feedback = STAGES.find((s) => s.id === 'feedback')!;
  const comp = STAGES.find((s) => s.id === 'comp')!;

  it('marks decay once the warp shader is written, and only then', () => {
    expect(bakedIn(blank(), feedback)).toBeUndefined();
    const p = { ...blank(), warp: 'shader_body\n{\n  ret = tex2D(sampler_main, uv).xyz * 0.98;\n}' };
    const baked = bakedIn(p, feedback)!;
    expect([...baked.keys]).toEqual(['fDecay']);
    expect(baked.why).toMatch(/decay/);
    // Wrap and darken centre still apply.
    expect(baked.keys.has('bTexWrap')).toBe(false);
  });

  it("marks the composite's settings once its shader is written", () => {
    expect(bakedIn(blank(), comp)).toBeUndefined();
    const baked = bakedIn({ ...blank(), comp: 'shader_body { ret = 1; }' }, comp)!;
    expect(baked.keys.has('fGammaAdj')).toBe(true);
    expect(baked.keys.has('fVideoEchoAlpha')).toBe(true);
  });
});
