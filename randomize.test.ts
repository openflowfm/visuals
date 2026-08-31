import { describe, expect, it } from 'vitest';
import { compileCircuit, valuesOf, MAX_VALUES } from './client/render/circuit.ts';
import { MOODS, type Mood, type Scheme, type Show, type Track } from './protocol.ts';
import { EXAMPLES } from './server/scheme.ts';
import { newSeed, palette, palettes, randomizeCircuit, randomizeScheme, seeded } from './randomize.ts';
import { lfoRateForBeat } from './client/nodes/lfo/algorithm.ts';
import { LFO_SHAPES } from './protocol.ts';

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
      ([name, colours]) => [`${seed} ${name}`, colours, EXAMPLES.moods[name] ?? 'any'] as const,
    ),
  );

  /**
   * How much colour a loud role is guaranteed, by **the light it was dealt
   * under**.
   *
   * One number was right while every deal was the same deal. It is not now: a
   * mood is allowed to spend chroma on something else, and two of them do. `ice`
   * buys lightness with it — that is the whole of what "light coming through
   * something" means — and `earth` buys the ochre it is named for. Both spend
   * *deliberately*, and asserting one floor across all of them would either fail
   * on the moods that work or be too low to catch the failure it exists for.
   *
   * The floor is still a floor. Neither of them may go quiet: the point of these
   * two roles is that they carry across a room, and a mood is a light in the
   * room rather than permission to turn it off.
   */
  const CARRIES: Partial<Record<Mood, number>> = { ice: 0.07, earth: 0.07 };
  const carries = (mood: Mood) => CARRIES[mood] ?? 0.09;

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
    for (const [where, colours, mood] of randomised) {
      const [primary, secondary, complement, accent, chalk] = colours.map(taken);
      // The pair that carries the palette across a room, each at its own hue's
      // peak. 0.09 is a floor rather than a target: what a hue can hold at its
      // peak varies hugely round the wheel — a vivid yellow has far more chroma
      // available than a vivid blue — so the assertion is that both took what
      // was there, not that they landed on one number.
      expect(primary.C, `${where} primary`).toBeGreaterThan(carries(mood));
      expect(complement.C, `${where} complement`).toBeGreaterThan(carries(mood));
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
      // The drift is 20 degrees and the measurement now agrees, which it did
      // not: this used to allow 42 on the reasoning that hue is unstable at a
      // low chroma, and the reasoning was covering for a bug rather than for
      // noise. Chalk asked for a flat 0.045-ish of chroma without checking what
      // the hue could hold at 0.94 lightness, where sRGB is at its narrowest —
      // a green has 0.22 available up there and a blue has 0.030. Half of what
      // it asked for was outside the gamut, `hex` clipped the channels, and
      // clipping returns **a different hue**: the tint of a blue primary came
      // back 44 degrees away, a pale cyan rather than a pale blue.
      //
      // Chalk takes what the hue can hold now, so 24 is the real 20 plus the
      // couple of degrees eight bits per channel actually costs. Loosening this
      // number again means the gamut check has gone, not that the eye stopped
      // minding.
      expect(apart(hues[0], hues[4]), where).toBeLessThanOrEqual(24);
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

/**
 * How far apart two members read **on a wall**, which is the ruler the generator
 * uses and therefore the one an assertion about it has to use too.
 *
 * Straight ΔE in OKLab, except that lightness counts for less than half. A cheap
 * lamp has no black to work against and the room adds its own light to every
 * part of the picture equally, so two colours that differ only in how light they
 * are arrive at the back of the room as one colour — a distance OKLab scores as
 * real and the audience does not get.
 *
 * Derived here rather than imported, for the reason `taken` is: a test that
 * measured a generator with the generator's own arithmetic would agree with it
 * about a mistake.
 */
function far(a: string, b: string): number {
  const [x, y] = [taken(a), taken(b)];
  const at = (t: ReturnType<typeof taken>): [number, number] => {
    const rad = (t.hue * Math.PI) / 180;
    return [t.C * Math.cos(rad), t.C * Math.sin(rad)];
  };
  const [xa, xb] = at(x);
  const [ya, yb] = at(y);
  return Math.hypot((x.L - y.L) * 0.45, xa - ya, xb - yb);
}

/** The warm half of the wheel: magenta round through red and amber to yellow-green. */
const warm = (hue: number) => (((hue - 340) % 360) + 360) % 360 < 150;

describe('a colourway is searched rather than rolled', () => {
  const many = Array.from({ length: 96 }, (_, i) => `judged-${i}`);
  const everyMood = MOODS.flatMap((mood) =>
    many.map((seed) => [`${seed} ${mood}`, palette(seeded(`${seed}-${mood}`), mood), mood] as const),
  );

  it('deals five colours that are five colours', () => {
    // **The criterion the generator had no way to state, and the one this whole
    // change exists for.** Every member was already placed correctly *with
    // respect to the primary* — the bands, the chroma caps and the lifts are all
    // pairwise rules and all of them held — and nothing anywhere asked whether
    // the five came out distinguishable from each other. So a split complement
    // on a base around 150 degrees put `complement` at 302 and `accent` at 358,
    // both lifted, both landing on the same violet-pink; the deal satisfied
    // every rule it had and produced a four-colour palette with a spare.
    //
    // A graph wires to five outlets. Two of them carrying the same colour is not
    // a subtle failure of taste, it is a flow whose second cord does nothing.
    for (const [where, colours] of everyMood) {
      for (let i = 0; i < 5; i++) {
        for (let j = i + 1; j < 5; j++) {
          expect(far(colours[i], colours[j]), `${where} roles ${i}/${j}`).toBeGreaterThan(0.045);
        }
      }
    }
  });

  it('keeps the loud pair a room apart', () => {
    // `primary` and `complement` are the two that carry the picture between
    // them, and the floor they clear is four times the one above: a neighbour
    // that is merely distinguishable is doing its job, and an opposite that is
    // merely distinguishable is not an opposite.
    for (const [where, colours] of everyMood) {
      expect(far(colours[0], colours[2]), `${where} the loud pair`).toBeGreaterThan(0.19);
    }
  });

  it('rarely lets a palette be all one temperature', () => {
    // The oldest working rule in colour, and one the generator had no notion of:
    // a palette wants a dominant temperature and a **counterpoint**. All warm is
    // a fire and all cool is an aquarium, and the harmonies do not prevent
    // either — they guarantee an opposite *hue*, which is a different claim,
    // because red and yellow-green sit 120 degrees apart and are both warm.
    //
    // Asserted as a rate rather than as a law, because it is scored as a
    // preference rather than enforced as a gate, and a test that pretended
    // otherwise would be describing a generator nobody wrote. It cannot reach
    // zero either: the cool half of the wheel is wider than the warm half, so a
    // base in the greens can put all four on one side with every other criterion
    // satisfied. What the criterion buys is that it almost never happens — and
    // one in twenty is far enough above the one in sixty measured that this
    // fails when the criterion is removed rather than when a seed is unlucky.
    const flat = everyMood.filter(([, colours]) => {
      const hot = colours.slice(0, 4).filter((each) => warm(taken(each).hue)).length;
      return hot === 4 || hot === 0;
    });
    expect(flat.length / everyMood.length).toBeLessThan(0.05);
  });

  it('never deals a palette that is entirely warm', () => {
    // The one direction that *is* structural, and worth pinning separately
    // because it is the direction a stage rig fails in. Every harmony puts its
    // complement at least 122 degrees out, and 150 degrees of warm arc cannot
    // hold a base, an opposite and a mark that far apart at once.
    for (const [where, colours] of everyMood) {
      const hot = colours.slice(0, 4).filter((each) => warm(taken(each).hue)).length;
      expect(hot, `${where} is a fire`).toBeLessThan(4);
    }
  });
});

describe('a mood', () => {
  const dealt = (mood: Mood) =>
    Array.from(
      { length: 96 },
      (_, i) => [`${mood}-${i}`, palette(seeded(`${mood}-${i}`), mood)] as const,
    );

  /** Inside an arc given as a start and a span in degrees clockwise. */
  const within = (hue: number, from: number, span: number) =>
    (((hue - from) % 360) + 360) % 360 <= span;

  it('draws sunset from the warm arc and answers it from the blue side', () => {
    // The mood is the person's half of a decision the generator cannot make. It
    // is worth asserting literally, because the failure mode of a control like
    // this is not that it breaks — it is that it quietly stops meaning anything
    // and nobody notices for a month.
    for (const [where, colours] of dealt('sunset')) {
      const [primary, , complement] = colours.map(taken);
      expect(within(primary.hue, 334, 108), `${where} primary ${primary.hue}`).toBe(true);
      expect(warm(complement.hue), `${where} complement is the answer`).toBe(false);
    }
  });

  it('draws ice from the cool arc', () => {
    for (const [where, colours] of dealt('ice')) {
      const primary = taken(colours[0]);
      expect(within(primary.hue, 174, 118), `${where} primary ${primary.hue}`).toBe(true);
      expect(warm(primary.hue), `${where} primary is cool`).toBe(false);
    }
  });

  it('holds earth down rather than making it pale', () => {
    // **The distinction the whole file turns on**, stated as a test because it
    // is the one a future edit will get wrong. Rust, ochre, olive and brick are
    // not desaturated oranges and yellows — they are *dark* ones, and reaching
    // them by pulling chroma out gives a dusty pastel, which is exactly the
    // thing a cheap lamp cannot throw. So the assertion is on lightness, and the
    // chroma floor the other moods clear still applies underneath.
    //
    // A lift alone could not do it and that is worth remembering: a lift is one
    // number and a peak is not, so seven hundredths off an orange is rust while
    // seven hundredths off a yellow is still lemon. `earth` dealt limes until it
    // was given a ceiling.
    for (const [where, colours] of dealt('earth')) {
      const [primary, secondary, complement, accent] = colours.map(taken);
      for (const [role, each] of [
        ['primary', primary],
        ['secondary', secondary],
        ['complement', complement],
        ['accent', accent],
      ] as const) {
        expect(each.L, `${where} ${role} is held down`).toBeLessThanOrEqual(0.78);
      }
      expect(warm(primary.hue), `${where} primary is warm`).toBe(true);
      expect(primary.C, `${where} primary still carries`).toBeGreaterThan(0.07);
    }
  });

  it('keeps flare to one family and one answer', () => {
    for (const [where, colours] of dealt('flare')) {
      const hues = colours.map((each) => taken(each).hue);
      expect(apart(hues[0], hues[1]), `${where} the family`).toBeLessThanOrEqual(16);
      expect(apart(hues[0], hues[2]), `${where} the spark`).toBeGreaterThanOrEqual(140);
    }
  });

  it('deals neon louder than the wheel does on its own', () => {
    // Electric is the whole of what the word promises, and the only way to break
    // it silently is to leave the charge range where every other mood has it.
    for (const [where, colours] of dealt('neon')) {
      expect(taken(colours[0]).C, `${where} primary`).toBeGreaterThan(0.15);
    }
  });
});

describe('a library of colourways', () => {
  const seeds = Array.from({ length: 96 }, (_, i) => `library-${i}`);

  /** The widest stretch of the wheel no colourway in the library sits in. */
  const unused = (library: Record<string, string[]>) => {
    const hues = Object.values(library)
      .map((colours) => taken(colours[0]).hue)
      .sort((a, b) => a - b);
    let widest = 0;
    for (let i = 0; i < hues.length; i++) {
      widest = Math.max(widest, (hues[(i + 1) % hues.length] - hues[i] + 360) % 360);
    }
    return widest;
  };

  it('gives the wheel somewhere to turn to', () => {
    // Four excellent deals are not a library. This is the second way the old
    // generator felt random when it was not: nothing stopped three of the four
    // being excellent in the same part of the wheel, and turning through those
    // is a wheel that does not appear to turn — the flow changes, the palette
    // changes, and the wall stays roughly amber all night.
    //
    // Measured as the widest arc nobody occupies, which is the honest question:
    // a library that leaves three quarters of the wheel empty has one idea in
    // it. Dealt independently the worst of these seeds leaves 346 degrees empty
    // — every colourway within fourteen degrees of every other — and the median
    // leaves 222. Dealt against each other the worst leaves 186. The threshold
    // sits between those two worlds on purpose: it fails the day the rows stop
    // being dealt as a set, rather than the day one of them is unlucky.
    for (const seed of seeds) {
      const library = palettes(seeded(seed), ['a', 'b', 'c', 'd'], {});
      expect(unused(library), seed).toBeLessThan(220);
    }
  });

  it('lets a pinned mood out of the spread', () => {
    // Naming a light is an instruction and the spread is only a default. A
    // person who has set two rows to `ice` has said something more specific than
    // "be different from each other", and a library that answered by dragging
    // one of them into the oranges would be ignoring the only part of this
    // anybody actually asked for.
    for (const seed of seeds.slice(0, 24)) {
      const library = palettes(seeded(seed), ['a', 'b', 'c', 'd'], { a: 'ice', b: 'ice' });
      for (const name of ['a', 'b']) {
        expect(warm(taken(library[name][0]).hue), `${seed} ${name} stayed cool`).toBe(false);
      }
    }
  });

  it('deals every name it was given, and only those', () => {
    const library = palettes(seeded('library-0'), ['one', 'two', 'three'], { two: 'earth' });
    expect(Object.keys(library)).toEqual(['one', 'two', 'three']);
    for (const colours of Object.values(library)) expect(colours).toHaveLength(5);
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

  it('deals every oscillator at one cycle a beat, whatever shape it is', () => {
    // The shapes came across from `wave`, which ran once a beat and had no rate
    // to say so. An lfo's rate rests wherever its shape's calibration puts it —
    // a whole-note cycle for sine and saw, a quarter-note for ramp and pulse —
    // so a deal that leaves it alone runs half its shapes four times slower
    // than the other half, in the same graph, for no reason a person could see.
    let oscillators = 0;
    for (const seed of seeds) {
      const rng = seedOf(seed);
      for (let i = 0; i < 12; i++) {
        for (const node of randomizeCircuit(rng).nodes) {
          if (node.kind !== 'lfo') continue;
          oscillators += 1;
          expect(node.values?.rate, node.op).toBe(
            lfoRateForBeat(node.op as (typeof LFO_SHAPES)[number]),
          );
        }
      }
    }
    expect(oscillators).toBeGreaterThan(0);
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

  it('re-deals inside the mood a row was pinned to rather than past it', () => {
    // A mood is what a person asked this row to *be*, so the button that deals
    // new colours has to deal new colours **of that kind**. Dealing a fresh mood
    // as well would be the machine overruling the only instruction it was given,
    // and would make the control look broken rather than ignored — the row would
    // visibly change light every time anybody pressed anything.
    const pinned: Scheme = {
      ...EXAMPLES,
      colorways: { ...EXAMPLES.colorways },
      moods: { ember: 'earth', cold: 'ice' },
    };
    for (const seed of seeds) {
      const dealt = randomizeScheme(seed, SHOW, pinned, ['colours']);
      expect(dealt.moods, seed).toEqual(pinned.moods);
      // Earth is held down; nothing else in the library is. That the pin
      // actually reached the deal is the point of the assertion — a mood that
      // was carried but not consulted would pass an equality check alone.
      for (const each of dealt.colorways.ember.slice(0, 4)) {
        expect(taken(each).L, `${seed} ember stayed earth`).toBeLessThanOrEqual(0.78);
      }
    }
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
