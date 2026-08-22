import { describe, expect, it } from 'vitest';
import { compileCircuit, valuesOf, MAX_VALUES } from './src/render/circuit.ts';
import type { Scheme, Show, Track } from './protocol.ts';
import { BUILT_IN } from './server/scheme.ts';
import { newSeed, rollCircuit, rollScheme } from './roll.ts';

/**
 * The randomiser.
 *
 * What is worth asserting is not that it produces random output — it will — but
 * that everything it produces is **still a library**. A roll that wired a graph
 * naming a port that does not exist, or that pointed the fallback at a look it
 * had just deleted, is not a different show; it is a broken one, and it breaks
 * on stage rather than here.
 *
 * The half of this file that used to check a *show* — an intro quieter than its
 * chorus, one source per family, a wash kept off `over` — went with the cascade.
 * All three were rules about a table of bindings, and there is no table.
 */

const layer = (t: number, name: string): Track => ({
  t,
  name,
  color: 0xffffff,
  opacity: 1,
  level: 0,
  playing: -1,
  clipName: '',
});

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
  tracks: [
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
  look: null,
  pinned: false,
  colorway: null,
  colors: [0xffffff],
  song: null,
  role: null,
  schemeError: null,
  roles: ['INTRO', 'VERSE', 'CHORUS', 'JAM1', 'OUTRO'],
  songs: ['NIGHTFALL', 'SANDSTORM', 'BABY AGAIN'],
};

const seeds = Array.from({ length: 40 }, (_, i) => `seed-${i}`);
const rolled = (seed: string): Scheme => rollScheme(seed, SHOW, BUILT_IN);

describe('a roll is a library', () => {
  it('names only colourways it defined', () => {
    for (const seed of seeds) {
      const s = rolled(seed);
      for (const [song, spec] of Object.entries(s.songs)) {
        if (spec.colorway) expect(s.colorways[spec.colorway], `${seed} ${song}`).toBeDefined();
      }
      expect(s.colorways[s.defaults.colorway], seed).toBeDefined();
    }
  });

  it('names only looks it made', () => {
    // An id pointing at nothing is a black screen for as long as the wheel sits
    // on it, and it is invisible until it comes round.
    for (const seed of seeds) {
      const s = rolled(seed);
      expect(s.looks[s.defaults.look], seed).toBeDefined();
      for (const id of s.rotation.looks) expect(s.looks[id], `${seed} ${id}`).toBeDefined();
      for (const [song, spec] of Object.entries(s.songs)) {
        for (const id of spec.looks ?? []) expect(s.looks[id], `${seed} ${song}`).toBeDefined();
      }
    }
  });

  it('turns through everything it just made', () => {
    // An empty pool means "everything there is", which is what you want the
    // moment after a roll has finished making four things.
    for (const seed of seeds) {
      const s = rolled(seed);
      expect(s.rotation.looks, seed).toEqual([]);
      expect(s.rotation.bars, seed).toBeGreaterThan(0);
    }
  });

  it('leaves the songs alone', () => {
    // A song entry is an override now. Rolling one would be the machine writing
    // down an exception nobody asked for, which is exactly the noise the
    // cascade used to generate.
    for (const seed of seeds) {
      expect(Object.keys(rolled(seed).songs), seed).toEqual(Object.keys(BUILT_IN.songs));
    }
  });

  it('keeps the pace on the ladder rather than between its rungs', () => {
    for (const seed of seeds) {
      const { pace } = rolled(seed).defaults;
      expect(Number.isInteger(pace), seed).toBe(true);
      expect(Math.abs(pace), seed).toBeLessThanOrEqual(2);
    }
  });
});

describe('rolled looks', () => {
  it('compiles, from every seed', () => {
    // Really an assertion that the generator never names a port that does not
    // exist, which is the way a hand-written node table drifts.
    for (const seed of seeds) {
      for (const [id, def] of Object.entries(rolled(seed).looks)) {
        if (!def.rolled) continue;
        const built = compileCircuit(def.circuit);
        expect(built.error, `${seed} ${id}: ${built.error}`).toBeNull();
      }
    }
  });

  it('stays inside the number bank', () => {
    for (const seed of seeds) {
      const rng = seedOf(seed);
      for (let i = 0; i < 12; i++) {
        expect(valuesOf(rollCircuit(rng)).length, seed).toBeLessThanOrEqual(MAX_VALUES);
      }
    }
  });

  it('never starts a graph from a place, because a place is one colour', () => {
    // A `place` is the same point for every fragment, so a picture read at one
    // is the whole frame in a single colour — moving, but flat. That is a real
    // thing to reach for deliberately and a terrible thing to be dealt: the
    // roll always begins at `point`, so what it makes has structure in it.
    for (const seed of seeds) {
      const rng = seedOf(seed);
      for (let i = 0; i < 12; i++) {
        expect(rollCircuit(rng).nodes.some((n) => n.kind === 'place'), seed).toBe(false);
      }
    }
  });

  it('mostly reaches for the set rather than ignoring it', () => {
    // A rolled look that ignored whoever is playing is a screensaver, and this
    // rig is not one. Not every one of them — a wash that runs on its own is a
    // real thing to want — but most.
    let usesSet = 0;
    let total = 0;
    for (const seed of seeds) {
      for (const def of Object.values(rolled(seed).looks)) {
        if (!def.rolled) continue;
        total += 1;
        if (def.circuit.nodes.some((n) => n.kind === 'tracks')) usesSet += 1;
      }
    }
    expect(usesSet / total).toBeGreaterThan(0.4);
  });

  it('does not pile up across rolls', () => {
    // A week of rolling would otherwise leave forty of them, and the wheel would
    // spend most of its time on looks nobody chose.
    let scheme = BUILT_IN;
    for (const seed of seeds.slice(0, 10)) scheme = rollScheme(seed, SHOW, scheme);
    expect(Object.values(scheme.looks).filter((d) => d.rolled)).toHaveLength(4);
    // And the ones that ship are still there to take apart.
    for (const id of Object.keys(BUILT_IN.looks)) expect(scheme.looks[id], id).toBeDefined();
  });
});

describe('rolling part of a library', () => {
  it('leaves a part it was not asked for exactly as it was', () => {
    const settled = rollScheme('oak-ember-12', SHOW, BUILT_IN);
    const again = rollScheme('rust-cobalt-99', SHOW, settled, ['looks']);
    expect(again.colorways).toEqual(settled.colorways);
    expect(again.rotation).toEqual(settled.rotation);
    // And the part it *was* asked for actually moved.
    expect(again.looks).not.toEqual(settled.looks);
  });

  it('gives the same answer for a part however much else was rolled with it', () => {
    // The whole worth of a seed. If keeping the colours gave different colours
    // from rolling everything, a seed written on a hand would be worth nothing.
    const whole = rollScheme('glass-drift-576', SHOW, BUILT_IN);
    const part = rollScheme('glass-drift-576', SHOW, BUILT_IN, ['colours']);
    expect(part.colorways).toEqual(whole.colorways);
  });

  it('never points the fallback at a colourway that is not there', () => {
    const settled = rollScheme('oak-ember-12', SHOW, BUILT_IN);
    const again = rollScheme('rust-cobalt-99', SHOW, settled, ['looks']);
    expect(again.colorways).toHaveProperty(again.defaults.colorway);
    expect(again.looks).toHaveProperty(again.defaults.look);
  });

  it('clears what the last roll wired and keeps what someone built', () => {
    // Deleting every graph was a side effect of a button whose whole promise is
    // that one level of undo covers it, and one level of undo does not make
    // losing an evening's work acceptable.
    const mine = {
      ...BUILT_IN,
      looks: {
        ...BUILT_IN.looks,
        mine: { name: 'Mine', circuit: { nodes: [], cords: [] } },
        old: { name: 'Old', circuit: { nodes: [], cords: [] }, rolled: true },
      },
    };
    const out = rollScheme('oak-ember-12', SHOW, mine);
    expect(out.looks.mine).toBeDefined();
    expect(out.looks.old).toBeUndefined();
  });
});

describe('a seed', () => {
  it('is two words and a number, which fits on a hand', () => {
    for (let i = 0; i < 40; i++) expect(newSeed()).toMatch(/^[a-z]+-[a-z]+-\d+$/);
  });

  it('reproduces a show exactly', () => {
    expect(rolled('glass-drift-576')).toEqual(rolled('glass-drift-576'));
  });

  it('gives two seeds two different libraries', () => {
    expect(rolled('a-b-1')).not.toEqual(rolled('c-d-2'));
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
