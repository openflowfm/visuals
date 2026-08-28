import { describe, expect, it } from 'vitest';
import { compileCircuit, valuesOf, MAX_VALUES } from './src/render/circuit.ts';
import type { Scheme, Show, Track } from './protocol.ts';
import { EXAMPLES } from './server/scheme.ts';
import { newSeed, rollCircuit, rollScheme } from './roll.ts';

/**
 * The randomiser.
 *
 * What is worth asserting is not that it produces random output — it will — but
 * that everything it produces is **still a library**. A roll that wired a graph
 * naming a port that does not exist, or that pointed the fallback at a flow it
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
  flow: null,
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
const rolled = (seed: string): Scheme => rollScheme(seed, SHOW, EXAMPLES);

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

  it('names only flows it made', () => {
    // An id pointing at nothing is a black screen for as long as the wheel sits
    // on it, and it is invisible until it comes round.
    for (const seed of seeds) {
      const s = rolled(seed);
      expect(s.flows[s.defaults.flow], seed).toBeDefined();
      for (const id of s.rotation.flows) expect(s.flows[id], `${seed} ${id}`).toBeDefined();
      for (const [song, spec] of Object.entries(s.songs)) {
        for (const id of spec.flows ?? []) expect(s.flows[id], `${seed} ${song}`).toBeDefined();
      }
    }
  });

  it('turns through everything it just made', () => {
    // An empty pool means "everything there is", which is what you want the
    // moment after a roll has finished making four things.
    for (const seed of seeds) {
      const s = rolled(seed);
      expect(s.rotation.flows, seed).toEqual([]);
      expect(s.rotation.bars, seed).toBeGreaterThan(0);
    }
  });

  it('leaves the songs alone', () => {
    // A song entry is an override now. Rolling one would be the machine writing
    // down an exception nobody asked for, which is exactly the noise the
    // cascade used to generate.
    for (const seed of seeds) {
      expect(Object.keys(rolled(seed).songs), seed).toEqual(Object.keys(EXAMPLES.songs));
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

/**
 * A colour, taken apart, so a palette can be asserted about rather than looked
 * at. Saturation on its own says nothing — a pale tint and a fire engine can
 * both read 100% — so **chroma** is the one that means loud.
 */
function taken(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const chroma = max - min;
  const s = chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * l - 1));
  const hue =
    chroma === 0
      ? 0
      : max === r
        ? (60 * (((g - b) / chroma) % 6) + 360) % 360
        : max === g
          ? 60 * ((b - r) / chroma + 2)
          : 60 * ((r - g) / chroma + 4);
  return { hue, s, l, chroma, luma: 0.2126 * r + 0.7152 * g + 0.0722 * b };
}

const apart = (a: number, b: number) => {
  const gap = Math.abs(a - b) % 360;
  return gap > 180 ? 360 - gap : gap;
};

describe('a rolled colourway', () => {
  const rolled = seeds.flatMap((seed) =>
    Object.entries(rollScheme(seed, SHOW, EXAMPLES, ['colours']).colorways).map(
      ([name, colours]) => [`${seed} ${name}`, colours] as const,
    ),
  );

  it('is always five colours', () => {
    // Tracks take a colour by position and a flow draws from the first, so a
    // palette that was sometimes four and sometimes five is a set that changes
    // which track is which colour when the wheel turns.
    for (const [where, colours] of rolled) expect(colours, where).toHaveLength(5);
  });

  it('always contains two loud ones and exactly one light one', () => {
    // The two loud ones are what makes it read across a room; the light one is
    // what a busy frame reads its edges against. Neither can be left to a dice
    // roll, so the roll assigns them rather than hoping for them.
    for (const [where, colours] of rolled) {
      const taken_ = colours.map(taken);
      const loud = taken_.filter((c) => c.s >= 0.85 && c.chroma >= 0.5);
      const light = taken_.filter((c) => c.l >= 0.8);
      expect(loud.length, `${where} loud`).toBeGreaterThanOrEqual(2);
      expect(light.length, `${where} light`).toBe(1);
      // And they are never the same colour wearing both hats.
      expect(loud.some((c) => c.l >= 0.8), `${where} overlap`).toBe(false);
    }
  });

  it('always answers its base from across the wheel', () => {
    // Every harmony carries its opposite, because a palette of neighbours is a
    // wall in one colour — harmonious, and indistinguishable from a gel.
    for (const [where, colours] of rolled) {
      const hues = colours.map((each) => taken(each).hue);
      const widest = Math.max(...hues.map((a) => Math.max(...hues.map((b) => apart(a, b)))));
      expect(widest, where).toBeGreaterThanOrEqual(120);
    }
  });

  it('never rolls a colour too dark to see on a cheap lamp', () => {
    // The reason lightness is evened out by hue: a blue at the same number as a
    // yellow is nearly black, and a projector has no black to work against.
    for (const [where, colours] of rolled) {
      for (const each of colours) expect(taken(each).luma, `${where} ${each}`).toBeGreaterThan(0.15);
    }
  });
});

describe('rolled flows', () => {
  it('compiles, from every seed', () => {
    // Really an assertion that the generator never names a port that does not
    // exist, which is the way a hand-written node table drifts.
    for (const seed of seeds) {
      for (const [id, def] of Object.entries(rolled(seed).flows)) {
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

  it('never deals a creep, which needs feedback to mean anything', () => {
    // A zoom per second only says something when its result is fed back into
    // the picture it came from. A roll never wires a `last`, so a rolled creep
    // would be a lens that moves the point by a fraction of a percent and
    // nothing else — a dead node on the canvas wearing a real name.
    let lenses = 0;
    for (const seed of seeds) {
      const rng = seedOf(seed);
      for (let i = 0; i < 12; i++) {
        for (const node of rollCircuit(rng).nodes) {
          if (node.kind !== 'lens') continue;
          lenses += 1;
          expect(node.op).not.toBe('creep');
        }
      }
    }
    expect(lenses).toBeGreaterThan(0);
  });

  it('writes smoothing only on track nodes and values only on value nodes', () => {
    let tracks = 0;
    let values = 0;
    for (const seed of seeds) {
      const rng = seedOf(seed);
      for (let i = 0; i < 12; i++) {
        for (const node of rollCircuit(rng).nodes) {
          if (node.kind === 'track') {
            tracks += 1;
            expect(node.smooth).toBeDefined();
            expect(node.value).toBeUndefined();
          }
          if (node.kind === 'value') {
            values += 1;
            expect(node.value).toBeDefined();
            expect(node.smooth).toBeUndefined();
          }
        }
      }
    }
    expect(tracks).toBeGreaterThan(0);
    expect(values).toBeGreaterThan(0);
  });

  it('hangs lights from a place but never reads a picture at one', () => {
    // A `place` is the same point for every fragment, so a picture read at one
    // is the whole frame in a single colour — moving, but flat. That is a real
    // thing to reach for deliberately and a terrible thing to be dealt. A
    // light's `from` is the opposite case: the place says where the lamp
    // hangs, and driving it is what makes a dealt light wander.
    for (const seed of seeds) {
      const rng = seedOf(seed);
      for (let i = 0; i < 12; i++) {
        const circuit = rollCircuit(rng);
        const places = new Set(
          circuit.nodes.filter((n) => n.kind === 'place').map((n) => n.id),
        );
        for (const cord of circuit.cords) {
          if (!places.has(cord.from.split('/')[0])) continue;
          expect(cord.to.endsWith('/from'), `${seed}: ${cord.to}`).toBe(true);
        }
      }
    }
  });

  it('deals every shape, and every priced picture family, across a deck', () => {
    // The widening was the point: a dealer that can never open with a fractal,
    // a field, a light or a spread caps the taste corpus at one family
    // resemblance. Forty seeds of four deals is plenty for every family to
    // appear at least once — a missing one means a shape was wired wrong.
    const kinds = new Set<string>();
    for (const seed of seeds) {
      const rng = seedOf(seed);
      for (let i = 0; i < 12; i++) {
        for (const node of rollCircuit(rng).nodes) kinds.add(node.kind);
      }
    }
    for (const kind of ['fractal', 'field', 'light', 'spread', 'song', 'math', 'paint']) {
      expect(kinds.has(kind), kind).toBe(true);
    }
  });

  it('mostly reaches for the set rather than ignoring it', () => {
    // A rolled flow that ignored whoever is playing is a screensaver, and this
    // rig is not one. Not every one of them — a wash that runs on its own is a
    // real thing to want — but most.
    let usesSet = 0;
    let total = 0;
    for (const seed of seeds) {
      for (const def of Object.values(rolled(seed).flows)) {
        if (!def.rolled) continue;
        total += 1;
        if (def.circuit.nodes.some((n) => n.kind === 'tracks')) usesSet += 1;
      }
    }
    expect(usesSet / total).toBeGreaterThan(0.4);
  });

  it('does not pile up across rolls', () => {
    // A week of rolling would otherwise leave forty of them, and the wheel would
    // spend most of its time on flows nobody chose.
    let scheme = EXAMPLES;
    for (const seed of seeds.slice(0, 10)) scheme = rollScheme(seed, SHOW, scheme);
    expect(Object.values(scheme.flows).filter((d) => d.rolled)).toHaveLength(4);
    // And the ones that ship are still there to take apart.
    for (const id of Object.keys(EXAMPLES.flows)) expect(scheme.flows[id], id).toBeDefined();
  });
});

describe('rolling part of a library', () => {
  it('leaves a part it was not asked for exactly as it was', () => {
    const settled = rollScheme('oak-ember-12', SHOW, EXAMPLES);
    const again = rollScheme('rust-cobalt-99', SHOW, settled, ['flows']);
    expect(again.colorways).toEqual(settled.colorways);
    expect(again.rotation).toEqual(settled.rotation);
    // And the part it *was* asked for actually moved.
    expect(again.flows).not.toEqual(settled.flows);
  });

  it('gives the same answer for a part however much else was rolled with it', () => {
    // The whole worth of a seed. If keeping the colours gave different colours
    // from rolling everything, a seed written on a hand would be worth nothing.
    const whole = rollScheme('glass-drift-576', SHOW, EXAMPLES);
    const part = rollScheme('glass-drift-576', SHOW, EXAMPLES, ['colours']);
    expect(part.colorways).toEqual(whole.colorways);
  });

  it('never points the fallback at a colourway that is not there', () => {
    const settled = rollScheme('oak-ember-12', SHOW, EXAMPLES);
    const again = rollScheme('rust-cobalt-99', SHOW, settled, ['flows']);
    expect(again.colorways).toHaveProperty(again.defaults.colorway);
    expect(again.flows).toHaveProperty(again.defaults.flow);
  });

  it('clears what the last roll wired and keeps what someone built', () => {
    // Deleting every graph was a side effect of a button whose whole promise is
    // that one level of undo covers it, and one level of undo does not make
    // losing an evening's work acceptable.
    const mine = {
      ...EXAMPLES,
      flows: {
        ...EXAMPLES.flows,
        mine: { name: 'Mine', circuit: { nodes: [], cords: [] } },
        old: { name: 'Old', circuit: { nodes: [], cords: [] }, rolled: true },
      },
    };
    const out = rollScheme('oak-ember-12', SHOW, mine);
    expect(out.flows.mine).toBeDefined();
    expect(out.flows.old).toBeUndefined();
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
