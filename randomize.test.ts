import { describe, expect, it } from 'vitest';
import { compileCircuit, valuesOf, MAX_VALUES } from './client/render/circuit.ts';
import type { Scheme, Show, Track } from './protocol.ts';
import { EXAMPLES } from './server/scheme.ts';
import { newSeed, randomizeCircuit, randomizeScheme } from './randomize.ts';

/**
 * The randomiser.
 *
 * What is worth asserting is not that it produces random output — it will — but
 * that everything it produces is **still a library**. A randomise that wired a graph
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
const randomised = (seed: string): Scheme => randomizeScheme(seed, SHOW, EXAMPLES);

describe('a randomise is a library', () => {
  it('names only colourways it defined', () => {
    for (const seed of seeds) {
      const s = randomised(seed);
      for (const [song, spec] of Object.entries(s.songs)) {
        if (spec.colorway) expect(s.colorways[spec.colorway], `${seed} ${song}`).toBeDefined();
      }
      expect(s.colorways[s.defaults.colorway], seed).toBeDefined();
    }
  });

  it('re-deals the colourways that are there rather than inventing new ones', () => {
    // It used to take four fresh names out of WORDS and drop whatever the
    // library held. That was wrong twice: a scheme grown to eight came back as
    // four, and — the part that actually broke — **a song pins a colourway by
    // name**, so every pin was orphaned by every press of the button, silently.
    const eight: Scheme = {
      ...EXAMPLES,
      colorways: {
        ...EXAMPLES.colorways,
        mine: ['#111111', '#222222', '#333333', '#444444', '#555555'],
        yours: ['#666666', '#777777', '#888888', '#999999', '#aaaaaa'],
        theirs: ['#bbbbbb', '#cccccc', '#dddddd', '#eeeeee', '#ffffff'],
        ours: ['#010101', '#020202', '#030303', '#040404', '#050505'],
      },
      songs: { Sandstorm: { colorway: 'mine' } },
    };
    for (const seed of seeds.slice(0, 8)) {
      const dealt = randomizeScheme(seed, SHOW, eight, ['colours']);
      expect(Object.keys(dealt.colorways), seed).toEqual(Object.keys(eight.colorways));
      // The pin still points at something, which is the whole of why.
      expect(dealt.colorways.mine, seed).toBeDefined();
      // And the colours inside really did change.
      expect(dealt.colorways.mine, seed).not.toEqual(eight.colorways.mine);
    }
  });

  it('names only flows it made', () => {
    // An id pointing at nothing is a black screen for as long as the wheel sits
    // on it, and it is invisible until it comes round.
    for (const seed of seeds) {
      const s = randomised(seed);
      expect(s.flows[s.defaults.flow], seed).toBeDefined();
      for (const id of s.rotation.flows) expect(s.flows[id], `${seed} ${id}`).toBeDefined();
      for (const [song, spec] of Object.entries(s.songs)) {
        for (const id of spec.flows ?? []) expect(s.flows[id], `${seed} ${song}`).toBeDefined();
      }
    }
  });

  it('turns through everything it just made', () => {
    // An empty pool means "everything there is", which is what you want the
    // moment after a randomise has finished making four things.
    for (const seed of seeds) {
      const s = randomised(seed);
      expect(s.rotation.flows, seed).toEqual([]);
      expect(s.rotation.bars, seed).toBeGreaterThan(0);
    }
  });

  it('leaves the songs alone', () => {
    // A song entry is an override now. Randomising one would be the machine writing
    // down an exception nobody asked for, which is exactly the noise the
    // cascade used to generate.
    for (const seed of seeds) {
      expect(Object.keys(randomised(seed).songs), seed).toEqual(Object.keys(EXAMPLES.songs));
    }
  });

  it('keeps the pace on the ladder rather than between its rungs', () => {
    for (const seed of seeds) {
      const { pace } = randomised(seed).defaults;
      expect(Number.isInteger(pace), seed).toBe(true);
      expect(Math.abs(pace), seed).toBeLessThanOrEqual(2);
    }
  });
});

/**
 * A colour, taken apart in OKLCH, so a palette can be asserted about rather than
 * looked at.
 *
 * Derived here rather than imported, deliberately: a test that measured a
 * generator with the generator's own arithmetic would agree with it about a
 * mistake. HSL was the wrong ruler for this — its `l` is not lightness and its
 * `s` says the same thing about a pale tint and a fire engine — so the numbers
 * asserted below are `L`, real perceptual lightness, and `C`, how much colour is
 * actually there.
 */
function taken(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => v / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    C: Math.hypot(A, B),
    hue: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360,
  };
}

const apart = (a: number, b: number) => {
  const gap = Math.abs(a - b) % 360;
  return gap > 180 ? 360 - gap : gap;
};

describe('a randomised colourway', () => {
  const randomised = seeds.flatMap((seed) =>
    Object.entries(randomizeScheme(seed, SHOW, EXAMPLES, ['colours']).colorways).map(
      ([name, colours]) => [`${seed} ${name}`, colours] as const,
    ),
  );

  it('is always five colours', () => {
    // Tracks take a colour by position and a flow draws from the first, so a
    // palette that was sometimes four and sometimes five is a set that changes
    // which track is which colour when the wheel turns.
    for (const [where, colours] of randomised) expect(colours, where).toHaveLength(5);
  });

  it('puts each colour in the role that names it', () => {
    // The roles used to be emergent: the randomiser found whichever member sat
    // furthest round the wheel and called that the loud answer, then picked one
    // of the leftovers to be the light one — so which position held the
    // opposite moved from deal to deal. A graph wires to a position, so the
    // position has to mean the same thing every time.
    for (const [where, colours] of randomised) {
      const [primary, secondary, complement, accent, chalk] = colours.map(taken);
      // The pair that carries the palette across a room, each at its own hue's
      // peak. 0.09 is a floor rather than a target: what a hue can hold at its
      // peak varies hugely round the wheel — a vivid yellow has far more chroma
      // available than a vivid blue — so the assertion is that both took what
      // was there, not that they landed on one number.
      expect(primary.C, `${where} primary`).toBeGreaterThan(0.09);
      expect(complement.C, `${where} complement`).toBeGreaterThan(0.09);
      // Pulled back, so the palette has somewhere to sit that is not a second
      // shout — but nowhere near quiet. See the shipped four.
      expect(secondary.C, `${where} secondary`).toBeLessThan(primary.C);
      // Loud, and lifted off its own hue's peak. Not asserted against the
      // primary's lightness: they are different hues with peaks in different
      // places, so a yellow primary really is lighter than a pink accent and
      // the comparison says nothing about either.
      expect(accent.C, `${where} accent`).toBeGreaterThan(0.06);
      expect(accent.L, `${where} accent lift`).toBeGreaterThan(0.67);
      // One tint, and it is chalk. Distinguished by having the least colour in
      // it rather than by being the lightest: a yellow primary sits at 0.9 too,
      // and lightness alone would not separate them.
      expect(chalk.L, `${where} chalk`).toBeGreaterThan(0.87);
      for (const [i, other] of [primary, secondary, complement, accent].entries()) {
        expect(chalk.C, `${where} chalk vs ${i}`).toBeLessThan(other.C);
      }
    }
  });

  it('answers the primary from across the wheel, in the complement slot', () => {
    // Every harmony carries its opposite, because a palette of neighbours is a
    // wall in one colour — harmonious, and indistinguishable from a gel. It sits
    // in `complement` rather than wherever it landed, because that outlet is
    // what a source's opposing colour wires to.
    for (const [where, colours] of randomised) {
      const hues = colours.map((each) => taken(each).hue);
      // 118 rather than 122: eight bits per channel, and the gamut walk moves a
      // hue by a fraction of a degree on the way in.
      expect(apart(hues[0], hues[2]), where).toBeGreaterThanOrEqual(118);
    }
  });

  it('keeps chalk a tint of the primary rather than a fifth hue', () => {
    // It is the palette's answer to white and the colour a generator's hot half
    // mixes toward, so it belongs to the light in the room. Drifted a little
    // warm or cool, which is what a colourist does to a highlight, and no more.
    for (const [where, colours] of randomised) {
      const hues = colours.map((each) => taken(each).hue);
      // The drift is 20 degrees; the tolerance is wider because the measurement
      // is. Hue is numerically unstable at a chroma this low — eight bits per
      // channel is a coarse grid to read an angle off when the colour is nearly
      // neutral — and a few degrees there is not something an eye can see.
      expect(apart(hues[0], hues[4]), where).toBeLessThanOrEqual(42);
      // It has colour in it. A tint that measured zero here would be white, and
      // white is what every generator's hot half used to mix toward — the whole
      // reason this role exists is to replace it with something that belongs.
      expect(taken(colours[4]).C, `${where} chalk has colour in it`).toBeGreaterThan(0.02);
    }
  });

  it('never randomises a colour too dark to see on a cheap lamp', () => {
    // A cheap projector has no black to work against, so a hue whose peak is
    // darker than the floor is lifted to it and gives up some colour for the
    // privilege. The blues and violets, every time.
    for (const [where, colours] of randomised) {
      for (const each of colours) expect(taken(each).L, `${where} ${each}`).toBeGreaterThan(0.55);
    }
  });
});

describe('randomised flows', () => {
  it('compiles, from every seed', () => {
    // Really an assertion that the generator never names a port that does not
    // exist, which is the way a hand-written node table drifts.
    for (const seed of seeds) {
      for (const [id, def] of Object.entries(randomised(seed).flows)) {
        if (!def.randomized) continue;
        const built = compileCircuit(def.circuit);
        expect(built.error, `${seed} ${id}: ${built.error}`).toBeNull();
      }
    }
  });

  it('stays inside the number bank', () => {
    for (const seed of seeds) {
      const rng = seedOf(seed);
      for (let i = 0; i < 12; i++) {
        expect(valuesOf(randomizeCircuit(rng)).length, seed).toBeLessThanOrEqual(MAX_VALUES);
      }
    }
  });

  it('never deals a creep, which needs feedback to mean anything', () => {
    // A zoom per second only says something when its result is fed back into
    // the picture it came from. The randomiser never wires a `last`, so a randomised creep
    // would be a lens that moves the point by a fraction of a percent and
    // nothing else — a dead node on the canvas wearing a real name.
    let lenses = 0;
    for (const seed of seeds) {
      const rng = seedOf(seed);
      for (let i = 0; i < 12; i++) {
        for (const node of randomizeCircuit(rng).nodes) {
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
        for (const node of randomizeCircuit(rng).nodes) {
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
        const circuit = randomizeCircuit(rng);
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
        for (const node of randomizeCircuit(rng).nodes) kinds.add(node.kind);
      }
    }
    for (const kind of ['fractal', 'field', 'light', 'spread', 'song', 'math', 'colorway']) {
      expect(kinds.has(kind), kind).toBe(true);
    }
  });

  it('mostly reaches for the set rather than ignoring it', () => {
    // A randomised flow that ignored whoever is playing is a screensaver, and this
    // rig is not one. Not every one of them — a wash that runs on its own is a
    // real thing to want — but most.
    let usesSet = 0;
    let total = 0;
    for (const seed of seeds) {
      for (const def of Object.values(randomised(seed).flows)) {
        if (!def.randomized) continue;
        total += 1;
        if (def.circuit.nodes.some((n) => n.kind === 'tracks')) usesSet += 1;
      }
    }
    expect(usesSet / total).toBeGreaterThan(0.4);
  });

  it('does not pile up across randomises', () => {
    // A week of randomising would otherwise leave forty of them, and the wheel would
    // spend most of its time on flows nobody chose.
    let scheme = EXAMPLES;
    for (const seed of seeds.slice(0, 10)) scheme = randomizeScheme(seed, SHOW, scheme);
    expect(Object.values(scheme.flows).filter((d) => d.randomized)).toHaveLength(4);
    // And the ones that ship are still there to take apart.
    for (const id of Object.keys(EXAMPLES.flows)) expect(scheme.flows[id], id).toBeDefined();
  });
});

describe('randomising part of a library', () => {
  it('leaves a part it was not asked for exactly as it was', () => {
    const settled = randomizeScheme('oak-ember-12', SHOW, EXAMPLES);
    const again = randomizeScheme('rust-cobalt-99', SHOW, settled, ['flows']);
    expect(again.colorways).toEqual(settled.colorways);
    expect(again.rotation).toEqual(settled.rotation);
    // And the part it *was* asked for actually moved.
    expect(again.flows).not.toEqual(settled.flows);
  });

  it('gives the same answer for a part however much else was randomised with it', () => {
    // The whole worth of a seed. If keeping the colours gave different colours
    // from randomising everything, a seed written on a hand would be worth nothing.
    const whole = randomizeScheme('glass-drift-576', SHOW, EXAMPLES);
    const part = randomizeScheme('glass-drift-576', SHOW, EXAMPLES, ['colours']);
    expect(part.colorways).toEqual(whole.colorways);
  });

  it('never points the fallback at a colourway that is not there', () => {
    const settled = randomizeScheme('oak-ember-12', SHOW, EXAMPLES);
    const again = randomizeScheme('rust-cobalt-99', SHOW, settled, ['flows']);
    expect(again.colorways).toHaveProperty(again.defaults.colorway);
    expect(again.flows).toHaveProperty(again.defaults.flow);
  });

  it('clears what the last randomise wired and keeps what someone built', () => {
    // Deleting every graph was a side effect of a button whose whole promise is
    // that one level of undo covers it, and one level of undo does not make
    // losing an evening's work acceptable.
    const mine = {
      ...EXAMPLES,
      flows: {
        ...EXAMPLES.flows,
        mine: { name: 'Mine', circuit: { nodes: [], cords: [] } },
        old: { name: 'Old', circuit: { nodes: [], cords: [] }, randomized: true },
      },
    };
    const out = randomizeScheme('oak-ember-12', SHOW, mine);
    expect(out.flows.mine).toBeDefined();
    expect(out.flows.old).toBeUndefined();
  });
});

describe('a seed', () => {
  it('is two words and a number, which fits on a hand', () => {
    for (let i = 0; i < 40; i++) expect(newSeed()).toMatch(/^[a-z]+-[a-z]+-\d+$/);
  });

  it('reproduces a show exactly', () => {
    expect(randomised('glass-drift-576')).toEqual(randomised('glass-drift-576'));
  });

  it('gives two seeds two different libraries', () => {
    expect(randomised('a-b-1')).not.toEqual(randomised('c-d-2'));
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
