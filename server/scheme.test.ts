import { describe, expect, it } from 'vitest';
import { BUILT_IN, compile, firstMatch } from './scheme.ts';

/**
 * The track rules, against the names of a real set.
 *
 * These exist because a mis-routed layer does not look like a bad regular
 * expression — it looks like a rendering bug. A pad drawing as a strobe is one
 * wrong thing among twenty-six right ones, on screen, at a gig, and nothing
 * about it points back at a missing `\b`.
 *
 * The names below are taken from an actual set rather than invented, which is
 * the whole point: the failures were all in names nobody would think to make up.
 */
const rules = compile(BUILT_IN.tracks);
const sourceFor = (name: string) => firstMatch(rules, name)?.source ?? null;

describe('track rules', () => {
  it('does not match a word inside a longer one', () => {
    // The bug this file was written for. "beat" is inside "Beating", so without
    // a word boundary a pad track drew as a drum — and it was the drum rule
    // that won, because it is first.
    expect(sourceFor('Beating Pad')).toBe('noise');
    expect(sourceFor('Subtle Keys')).toBe('grid');
  });

  it('is strict in both directions, which is the price of the fix', () => {
    // The same boundary that saves "Beating Pad" means "Padded" is not a pad
    // and "Bassline" is not a bass. They fall through to positional instead,
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
    for (const name of ['MIDI', 'Uppers', 'Downers', 'Song', 'Sample', 'Patterns', '29-Kontakt 8']) {
      expect(sourceFor(name), name).toBeNull();
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

  it('names only colourways it defines', () => {
    expect(BUILT_IN.colorways[BUILT_IN.defaults.colorway]).toBeDefined();
    for (const [song, way] of Object.entries(BUILT_IN.songs)) {
      expect(BUILT_IN.colorways[way], `${song} -> ${way}`).toBeDefined();
    }
  });

  it('has every rule compile', () => {
    // A bad pattern is skipped silently at runtime so one typo cannot take the
    // show down, which is right — and exactly why it needs catching here.
    expect(compile(BUILT_IN.tracks)).toHaveLength(BUILT_IN.tracks.length);
    expect(compile(BUILT_IN.clips)).toHaveLength(BUILT_IN.clips.length);
  });
});
