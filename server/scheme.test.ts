import { describe, expect, it } from 'vitest';
import { hint } from '../hints.ts';
import { BUILT_IN, merge } from './scheme.ts';

/**
 * The name hints, against the names of a real set.
 *
 * These exist because a mis-routed layer does not look like a bad regular
 * expression — it looks like a rendering bug. A pad drawing as a strobe is one
 * wrong thing among twenty-six right ones, on screen, at a gig, and nothing
 * about it points back at a missing `\b`.
 *
 * The names below are taken from an actual set rather than invented, which is
 * the whole point: the failures were all in names nobody would think to make up.
 *
 * They matter *less* than they used to and are still worth keeping. A hint is
 * now only what an unbound track falls back to — anything you actually care
 * about gets bound by name in the editor — but "unbound" is the state a set
 * spends its first evening in, and a first evening where every layer is roughly
 * right is the difference between configuring this and not bothering.
 */
const sourceFor = (name: string) => hint(name)?.source ?? null;

describe('name hints', () => {
  it('does not match a word inside a longer one', () => {
    // The bug this file was written for. "beat" is inside "Beating", so without
    // a word boundary a pad track drew as a drum — and it was the drum hint
    // that won, because it is first.
    expect(sourceFor('Beating Pad')).toBe('noise');
    expect(sourceFor('Subtle Keys')).toBe('grid');
  });

  it('is strict in both directions, which is the price of the fix', () => {
    // The same boundary that saves "Beating Pad" means "Padded" is not a pad
    // and "Drumming" is not a drum. They fall through to positional instead,
    // which is the safe half of being wrong: an unremarkable layer rather than
    // a confidently misrouted one.
    expect(sourceFor('Padded Cell')).toBeNull();
    expect(sourceFor('Drumming')).toBeNull();
  });

  it('reads an arp as a sequence rather than a chord', () => {
    // Four of these in one set. Scattered across positional fallbacks they read
    // as four unrelated layers when they are one family.
    for (const name of ['Space Arp', 'Retro Arp', 'Pluck Arp', '13-Felixian Pluck Arp']) {
      expect(sourceFor(name), name).toBe('bars');
    }
  });

  it('routes the ordinary instrument names', () => {
    expect(sourceFor('Drums')).toBe('strobe');
    expect(sourceFor('Bass')).toBe('bars');
    expect(sourceFor('Sub Bass')).toBe('bars');
    expect(sourceFor('303 EXT')).toBe('bars');
    expect(sourceFor('Guitar')).toBe('rings');
    expect(sourceFor('Vox')).toBe('rings');
    expect(sourceFor('Sparkle Pad')).toBe('noise');
    expect(sourceFor('Texture')).toBe('noise');
  });

  it('leaves a name that says nothing to fall through', () => {
    // These become positional, which is what makes an unnamed set still work.
    for (const name of [
      'MIDI',
      'Uppers',
      'Downers',
      'Song',
      'Sample',
      'Patterns',
      '29-Kontakt 8',
    ]) {
      expect(hint(name), name).toBeNull();
    }
  });

  it('is case-insensitive, because nobody is consistent', () => {
    expect(sourceFor('DRUMS')).toBe('strobe');
    expect(sourceFor('drum bus')).toBe('strobe');
  });
});

describe('the built-in scheme', () => {
  it('covers the roles a real set uses', () => {
    // A role with no archetype falls back to a flat default, which is safe and
    // dull. These are the ones seen in the wild.
    for (const role of ['INTRO', 'VERSE', 'BUILD', 'CHORUS', 'BRIDGE', 'JAM1', 'JAM2', 'ENDING']) {
      expect(BUILT_IN.archetypes[role], role).toBeDefined();
    }
  });

  it('orders sections by energy the way a song is shaped', () => {
    const { archetypes: a } = BUILT_IN;
    expect(a.INTRO.energy).toBeLessThan(a.VERSE.energy);
    expect(a.VERSE.energy).toBeLessThan(a.BUILD.energy);
    expect(a.BUILD.energy).toBeLessThan(a.CHORUS.energy);
    // A bridge is a contrast rather than a peak.
    expect(a.BRIDGE.energy).toBeLessThan(a.CHORUS.energy);
  });

  it('names only effects it defines', () => {
    // An archetype pointing at an id nothing registers is a section that
    // quietly carries one effect fewer than it says it does.
    for (const [role, archetype] of Object.entries(BUILT_IN.archetypes)) {
      for (const id of archetype.effects ?? []) {
        expect(BUILT_IN.effects[id], `${role} -> ${id}`).toBeDefined();
      }
    }
  });

  it('names only colourways it defines', () => {
    expect(BUILT_IN.colorways[BUILT_IN.defaults.colorway]).toBeDefined();
    for (const [song, spec] of Object.entries(BUILT_IN.songs)) {
      if (spec.colorway) expect(BUILT_IN.colorways[spec.colorway], song).toBeDefined();
    }
  });
});

describe('merging a file over the built-in', () => {
  it('overrides one archetype without deleting the rest', () => {
    const merged = merge({ archetypes: { CHORUS: { energy: 1 } } });
    expect(merged.archetypes.CHORUS.energy).toBe(1);
    expect(merged.archetypes.VERSE).toBeDefined();
  });

  it('keeps the built-in effects alongside a circuit the file adds', () => {
    // A file that registered one effect used to be a file that had six fewer,
    // which would break every archetype at once.
    const merged = merge({
      effects: { fx1: { name: 'Mine', circuit: { nodes: [], cords: [] } } },
    });
    expect(merged.effects.fx1).toBeDefined();
    expect(merged.effects.kaleido).toBeDefined();
  });

  it('reads a song written as a bare colourway name', () => {
    // The shape before a song owned anything but its colours. A file written
    // then should not quietly unstyle every song in it.
    const merged = merge({ songs: { sandstorm: 'ember' } as never });
    expect(merged.songs.sandstorm).toEqual({ colorway: 'ember' });
  });

  it('carries layer bindings through, keyed by the track name', () => {
    const merged = merge({ layers: { Drums: { source: 'rings' } } });
    expect(merged.layers.Drums.source).toBe('rings');
  });

  it('gives a file written before pace existed a pace anyway', () => {
    // `defaults` merges field by field, which is what stops an older file from
    // arriving with a hole in it where a uniform is about to read.
    expect(merge({ defaults: { maxEffects: 3 } as never }).defaults.pace).toBe(0);
    expect(merge({ defaults: { maxEffects: 3 } as never }).defaults.maxEffects).toBe(3);
  });

  it('remembers what a rolled show was rolled from', () => {
    // The seed used to live exactly as long as the tab, because merge rebuilt
    // the scheme field by field and this one was not among them.
    expect(merge({ seed: 'coral-tide-207' }).seed).toBe('coral-tide-207');
    expect(merge({}).seed).toBeUndefined();
  });
});
