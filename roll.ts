import type { Circuit, CircuitNode, Scheme, Show } from './protocol.ts';
import {
  FIELD_MODES,
  FRACTAL_MODES,
  GRADE_MODES,
  LENS_MODES,
  SOURCES,
  SPREAD_MODES,
} from './protocol.ts';

/**
 * A library, rolled.
 *
 * It used to roll a *show*: colourways, song assignments, section energies,
 * per-track bindings and two circuits at once, because a show was a table of
 * decisions with a couple of graphs in it. A show is a library of graphs and a
 * wheel now, so this rolls the two things a library is made of — **flows and
 * colourways** — and the wheel turns through whatever it made.
 *
 * Not a scatter of random numbers. A random graph is easy and always looks like
 * noise; what makes a rolled one look like something is that it walks a
 * **shape** — a picture, a few things done to it, a colour operation or two —
 * and randomises what fills each slot. The shape is what makes it a flow; the
 * fill is what makes it a different one every time.
 *
 * Colours are a harmony rather than five hues: a base, one of five relationships
 * to it — each of which contains an opposite — and two members taken loud. Kept
 * light rather than dark, because a cheap lamp has no black to work against and
 * a dark colourway is a dark screen. **Saturated is not the same as dark**, and
 * confusing the two is what made these pastel.
 *
 * Deterministic in its seed, which is the whole reason there is a seed: undo
 * covers the roll you just did, and a seed covers the one from last Tuesday.
 */

/** xmur3 into mulberry32: short, fast, and identical everywhere it runs. */
export function seeded(seed: string): () => number {
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

type Rng = () => number;

const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)];
const between = (rng: Rng, lo: number, hi: number) => lo + rng() * (hi - lo);
const chance = (rng: Rng, p: number) => rng() < p;
const round2 = (n: number) => Math.round(n * 100) / 100;

function shuffled<T>(rng: Rng, list: readonly T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Words to name things with.
 *
 * Deliberately none of them a DAW term — a colourway called "bus" or a circuit
 * called "send" would be a thing you had to read twice every time.
 */
const WORDS = [
  'ember', 'frost', 'dusk', 'neon', 'moss', 'cobalt', 'rust', 'ion',
  'violet', 'tide', 'ash', 'solar', 'jade', 'opal', 'storm', 'coral',
  'amber', 'slate', 'flint', 'vapour', 'halo', 'drift', 'quartz', 'onyx',
  'lumen', 'cinder', 'mica', 'glass', 'static', 'aurora', 'pitch', 'brine',
];

/** A seed you can say out loud, which is the only kind anyone writes down. */
export function newSeed(): string {
  const at = () => WORDS[Math.floor(Math.random() * WORDS.length)];
  return `${at()}-${at()}-${Math.floor(Math.random() * 900 + 100)}`;
}

function hex(h: number, s: number, l: number): string {
  const f = (n: number) => {
    const k = (n + ((h % 360) + 360) / 30) % 12;
    const v = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Five colours in one relationship, and **every relationship contains an
 * opposite**.
 *
 * That is the part that changed. Two of these were a spread of neighbours —
 * analogous over 44 degrees, near-mono over 16 — and a set drawn entirely out of
 * one of those is a wall in a single colour: harmonious, and indistinguishable
 * from a projector with a gel on it. Each now carries its counterpoint as the
 * fourth and fifth member, so there is always something in the palette that is
 * *not* the base to read the base against.
 *
 * The offsets are still one relationship each rather than five hues picked
 * apart, because five random hues is what a colour picker gives you and it never
 * looks like anything.
 */
const HARMONIES: readonly (readonly number[])[] = [
  [0, 24, 48, 204, 180], // neighbours, answered
  [0, 120, 240, 60, 300], // triadic
  [0, 180, 20, 200, 160], // complementary
  [0, 150, 210, 30, 180], // split complement
  [0, 12, 348, 168, 192], // near mono, answered
];

/** How far round the wheel two hues are, the short way. */
function apart(a: number, b: number): number {
  const gap = Math.abs(a - b) % 360;
  return gap > 180 ? 360 - gap : gap;
}

/** What a hue at full saturation is worth in light. Green nearly all of it. */
function luma(hue: number): number {
  const h = ((((hue % 360) + 360) % 360) / 60);
  const x = 1 - Math.abs((h % 2) - 1);
  const [r, g, b] =
    h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x]
    : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * A lightness that reads the same the whole way round the wheel.
 *
 * Hue and brightness are not independent: a yellow at half lightness is a bright
 * colour and a blue at half lightness is nearly black, because the eye takes
 * most of its luminance from green. A palette rolled at one lightness therefore
 * has members that punch and members that vanish, and the ones that vanish are
 * always the blues and violets — which on a lamp with no black to work against
 * is a colour nobody in the room can see.
 *
 * So the number is a **target** and the hue's own luma says how far above it the
 * colour has to sit. It costs one multiply and it is the difference between five
 * colours and three colours and two smudges.
 */
function evenly(hue: number, l: number): number {
  return Math.min(0.94, l + (1 - luma(hue)) * 0.12);
}

/**
 * A palette: five colours, two of them loud, one of them light.
 *
 * **The two loud ones are the base and whatever sits furthest from it**, which
 * is the pair that decides whether a palette reads across a room. They are taken
 * near the top of the saturation range and at the lightness where a hue is
 * strongest — a colour at 70% lightness has given most of its saturation away
 * whatever the number says, which is why the old range topping out there came
 * back as pastel however high the saturation went.
 *
 * **The light one is not decoration.** Tracks take a colour by position, so a
 * set drawn entirely out of loud hues has nothing in it to read edges against
 * and turns to mud on a wall. It is a tint rather than the near-white it was —
 * enough colour in it to belong to the palette, light enough to do its job — and
 * it is never one of the two loud ones, so a palette cannot lose both its
 * anchors to one dice roll.
 *
 * The first colour is the base on purpose: a flow's `paint`, `source` and every
 * generator draw from `colors[0]`, so the palette's loudest member is the one a
 * flow that ignores the set is made of.
 */
export function palette(rng: Rng): string[] {
  const base = rng() * 360;
  const harmony = pick(rng, HARMONIES);
  const far = harmony.reduce(
    (most, offset, i) => (apart(offset, 0) > apart(harmony[most], 0) ? i : most),
    0,
  );
  const rest = harmony.map((_, i) => i).filter((i) => i !== 0 && i !== far);
  const light = pick(rng, rest);
  return harmony.map((offset, i) => {
    const hue = base + offset;
    const at = (s: number, lo: number, hi: number) => hex(hue, s, evenly(hue, between(rng, lo, hi)));
    if (i === 0 || i === far) return at(between(rng, 0.92, 1), 0.46, 0.54);
    if (i === light) return at(between(rng, 0.3, 0.46), 0.83, 0.9);
    return at(between(rng, 0.7, 0.9), 0.48, 0.6);
  });
}

/**
 * The `lens` modes a roll wires, and the inlet each one drives.
 *
 * This was a hand-written table of five node kinds, because the five geometry
 * kinds were five kinds with five different inlet names and nothing in the
 * vocabulary said they were a set. They are one node's modes now, so what is
 * left here is only the part a roll actually needs: which number to reach for.
 */
/**
 * The lens modes a roll may reach for, which is every one but `creep`.
 *
 * `creep` is a zoom per *second* and only means anything when its result is fed
 * back into the picture it came from — under a `last`, where the frames
 * compound. A roll never wires one, so a rolled `creep` is a lens that moves the
 * point by a fraction of a percent and nothing else: a dead node on the canvas
 * wearing a real name. Excluded here rather than in the vocabulary, because the
 * mode is not the problem; dealing it into a graph with no feedback in it is.
 */
const ROLLED_LENS_MODES: readonly string[] = LENS_MODES.filter((mode) => mode !== 'creep');

const LENS_VALUE: Record<string, string> = {
  zoom: 'by',
  swirl: 'turn',
  fold: 'sides',
  wobble: 'amount',
  tile: 'count',
  mirror: 'line',
  kaleido: 'segments',
  twist: 'turn',
  ripple: 'waves',
  slice: 'bands',
  pixelate: 'blocks',
};

/** The number a rolled `grade` drives, one per mode. */
const GRADE_VALUE: Record<string, string> = {
  levels: 'gain',
  hue: 'shift',
  posterize: 'steps',
  invert: 'hold',
};

/** The number a rolled `field` drives, one per mode. */
const FIELD_VALUE: Record<string, string> = {
  cells: 'weave',
  clouds: 'weave',
  metaballs: 'balls',
};

/**
 * The number a rolled `fractal` drives — the one that is *always* visible.
 * Never `zoom`: a meter resting near zero parks it at one end of its range,
 * and a parked zoom is a flat frame of fractal interior.
 */
const FRACTAL_VALUE: Record<string, string> = {
  mandelbrot: 'turn',
  julia: 'shape',
};

/**
 * The lights a roll may hang, and the two numbers that shape each one.
 *
 * `caustics` has no `from` — sunlight through water arrives from everywhere —
 * so it is the one light a roll never gives a `place`.
 */
const LIGHT_VALUE: Record<string, [string, string]> = {
  lamp: ['carry', 'soft'],
  beam: ['aim', 'spread'],
  shafts: ['blades', 'haze'],
  caustics: ['weave', 'glint'],
};

/** The number a rolled `spread` drives, one per mode. */
const SPREAD_VALUE: Record<string, string> = {
  bloom: 'reach',
  smear: 'reach',
  edge: 'width',
  shift: 'split',
};

const SIGNALS = ['level', 'beat', 'phase', 'pulse'] as const;
const WAVES = ['sine', 'saw', 'ramp', 'pulse'] as const;
const MATHS = ['add', 'multiply', 'average'] as const;

/**
 * Everything a roll may wire blind, which is everything that is not `spread`.
 *
 * It used to be `EFFECTS` minus a hand-maintained list of the four that read
 * their input several times, kept by name and by hand because nesting two of
 * them multiplies the shader — a roll would stack three and hand the driver
 * something that takes a second to compile. **`spread` is that list now**, so
 * there is nothing to keep: a roll reaches for `lens` and `grade` and the rule
 * is in the vocabulary rather than in a filter beside it. See `MAX_LINES`.
 */

/**
 * A flow that always compiles and usually looks like something.
 *
 * It deals one of **five shapes**, where it used to deal one: the classic
 * chain, a priced feature, a hung light, a spread finish, and a flow that
 * listens to the song's key. A single shape kept every deal inside one family
 * resemblance — radial, one texture, one overlay — and left half the priced
 * vocabulary (`field`, `fractal`, `light`, `spread`) unreachable, which a
 * contact sheet of twenty-four deals made undeniable.
 *
 * What keeps a shape rather than a scatter is unchanged: each one walks a
 * structure a person might wire — a picture, moved about, then worked on — and
 * randomises what fills the slots. And the budget rules are constructive
 * rather than checked: one `spread` at most, and never over a `fractal`,
 * `field` or `light`, so a deal cannot wire the multiplication the compiler
 * would refuse.
 *
 * `video` and `flow` stay out on purpose — one depends on files a machine may
 * not have, the other on a library the deal must not assume — and `polar` is
 * an authoring tool, not a thing to be dealt.
 */
export function rollCircuit(rng: Rng): Circuit {
  const nodes: CircuitNode[] = [];
  const cords: { from: string; to: string }[] = [];
  let next = 0;
  const add = (node: Omit<CircuitNode, 'id'>): string => {
    const id = `n${next++}`;
    nodes.push({ id, ...node });
    return id;
  };
  const wire = (from: string, to: string) => cords.push({ from, to });

  let values = 0;
  /** Whatever drives an amount: a value, an envelope, a signal, or arithmetic on two. */
  const drive = (x: number, y: number, into: string) => {
    const roll = rng();
    if (roll < 0.3 && values < 4) {
      values += 1;
      const from = add({
        kind: 'value',
        x,
        y,
        value: round2(between(rng, 0.15, 0.85)),
        label: pick(rng, WORDS),
      });
      wire(`${from}/n`, into);
      return;
    }
    if (roll < 0.5) {
      // An envelope rather than a bare meter, because a picture driven by the
      // raw meter twitches and one driven by an envelope breathes — and
      // breathing is what makes a rolled flow read designed.
      const from = add({
        kind: 'track',
        of: 'master',
        op: 'level',
        x,
        y,
        smooth: round2(between(rng, 0.2, 0.7)),
      });
      wire(`${from}/n`, into);
      return;
    }
    if (roll < 0.72) {
      const from = add({ kind: 'playback', op: pick(rng, SIGNALS), x, y });
      wire(`${from}/n`, into);
      return;
    }
    if (roll < 0.8) {
      // A song fact: steady through a song, different in the next one, which
      // is a kind of motion no meter can supply.
      const from = add({ kind: 'song', op: chance(rng, 0.6) ? 'key' : 'section', x, y });
      wire(`${from}/n`, into);
      return;
    }
    if (roll < 0.92) {
      const source = add({ kind: 'playback', op: pick(rng, SIGNALS), x: x - 150, y });
      const shape = add({ kind: 'wave', op: pick(rng, WAVES), x, y });
      wire(`${source}/n`, `${shape}/phase`);
      wire(`${shape}/n`, into);
      return;
    }
    const a = add({ kind: 'playback', op: pick(rng, SIGNALS), x: x - 150, y });
    const b = add({
      kind: 'track',
      of: 'master',
      op: 'level',
      x: x - 150,
      y: y + 130,
      smooth: round2(between(rng, 0.2, 0.6)),
    });
    const sum = add({ kind: 'math', op: pick(rng, MATHS), x, y });
    wire(`${a}/n`, `${sum}/a`);
    wire(`${b}/n`, `${sum}/b`);
    wire(`${sum}/n`, into);
  };

  let column = 0;
  const at = () => 20 + column++ * 185;

  const point = `${add({ kind: 'point', x: at(), y: 20 })}/p`;

  /** The point, bent through driven lenses. The front half of most shapes. */
  const bent = (least: number, most: number): string => {
    let carry = point;
    const steps = least + Math.floor(rng() * (most - least + 1));
    for (const op of shuffled(rng, [...ROLLED_LENS_MODES]).slice(0, steps)) {
      const x = at();
      const node = add({ kind: 'lens', op, x, y: 20 });
      wire(carry, `${node}/p`);
      drive(x, 210 + (next % 2) * 150, `${node}/${LENS_VALUE[op]}`);
      carry = `${node}/p`;
    }
    return carry;
  };

  /** The Live set more often than not: a rolled screensaver is not this rig. */
  const lead = (setChance: number, carry: string): string => {
    const picture = chance(rng, setChance)
      ? add({ kind: 'tracks', op: 'by name', x: at(), y: 20 })
      : add({ kind: 'source', op: pick(rng, SOURCES), x: at(), y: 20 });
    wire(carry, `${picture}/p`);
    return `${picture}/c`;
  };

  /** A second picture over the first, its amount driven. */
  const over = (carry: string, top: string, op?: string): string => {
    const x = at();
    const mix = add({ kind: 'blend', op: op ?? (chance(rng, 0.7) ? 'screen' : 'add'), x, y: 20 });
    wire(carry, `${mix}/base`);
    wire(top, `${mix}/top`);
    drive(x, 430, `${mix}/amount`);
    return `${mix}/c`;
  };

  const graded = (carry: string, p: number): string => {
    if (!chance(rng, p)) return carry;
    const x = at();
    const op = pick(rng, GRADE_MODES);
    const node = add({ kind: 'grade', op, x, y: 20 });
    wire(carry, `${node}/c`);
    drive(x, 210, `${node}/${GRADE_VALUE[op]}`);
    return `${node}/c`;
  };

  const done = (carry: string): Circuit => {
    const out = add({ kind: 'out', x: at(), y: 20 });
    wire(carry, `${out}/c`);
    return { nodes, cords };
  };

  const shape = rng();

  // --- the classic chain: a picture, moved about, then worked on -----------
  if (shape < 0.35) {
    let carry = lead(0.6, bent(1, 3));
    if (chance(rng, 0.6)) {
      const node = add({ kind: 'lens', op: pick(rng, ROLLED_LENS_MODES), x: at(), y: 20 });
      wire(carry, `${node}/c`);
      carry = `${node}/c`;
    }
    if (chance(rng, 0.5)) {
      const other = add({ kind: 'source', op: pick(rng, SOURCES), x: at(), y: 250 });
      wire(point, `${other}/p`);
      carry = over(carry, `${other}/c`);
    }
    return done(graded(carry, 0.5));
  }

  // --- a priced feature: a fractal or a field carries the frame ------------
  if (shape < 0.55) {
    const kind = chance(rng, 0.5) ? 'fractal' : 'field';
    // A fractal reads the raw point. It is exquisitely sensitive to where the
    // plane is, and a driven bender in front of one mostly lands the whole
    // frame in flat interior; its own turn and shape carry the motion.
    const carry = kind === 'fractal' ? point : bent(0, 2);
    const op = kind === 'fractal' ? pick(rng, FRACTAL_MODES) : pick(rng, FIELD_MODES);
    const x = at();
    const feature = add({ kind, op, x, y: 20 });
    wire(carry, `${feature}/p`);
    drive(x, 210, `${feature}/${kind === 'fractal' ? FRACTAL_VALUE[op] : FIELD_VALUE[op]}`);
    let held = `${feature}/c`;
    if (chance(rng, 0.5)) {
      const set = add({ kind: 'tracks', op: 'by name', x: at(), y: 250 });
      wire(point, `${set}/p`);
      held = over(held, `${set}/c`, 'screen');
    }
    return done(graded(held, 0.4));
  }

  // --- a hung light: a lamp somewhere, over a wash or the set --------------
  if (shape < 0.7) {
    const base = chance(rng, 0.5)
      ? lead(1, bent(0, 1))
      : chance(rng, 0.55)
        ? (() => {
            // Dimmed, because this wash exists to be lit: a screened light
            // over a mid-bright flat colour is invisible, and the whole deal
            // rides on the light reading.
            const wash = add({
              kind: 'paint',
              x: at(),
              y: 20,
              values: { amount: round2(between(rng, 0.12, 0.35)) },
            });
            return `${wash}/c`;
          })()
        : (() => {
            const cloud = add({ kind: 'field', op: 'clouds', x: at(), y: 20 });
            wire(point, `${cloud}/p`);
            return `${cloud}/c`;
          })();
    const op = pick(rng, Object.keys(LIGHT_VALUE));
    const x = at();
    const light = add({ kind: 'light', op, x, y: 250 });
    wire(point, `${light}/p`);
    if (op !== 'caustics') {
      // The light hangs where the place says, and the place is driven — which
      // is what makes a dealt lamp wander instead of sitting in the middle.
      const spotX = at();
      const spot = add({ kind: 'place', x: spotX, y: 430 });
      drive(spotX - 185, 430, `${spot}/x`);
      drive(spotX - 185, 560, `${spot}/y`);
      wire(`${spot}/p`, `${light}/from`);
    }
    drive(x, 430, `${light}/${LIGHT_VALUE[op][Math.floor(rng() * 2)]}`);
    return done(graded(over(base, `${light}/c`), 0.4));
  }

  // --- a spread finish: the one multiplying family, over a cheap chain -----
  if (shape < 0.9) {
    let carry = lead(0.6, bent(1, 2));
    if (chance(rng, 0.5)) {
      const node = add({ kind: 'lens', op: pick(rng, ROLLED_LENS_MODES), x: at(), y: 20 });
      wire(carry, `${node}/c`);
      carry = `${node}/c`;
    }
    const x = at();
    const op = pick(rng, SPREAD_MODES);
    const finish = add({ kind: 'spread', op, x, y: 20 });
    wire(carry, `${finish}/c`);
    drive(x, 210, `${finish}/${SPREAD_VALUE[op]}`);
    return done(graded(`${finish}/c`, 0.3));
  }

  // --- keyed: the song's key turns the colour, so a set modulates ----------
  let carry = lead(0.7, bent(1, 2));
  if (chance(rng, 0.5)) {
    const node = add({ kind: 'lens', op: pick(rng, ROLLED_LENS_MODES), x: at(), y: 20 });
    wire(carry, `${node}/c`);
    carry = `${node}/c`;
  }
  const x = at();
  const hue = add({ kind: 'grade', op: 'hue', x, y: 20 });
  wire(carry, `${hue}/c`);
  const key = add({ kind: 'song', op: 'key', x, y: 210 });
  wire(`${key}/n`, `${hue}/shift`);
  return done(`${hue}/c`);
}

// --- the roll ------------------------------------------------------------

/**
 * Which part of the library a roll is allowed to touch.
 *
 * All-or-nothing is the wrong shape for how this gets used: by the second
 * evening the colourways are the part you have settled and the flows are the
 * part you are still fishing for, and a button that deals both is a button you
 * stop pressing.
 */
export type RollPart = 'colours' | 'flows' | 'rotation';

export const ROLL_PARTS: readonly RollPart[] = ['colours', 'flows', 'rotation'];

/** What each part is, for a control that has one line to say it in. */
export const ROLL_ABOUT: Record<RollPart, string> = {
  colours: 'four fresh colourways: five each, two of them loud, one a tint',
  flows: 'four freshly wired flows, replacing the last four it wired',
  rotation: 'how often the wheel turns, and how fast the whole show moves',
};

/**
 * A library, from a seed and from whatever the set contains.
 *
 * **Every part is rolled and then only the wanted ones land.** Drawing from the
 * generator in the same order regardless of what is kept is what makes a seed
 * mean one show: keeping only the colours has to give the same colours rolling
 * everything would have, or a seed written on a hand is worth nothing.
 *
 * Nothing about the songs is rolled. A song entry is an override now, and
 * rolling one would be the machine writing down an exception nobody asked for —
 * which is exactly the noise the cascade used to generate.
 */
export function rollScheme(
  seed: string,
  _show: Show,
  base: Scheme,
  parts: readonly RollPart[] = ROLL_PARTS,
): Scheme {
  const rng = seeded(seed);
  const rolling = (part: RollPart) => parts.includes(part);

  const names = shuffled(rng, WORDS).slice(0, 4);
  const rolledColorways: Record<string, string[]> = {};
  for (const name of names) rolledColorways[name] = palette(rng);
  const colorways = rolling('colours') ? rolledColorways : base.colorways;

  const flows: Scheme['flows'] = { ...base.flows };
  if (rolling('flows')) {
    // Only what a previous roll wired. A flow someone built by hand is work
    // rather than scaffolding, and deleting it as a side effect of this button
    // is not something one level of undo makes acceptable.
    for (const [id, def] of Object.entries(flows)) if (def.rolled) delete flows[id];
  }
  const wired: string[] = [];
  for (let i = 0; i < 4; i++) {
    const id = `roll${i + 1}`;
    const [a, b] = shuffled(rng, WORDS);
    const circuit = rollCircuit(rng);
    if (!rolling('flows')) continue;
    flows[id] = { name: `${a[0].toUpperCase()}${a.slice(1)} ${b}`, circuit, rolled: true };
    wired.push(id);
  }

  const bars = pick(rng, [4, 8, 8, 16]);
  const rotation: Scheme['rotation'] = {
    // Emptied rather than filled: an empty pool means "everything there is",
    // which is what you want the moment after a roll has just made four things.
    flows: [],
    colorways: [],
    bars,
    onClip: true,
    // The palette on a longer wheel than the flow, so a change is usually one
    // thing moving rather than everything at once.
    colorEvery: bars * pick(rng, [1, 2, 2, 3]),
  };

  const pace = Math.round(between(rng, -1, 1));

  return {
    seed,
    flows,
    colorways,
    rotation: rolling('rotation') ? rotation : base.rotation,
    songs: base.songs,
    defaults: {
      ...base.defaults,
      // A fallback that names something that exists, whichever way round the
      // parts were rolled.
      colorway: colorways[base.defaults.colorway]
        ? base.defaults.colorway
        : (Object.keys(colorways)[0] ?? base.defaults.colorway),
      flow: flows[base.defaults.flow]
        ? base.defaults.flow
        : (wired[0] ?? Object.keys(flows)[0] ?? base.defaults.flow),
      pace: rolling('rotation') ? pace : base.defaults.pace,
    },
  };
}

export { WORDS };
