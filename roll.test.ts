import { describe, expect, it } from 'vitest';
import { compileCircuit, knobsOf, MAX_KNOBS } from './src/render/circuit.ts';
import { familyOf } from './hints.ts';
import type { Layer, Scheme, Show } from './protocol.ts';
import { BUILT_IN } from './server/scheme.ts';
import { newSeed, rollCircuit, rollScheme } from './roll.ts';

/**
 * The randomiser.
 *
 * What is worth asserting is not that it produces random output — it will — but
 * that everything it produces is **still a show**. A roll that named a colourway
 * nothing defines, or an effect nothing registers, or that put an intro above
 * its chorus, is not a different show; it is a broken one, and it breaks on
 * stage rather than here.
 */

const layer = (t: number, name: string): Layer =>
  ({
    t,
    name,
    color: 0xffffff,
    source: 'solid',
    effects: [],
    offers: [],
    blend: 'over',
    floor: 0,
    opacity: 1,
    level: 0,
    energy: 0.4,
    hidden: false,
    playing: -1,
    clipName: '',
  }) as Layer;

const SHOW: Show = {
  connected: true,
  lomReady: true,
  playing: false,
  peers: 0,
  clock: true,
  tempo: 120,
  quantum: 4,
  beat: 0,
  at: 0,
  master: 0,
  layers: [
    layer(0, 'Drums'),
    layer(1, '24-Drum Rack'),
    layer(2, 'Bass'),
    layer(3, 'Sub Bass'),
    layer(4, 'Space Arp'),
    layer(5, 'Pluck Arp'),
    layer(6, 'Sparkle Pad'),
    layer(7, 'Vox'),
    layer(8, 'Patterns'),
  ],
  song: null,
  role: null,
  archetype: null,
  colorway: null,
  energy: 0.4,
  schemeError: null,
  roles: ['INTRO', 'VERSE', 'CHORUS', 'JAM1', 'OUTRO'],
  songs: ['NIGHTFALL', 'SANDSTORM', 'BABY AGAIN'],
};

const seeds = Array.from({ length: 40 }, (_, i) => `seed-${i}`);
const rolled = (seed: string): Scheme => rollScheme(seed, SHOW, BUILT_IN);

describe('a roll is a show', () => {
  it('names only colourways it defined', () => {
    for (const seed of seeds) {
      const s = rolled(seed);
      for (const [song, spec] of Object.entries(s.songs)) {
        expect(s.colorways[spec.colorway!], `${seed} ${song}`).toBeDefined();
      }
      expect(s.colorways[s.defaults.colorway], seed).toBeDefined();
    }
  });

  it('names only effects it registered', () => {
    // An id pointing at nothing costs a section one effect and is invisible
    // until you count them, which nobody does during a set.
    for (const seed of seeds) {
      const s = rolled(seed);
      const named = [
        ...Object.values(s.archetypes).flatMap((a) => a.effects ?? []),
        ...Object.values(s.layers).flatMap((l) => l.effects ?? []),
      ];
      for (const id of named) expect(s.effects[id], `${seed} ${id}`).toBeDefined();
    }
  });

  it('keeps the shape of a song, every time', () => {
    // The one thing a roll must never do. An intro louder than its chorus is not
    // a different show.
    for (const seed of seeds) {
      const { archetypes: a } = rolled(seed);
      expect(a.INTRO.energy, seed).toBeLessThan(a.VERSE.energy);
      expect(a.VERSE.energy, seed).toBeLessThan(a.CHORUS.energy);
      expect(a.JAM1.energy, seed).toBeLessThan(a.CHORUS.energy + 0.2);
    }
  });

  it('gives a role it has never heard of an archetype anyway', () => {
    // OUTRO is in the set's vocabulary and in no table here. A role with no
    // archetype is a section that falls back to a flat default all night.
    for (const seed of seeds.slice(0, 8)) {
      expect(rolled(seed).archetypes.OUTRO, seed).toBeDefined();
    }
  });

  it('binds every track in the set and nothing else', () => {
    for (const seed of seeds.slice(0, 8)) {
      const s = rolled(seed);
      expect(Object.keys(s.layers).sort()).toEqual(SHOW.layers.map((l) => l.name).sort());
    }
  });

  it('deals one source per family, not per track', () => {
    // Four arps across four unrelated sources read as four unrelated things when
    // they are one family. This is the assertion that makes a roll a show rather
    // than a scatter.
    for (const seed of seeds) {
      const s = rolled(seed);
      const byFamily = new Map<string, string>();
      for (const [name, spec] of Object.entries(s.layers)) {
        const family = familyOf(name);
        const held = byFamily.get(family);
        if (held) expect(spec.source, `${seed} ${family}`).toBe(held);
        else byFamily.set(family, spec.source!);
      }
      // And the families differ from each other, or the whole set is one picture.
      expect(new Set(byFamily.values()).size, seed).toBeGreaterThan(1);
    }
  });

  it('keeps a wash off the drums and a strobe off the pads', () => {
    for (const seed of seeds) {
      const s = rolled(seed);
      expect(['strobe', 'sparks', 'scan', 'bars', 'grid'], seed).toContain(s.layers.Drums.source);
      expect(['plasma', 'noise', 'solid', 'tunnel'], seed).toContain(
        s.layers['Sparkle Pad'].source,
      );
    }
  });

  it('leaves something opaque at the bottom of the stack', () => {
    for (const seed of seeds.slice(0, 8)) expect(rolled(seed).defaults.blend[0]).toBe('over');
  });

  it('never draws a wash over the top of the stack', () => {
    // Layer order is Live's track order, which a roll cannot change, so a
    // full-frame source on `over` near the top is a curtain across the show.
    const wash = ['solid', 'plasma', 'noise'];
    for (const seed of seeds) {
      for (const [name, spec] of Object.entries(rolled(seed).layers)) {
        if (wash.includes(spec.source!)) expect(spec.blend, `${seed} ${name}`).not.toBe('over');
      }
    }
  });

  it('moves the pace by whole rungs and no further than one', () => {
    // Whole, because every rung is a musical division and a rate between two of
    // them is in time with nothing. One, because a roll should vary how a show
    // moves without ever landing it somewhere unusable.
    const seen = new Set<number>();
    for (const seed of seeds) {
      const { pace } = rolled(seed).defaults;
      expect(Number.isInteger(pace), seed).toBe(true);
      expect(Math.abs(pace), seed).toBeLessThanOrEqual(1);
      seen.add(pace);
    }
    expect(seen.size, 'forty seeds should not all pick the same pace').toBeGreaterThan(1);
  });

  it('writes colours a projector can actually show', () => {
    // A cheap lamp has no black to work against, so a dark colourway is a dark
    // screen. Every colour is a valid hex and none of them is close to one.
    for (const seed of seeds) {
      for (const colors of Object.values(rolled(seed).colorways)) {
        for (const c of colors) {
          expect(c, seed).toMatch(/^#[0-9a-f]{6}$/);
          const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16));
          expect(Math.max(r, g, b), `${seed} ${c}`).toBeGreaterThan(90);
        }
      }
      // One member light enough to read edges against.
      for (const colors of Object.values(rolled(seed).colorways)) {
        const lightest = Math.max(
          ...colors.map((c) =>
            Math.min(...[1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16))),
          ),
        );
        expect(lightest, seed).toBeGreaterThan(170);
      }
    }
  });
});

describe('the seed', () => {
  it('is the whole of what a roll depends on', () => {
    expect(rolled('coral-tide-207')).toEqual(rolled('coral-tide-207'));
    expect(rolled('coral-tide-207')).not.toEqual(rolled('coral-tide-208'));
  });

  it('is carried on the scheme, so a show can be got back', () => {
    expect(rolled('ash-halo-100').seed).toBe('ash-halo-100');
  });

  it('is something a person could read out', () => {
    expect(newSeed()).toMatch(/^[a-z]+-[a-z]+-\d{3}$/);
  });
});

describe('rolled circuits', () => {
  it('compiles every one of them', () => {
    // The compiler has a fallback for every unwired inlet, so this is really
    // asserting that the generator never emits a port that does not exist —
    // which is the way a hand-written node table drifts.
    for (const seed of seeds) {
      const s = rollScheme(seed, SHOW, BUILT_IN);
      for (const [id, def] of Object.entries(s.effects)) {
        if (!def.circuit) continue;
        expect(compileCircuit(def.circuit).error, `${seed} ${id}`).toBeNull();
      }
    }
  });

  it('always reaches the frame it was given', () => {
    // A circuit whose out is fed by nothing is a legal circuit and a useless
    // effect: it draws the untouched input.
    for (const seed of seeds) {
      const circuit = rollCircuit(seedOf(seed));
      expect(circuit.nodes.some((n) => n.kind === 'sample'), seed).toBe(true);
      expect(circuit.cords.some((c) => c.to.endsWith('/c')), seed).toBe(true);
    }
  });

  it('never asks for more knobs than the uniform bank holds', () => {
    for (const seed of seeds) {
      const circuit = rollCircuit(seedOf(seed));
      expect(knobsOf(circuit).length, seed).toBeLessThanOrEqual(MAX_KNOBS);
    }
  });

  it('does not pile up across rolls', () => {
    // Rolling on top of a rolled scheme has to replace its circuits, or a week
    // of rolling leaves forty of them and every archetype pointing at a ghost.
    let scheme = BUILT_IN;
    for (const seed of seeds.slice(0, 10)) scheme = rollScheme(seed, SHOW, scheme);
    expect(Object.values(scheme.effects).filter((d) => d.circuit)).toHaveLength(2);
    expect(Object.keys(scheme.effects).filter((id) => BUILT_IN.effects[id])).toHaveLength(
      Object.keys(BUILT_IN.effects).length,
    );
  });
});

/** A deterministic generator for a seed, for the circuit-only cases above. */
function seedOf(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
