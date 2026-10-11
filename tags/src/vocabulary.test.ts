import { describe, expect, it } from 'vitest';
import { loadVocabulary, vocabularyProblems, type Vocabulary } from './vocabulary.ts';

const ALL =
  'Red Orange Yellow Green Cyan Blue Purple Pink Mono Warm Cold Busy Still Quiet Contrast Metallic Liquid Waveform Chaotic Unique WTF Reactive Ambient Pulsing Flashy Symmetric Kaleidoscope Tunnel Spiral Glow Grainy Geometric Organic Fractal'.split(
    ' ',
  );

describe('vocabulary.json', () => {
  const v = loadVocabulary();

  it('is valid', () => {
    expect(vocabularyProblems(v)).toEqual([]);
  });

  it('has every tag of the experiment, once', () => {
    expect(v.tags.map((t) => t.name).sort()).toEqual([...ALL].sort());
  });

  it('gives the picture-judgement tags a rubric', () => {
    for (const name of ['Metallic', 'Liquid', 'Organic', 'Geometric', 'Fractal', 'WTF', 'Glow']) {
      expect(v.tags.find((t) => t.name === name)?.rubric, name).toBeTruthy();
    }
  });

  it('scores Unique by nearest-neighbour distance', () => {
    expect(v.tags.find((t) => t.id === 'unique')?.scorer).toBe('nearest-neighbour');
  });

  it('uses every group', () => {
    expect(new Set(v.tags.map((t) => t.group))).toEqual(new Set(v.groups));
  });
});

describe('vocabularyProblems', () => {
  const ok: Vocabulary = { version: 1, groups: ['colour'], tags: [{ id: 'red', name: 'Red', group: 'colour', question: 'Which of these are Red?' }] };

  it('accepts a minimal vocabulary', () => {
    expect(vocabularyProblems(ok)).toEqual([]);
  });

  it('names what is wrong', () => {
    const bad = {
      version: 1,
      groups: ['colour'],
      tags: [
        { id: 'Red', name: 'Red', group: 'colour', question: 'Which of these are Red?' },
        { id: 'blue', name: 'Blue', group: 'shape', question: 'Is it blue', proxy: { feature: '', direction: 'up' }, rubric: 'blue' },
        { id: 'blue', name: 'Blue', group: 'colour', question: 'Which of these are Blue?', scorer: 'magic' },
      ],
    } as unknown as Vocabulary;
    const p = vocabularyProblems(bad).join('\n');
    expect(p).toMatch(/tag 0 .*id must be lower-case/);
    expect(p).toMatch(/tag 1 .*group shape/);
    expect(p).toMatch(/tag 1 .*question/);
    expect(p).toMatch(/tag 1 .*proxy/);
    expect(p).toMatch(/tag 1 .*rubric/);
    expect(p).toMatch(/tag 2 .*duplicate id/);
    expect(p).toMatch(/tag 2 .*duplicate name/);
    expect(p).toMatch(/tag 2 .*unknown scorer/);
  });
});
