import { describe, expect, it } from 'vitest';
import type { Scheme } from '../../protocol.ts';
import { isGenerator } from '../../resolve.ts';
import { place, stackFor, toggleIn } from './stack.ts';

/**
 * The rules a stack obeys, which are the rules a composition obeys.
 *
 * All of this exists because source and effect became one noun. That collapse
 * is only free if something still knows the one thing the two halves genuinely
 * differ about — whether a look reads the frame underneath it — and these are
 * the places that knowledge has to land.
 */

const scheme = (over: Partial<Scheme> = {}): Scheme =>
  ({
    colorways: { default: ['#fff'] },
    songs: {},
    archetypes: {},
    layers: {},
    clips: {},
    looks: {
      bars: { name: 'Bars', builtin: 'bars' },
      rings: { name: 'Rings', builtin: 'rings' },
      kaleido: { name: 'Kaleido', builtin: 'kaleido' },
      ripple: { name: 'Ripple', builtin: 'ripple' },
      painter: { name: 'Painter', circuit: { nodes: [{ id: 'p', kind: 'paint', x: 0, y: 0 }], cords: [] } },
      warper: { name: 'Warper', circuit: { nodes: [{ id: 's', kind: 'sample', x: 0, y: 0 }], cords: [] } },
    },
    defaults: {
      colorway: 'default',
      energy: 0.4,
      blend: ['over'],
      looks: ['bars'],
      maxLooks: 3,
      pace: 0,
    },
    ...over,
  }) as Scheme;

describe('telling a generator from a transformer', () => {
  it('reads a built-in by name', () => {
    expect(isGenerator(scheme(), 'bars')).toBe(true);
    expect(isGenerator(scheme(), 'kaleido')).toBe(false);
  });

  it('reads a circuit by whether it ever samples the frame', () => {
    // Exactly what `circuit.md` always said made a circuit a source. The
    // predicate did not exist then; the claim did.
    expect(isGenerator(scheme(), 'painter')).toBe(true);
    expect(isGenerator(scheme(), 'warper')).toBe(false);
  });

  it('does not call a look it has never heard of a generator', () => {
    // A stale id must not silently become the base of every stack.
    expect(isGenerator(scheme(), 'ghost')).toBe(false);
  });
});

describe('placing a look in a stack', () => {
  const s = scheme();

  it('appends a transformer, because that is what a stack is for', () => {
    expect(place(s, ['bars'], 'kaleido')).toEqual(['bars', 'kaleido']);
    expect(place(s, ['bars', 'kaleido'], 'ripple')).toEqual(['bars', 'kaleido', 'ripple']);
  });

  it('replaces the base rather than stacking two of them', () => {
    // Two generators means drawing one and then painting entirely over it — a
    // full-screen pass that produces nothing.
    expect(place(s, ['bars', 'kaleido'], 'rings')).toEqual(['rings', 'kaleido']);
  });

  it('keeps what was on top when the base changes', () => {
    expect(place(s, ['bars', 'kaleido', 'ripple'], 'rings')).toEqual(['rings', 'kaleido', 'ripple']);
  });

  it('takes one out and puts it back', () => {
    expect(toggleIn(s, ['bars', 'kaleido'], 'kaleido')).toEqual(['bars']);
    expect(toggleIn(s, ['bars'], 'kaleido')).toEqual(['bars', 'kaleido']);
  });
});

describe('the stack a look gets previewed in', () => {
  const s = scheme();

  it('gives a transformer something to work on', () => {
    // Alone it would mix against black and come back black, which reads as a
    // broken look rather than as a look with nothing under it.
    expect(stackFor(s, [], 'kaleido', 'bars')).toEqual(['bars', 'kaleido']);
  });

  it('leaves a generator on its own', () => {
    expect(stackFor(s, [], 'rings', 'bars')).toEqual(['rings']);
  });

  it('uses the base already there rather than reaching for the fallback', () => {
    expect(stackFor(s, ['rings'], 'kaleido', 'bars')).toEqual(['rings', 'kaleido']);
  });

  it('leaves a stack that already holds it alone', () => {
    expect(stackFor(s, ['bars', 'kaleido'], 'kaleido', 'bars')).toEqual(['bars', 'kaleido']);
  });
});
