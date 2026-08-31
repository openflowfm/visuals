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
 * A library, randomised.
 *
 * it used to deal a *show*: colourways, song assignments, section energies,
 * per-track bindings and two circuits at once, because a show was a table of
 * decisions with a couple of graphs in it. A show is a library of graphs and a
 * wheel now, so this randomises the two things a library is made of — **flows and
 * colourways** — and the wheel turns through whatever it made.
 *
 * Not a scatter of random numbers. A random graph is easy and always looks like
 * noise; what makes a randomised one look like something is that it walks a
 * **shape** — a picture, a few things done to it, a colour operation or two —
 * and randomises what fills each slot. The shape is what makes it a flow; the
 * fill is what makes it a different one every time.
 *
 * Colours are a harmony rather than five hues, and every colour is dealt **to a
 * role**: a base, one of five relationships to it, an answer from across the
 * wheel taken as loud as the base, a lighter accent for what has to be seen
 * small, and a tint of the base to read edges against. Kept light rather than
 * dark, because a cheap lamp has no black to work against and a dark colourway
 * is a dark screen. **Saturated is not the same as dark**, and confusing the two
 * is what made these pastel.
 *
 * Deterministic in its seed, which is the whole reason there is a seed: undo
 * covers the randomise you just did, and a seed covers the one from last Tuesday.
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

/** OKLab to linear sRGB, at one lightness, chroma and hue. Ottosson's matrices. */
function linearOf(l: number, c: number, hueDegrees: number): [number, number, number] {
  const h = (hueDegrees * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const lp = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mp = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sp = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * lp - 3.3077115913 * mp + 0.2309699292 * sp,
    -1.2684380046 * lp + 2.6097574011 * mp - 0.3413193965 * sp,
    -0.0041960863 * lp - 0.7034186147 * mp + 1.707614701 * sp,
  ];
}

const inGamut = (l: number, c: number, h: number) =>
  linearOf(l, c, h).every((v) => v >= -0.0001 && v <= 1.0001);

/**
 * The most chroma sRGB can hold at this lightness and hue.
 *
 * Most of OKLCH is not in sRGB, and the naive conversion of a colour outside it
 * returns channels past 0–1 that clip to something with the wrong *hue*. So the
 * generator asks how much colour is available and takes a fraction of it, rather
 * than naming a number and hoping.
 */
function maxChroma(l: number, h: number): number {
  let lo = 0;
  let hi = 0.4;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(l, mid, h)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * The lightness at which a hue is most colourful, and how colourful that is.
 *
 * **This is the thing the old generator had no way to ask, and the reason its
 * palettes were muddy.** How vivid a hue can be depends entirely on how light it
 * is, and *where* that peak sits moves right around the wheel: a fully saturated
 * yellow-green is a light colour and a fully saturated blue is a dark one. There
 * is no yellow at the lightness of a vivid blue — it does not exist in sRGB — so
 * naming one lightness for every member and pulling chroma back until it fitted
 * asked for exactly the colour that cannot be had, and got mud in the yellows
 * every time.
 *
 * The four shipped colourways have always done this by eye. Measured in OKLCH,
 * every non-tint member of all four sits at or near its own hue's peak, and
 * their lightnesses run from 0.60 to 0.92 as a result — which reads as a deal
 * with no rule in it and is the rule.
 *
 * A ternary-ish narrowing rather than a scan, because the peak is a single
 * smooth maximum in lightness.
 */
function cusp(h: number): number {
  let lo = 0.3;
  let hi = 0.98;
  let at = 0.7;
  for (let pass = 0; pass < 4; pass++) {
    const step = (hi - lo) / 12;
    let best = -1;
    for (let l = lo; l <= hi + 1e-9; l += step) {
      const c = maxChroma(l, h);
      if (c > best) {
        best = c;
        at = l;
      }
    }
    lo = Math.max(0.05, at - step);
    hi = Math.min(0.99, at + step);
  }
  return at;
}

/**
 * A lightness above a hue's peak, named by **how much colour it is willing to
 * give up** rather than by a number of steps.
 *
 * A fixed lift does not mean a fixed thing. Chroma falls away from the peak at
 * a rate that is different for every hue: +0.12 off an amber, which peaks around
 * 0.75, lands at 0.87 where amber has almost nothing left — while the same +0.12
 * off a yellow costs it almost nothing, because yellow peaks light and stays
 * colourful up there. So `accent` was a strong mark for half the wheel and a
 * washed-out one for the rest, from one number that looked even.
 *
 * Asking for the lightness where this hue still holds `keep` of its best chroma
 * gives every hue the same *bargain* instead of the same *step*.
 */
function lifted(h: number, keep: number): number {
  const peak = cusp(h);
  const want = maxChroma(peak, h) * keep;
  let lo = peak;
  let hi = 0.97;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (maxChroma(mid, h) > want) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * OKLCH to `#rrggbb`.
 *
 * ## Why not HSL
 *
 * This used to be HSL with two corrections bolted onto it, and both of them were
 * the same admission: **HSL's L is not lightness and its H is not evenly
 * spaced.** A yellow and a blue at `l: 0.5` are not remotely as bright as each
 * other, so a palette dealt at one number had members that punched and members
 * that vanished — patched by an `evenly()` that added back a fraction of the
 * hue's own luma, itself computed from a hand-written primaries table. And a
 * step of 22 degrees is the whole distance from red to orange but almost nothing
 * between two greens, so one harmony read as a real relationship on one deal and
 * as the same colour twice on the next.
 *
 * OKLab was built to fix exactly that. `L` is perceptual lightness, so the
 * correction is deleted rather than improved. `C` is chroma — *how much colour
 * there is* — and is independent of `L`, where the old code could only ask for
 * "saturation 0.9", which at a light lightness is a pastel and at a mid one is a
 * fire engine. And hue degrees are near enough perceptually even that an offset
 * means one relationship wherever the base landed.
 */
function hex(l: number, c: number, h: number): string {
  const encode = (v: number) =>
    v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return `#${linearOf(l, c, h)
    .map((v) =>
      Math.round(Math.max(0, Math.min(1, encode(Math.max(0, Math.min(1, v))))) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/**
 * The relationships a palette can be built on, as hue offsets from the primary.
 *
 * These used to be five flat lists of offsets whose **roles were emergent**: the
 * randomiser found whichever member sat furthest round the wheel and called that
 * the loud answer, then picked one of the leftovers at random to be the light
 * one. So which position held the opposite moved from deal to deal, and a graph
 * cannot wire to a position that moves.
 *
 * A colourway is five named roles now, so a harmony states them. Each row is one
 * relationship a person could name, and every one of them puts something at
 * least 120 degrees from the base — a palette of neighbours is a wall in one
 * colour, harmonious and indistinguishable from a gel over the lamp.
 *
 * The degrees are **OKLCH** degrees, so they are near enough perceptually even
 * that one row means one relationship wherever the base lands. The same numbers
 * in HSL did not: 25 degrees is the whole distance from red to orange and almost
 * nothing between two greens, so `analogous` used to deal a real pairing half
 * the time and the same colour twice the other half.
 *
 * `chalk` is not here. It is a tint of the primary drifted a little warm or
 * cool, which is what all four shipped colourways already do and what the role
 * is for: it is the palette's answer to white, and the colour a generator's hot
 * half goes toward. A highlight belongs to the light in the room, so it belongs
 * to the base.
 */
interface Harmony {
  /** What a person would call it. Here for the reader, not for the app. */
  name: string;
  secondary: number;
  complement: number;
  accent: number;
}

const HARMONIES: readonly Harmony[] = [
  { name: 'complementary', secondary: 26, complement: 180, accent: 206 },
  { name: 'split complement', secondary: 28, complement: 152, accent: 208 },
  { name: 'triadic', secondary: 24, complement: 122, accent: 242 },
  { name: 'analogous, answered', secondary: 32, complement: 196, accent: 60 },
  { name: 'rectangle', secondary: 64, complement: 180, accent: 244 },
];

/**
 * A palette: one colour per role, dealt to the role rather than to a position.
 *
 * Each of the five is a job a graph can wire to, so the deal states all five
 * instead of finding two of them afterwards. Every member is placed **relative
 * to its own hue's peak** rather than at a lightness named in advance — see
 * `cusp`, which is the whole of why this stopped producing mud.
 *
 * - **primary** sits at its hue's peak, taking nearly all the colour available
 *   there. Every generator starts here.
 * - **secondary** is the harmony's neighbour, a little lighter and pulled back to
 *   around four fifths of *the primary's* chroma, so the palette has somewhere to
 *   sit that is not a second shout. Four fifths rather than a half because the
 *   four shipped colourways put it there: measured, their secondaries run 80–87%
 *   of the primary's. A quiet member is a different palette, not this one.
 * - **complement** is the answer from across the wheel, at its own peak because
 *   it and the primary are a pair. This is the one that used to be synthesised:
 *   every generator's second colour was `vec3(1.0) - uColor`, an arithmetic
 *   opposite in no palette at all.
 * - **accent** is lifted well above its peak and takes all the colour left up
 *   there, because its job is the small mark seen against everything else — a
 *   spark, a sweep head. Lightness is what separates it from the loud pair.
 * - **chalk** is the primary drifted a little warm or cool, lifted to where a
 *   tint lives and held to a chroma that reads as *tinted* rather than pale. Not
 *   a near-white: enough colour to belong, light enough to read edges against.
 *   It is what a generator's hot half mixes toward.
 *
 * **Each role has a band its lightness must land in, and both ends earn their
 * keep.** The floor is the projector argument: a hue whose peak is darker than
 * it — the blues and violets, every time — is lifted and gives up some colour
 * for the privilege, because a cheap lamp has no black to work against and the
 * most vivid possible blue is the one nobody in the room can see. The ceiling is
 * the opposite failure and the one that is easy to miss: a green peaks at 0.86,
 * so lifting `secondary` and `accent` off *that* put them at 0.92 where there is
 * no colour left to take a fraction of, and both came back as pale mints
 * indistinguishable from the tint. A role that can turn into `chalk` for half
 * the wheel is not a role.
 *
 * **And not every palette is dealt at the same loudness.** One `charge` scales
 * all five together, so some libraries come out electric and some handsome, and
 * the members keep their relationship either way. It stays above 0.86 because
 * the floor of a colourway is still a colourway.
 */
export function palette(rng: Rng): string[] {
  const base = rng() * 360;
  const harmony = pick(rng, HARMONIES);
  const charge = between(rng, 0.86, 1);

  /** A hue placed in its band, and how much colour is available once it is. */
  const place = (hue: number, at: number, band: [number, number]) => {
    const l = Math.min(band[1], Math.max(band[0], at));
    return { l, hue, room: maxChroma(l, hue) };
  };

  const primary = place(base, cusp(base), [0.58, 0.9]);
  const loud = primary.room * between(rng, 0.92, 1) * charge;

  // **Measured against what the primary actually got, not against its own hue's
  // ceiling**, and that distinction is the difference between a palette that
  // leads and one that argues with itself. How much colour a hue can hold varies
  // enormously round the wheel, so a blue primary — floored up to 0.58 for the
  // projector, where blue holds little — next to a magenta secondary taking four
  // fifths of magenta's far larger ceiling gives a *secondary that shouts louder
  // than the base*. Capping against the primary's own chroma makes the
  // relationship hold for every pairing rather than most of them.
  const secondHue = base + harmony.secondary;
  const second = place(secondHue, lifted(secondHue, 0.88), [0.62, 0.86]);
  const quieter = Math.min(second.room, loud * between(rng, 0.72, 0.88));

  const oppositeHue = base + harmony.complement;
  const opposite = place(oppositeHue, cusp(oppositeHue), [0.58, 0.9]);
  // Lifted until it has given up a quarter of its colour, which is a real lift
  // at every hue and a ruinous one at none.
  const markHue = base + harmony.accent;
  const mark = place(markHue, lifted(markHue, 0.74), [0.7, 0.9]);

  // In role order, which is the order the array is read in everywhere else.
  return [
    hex(primary.l, loud, primary.hue),
    hex(second.l, quieter, second.hue),
    // Its own peak rather than the primary's chroma: these two are a pair, and
    // an answer from across the wheel that came back quieter than the question
    // is not an answer.
    hex(opposite.l, opposite.room * between(rng, 0.92, 1) * charge, opposite.hue),
    hex(mark.l, mark.room * between(rng, 0.88, 1) * charge, mark.hue),
    // Held below the quietest of the other four rather than just at a low
    // number. Chalk is *defined* as the tint, so being the least colourful thing
    // in the palette is the property, not a coincidence of the ranges — and it
    // stopped being one the moment an amber accent lifted itself down to a
    // chroma a cream could match.
    hex(
      between(rng, 0.9, 0.95),
      Math.min(
        between(rng, 0.045, 0.08) * charge,
        Math.min(loud, quieter, opposite.room, mark.room) * 0.6,
      ),
      base + between(rng, -20, 20),
    ),
  ];
}

/**
 * The `lens` modes the randomiser wires, and the inlet each one drives.
 *
 * This was a hand-written table of five node kinds, because the five geometry
 * kinds were five kinds with five different inlet names and nothing in the
 * vocabulary said they were a set. They are one node's modes now, so what is
 * left here is only the part the randomiser actually needs: which number to reach for.
 */
/**
 * The lens modes the randomiser may reach for, which is every one but `creep`.
 *
 * `creep` is a zoom per *second* and only means anything when its result is fed
 * back into the picture it came from — under a `last`, where the frames
 * compound. The randomiser never wires one, so a randomised `creep` is a lens that moves the
 * point by a fraction of a percent and nothing else: a dead node on the canvas
 * wearing a real name. Excluded here rather than in the vocabulary, because the
 * mode is not the problem; dealing it into a graph with no feedback in it is.
 */
const RANDOM_LENS_MODES: readonly string[] = LENS_MODES.filter((mode) => mode !== 'creep');

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

/** The number a randomised `grade` drives, one per mode. */
const GRADE_VALUE: Record<string, string> = {
  levels: 'gain',
  hue: 'shift',
  posterize: 'steps',
  invert: 'hold',
};

/** The number a randomised `field` drives, one per mode. */
const FIELD_VALUE: Record<string, string> = {
  cells: 'weave',
  clouds: 'weave',
  metaballs: 'balls',
};

/**
 * The number a randomised `fractal` drives — the one that is *always* visible.
 * Never `zoom`: a meter resting near zero parks it at one end of its range,
 * and a parked zoom is a flat frame of fractal interior.
 */
const FRACTAL_VALUE: Record<string, string> = {
  mandelbrot: 'turn',
  julia: 'shape',
};

/**
 * The lights the randomiser may hang, and the two numbers that shape each one.
 *
 * `caustics` has no `from` — sunlight through water arrives from everywhere —
 * so it is the one light the randomiser never gives a `place`.
 */
const LIGHT_VALUE: Record<string, [string, string]> = {
  lamp: ['carry', 'soft'],
  beam: ['aim', 'spread'],
  shafts: ['blades', 'haze'],
  caustics: ['weave', 'glint'],
};

/** The number a randomised `spread` drives, one per mode. */
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
 * Everything the randomiser may wire blind, which is everything that is not `spread`.
 *
 * It used to be `EFFECTS` minus a hand-maintained list of the four that read
 * their input several times, kept by name and by hand because nesting two of
 * them multiplies the shader — it would stack three and hand the driver
 * something that takes a second to compile. **`spread` is that list now**, so
 * there is nothing to keep: the randomiser reaches for `lens` and `grade` and the rule
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
export function randomizeCircuit(rng: Rng): Circuit {
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
    const draw = rng();
    if (draw < 0.3 && values < 4) {
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
    if (draw < 0.5) {
      // An envelope rather than a bare meter, because a picture driven by the
      // raw meter twitches and one driven by an envelope breathes — and
      // breathing is what makes a randomised flow read designed.
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
    if (draw < 0.72) {
      const from = add({ kind: 'playback', op: pick(rng, SIGNALS), x, y });
      wire(`${from}/n`, into);
      return;
    }
    if (draw < 0.8) {
      // A song fact: steady through a song, different in the next one, which
      // is a kind of motion no meter can supply.
      const from = add({ kind: 'song', op: chance(rng, 0.6) ? 'key' : 'section', x, y });
      wire(`${from}/n`, into);
      return;
    }
    if (draw < 0.92) {
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
    for (const op of shuffled(rng, [...RANDOM_LENS_MODES]).slice(0, steps)) {
      const x = at();
      const node = add({ kind: 'lens', op, x, y: 20 });
      wire(carry, `${node}/p`);
      drive(x, 210 + (next % 2) * 150, `${node}/${LENS_VALUE[op]}`);
      carry = `${node}/p`;
    }
    return carry;
  };

  /** The Live set more often than not: a randomised screensaver is not this rig. */
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
      const node = add({ kind: 'lens', op: pick(rng, RANDOM_LENS_MODES), x: at(), y: 20 });
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
              kind: 'colorway',
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
      const node = add({ kind: 'lens', op: pick(rng, RANDOM_LENS_MODES), x: at(), y: 20 });
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
    const node = add({ kind: 'lens', op: pick(rng, RANDOM_LENS_MODES), x: at(), y: 20 });
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

// --- the randomiser ------------------------------------------------------

/**
 * Which part of the library a randomise is allowed to touch.
 *
 * All-or-nothing is the wrong shape for how this gets used: by the second
 * evening the colourways are the part you have settled and the flows are the
 * part you are still fishing for, and a button that deals both is a button you
 * stop pressing.
 */
export type RandomPart = 'colours' | 'flows' | 'rotation';

export const RANDOM_PARTS: readonly RandomPart[] = ['colours', 'flows', 'rotation'];

/** What each part is, for a control that has one line to say it in. */
export const RANDOM_ABOUT: Record<RandomPart, string> = {
  colours: 'four fresh colourways: five each, two of them loud, one a tint',
  flows: 'four freshly wired flows, replacing the last four it wired',
  rotation: 'how often the wheel turns, and how fast the whole show moves',
};

/**
 * A library, from a seed and from whatever the set contains.
 *
 * **Every part is randomised and then only the wanted ones land.** Drawing from the
 * generator in the same order regardless of what is kept is what makes a seed
 * mean one show: keeping only the colours has to give the same colours randomising
 * everything would have, or a seed written on a hand is worth nothing.
 *
 * Nothing about the songs is randomised. A song entry is an override now, and
 * randomising one would be the machine writing down an exception nobody asked for —
 * which is exactly the noise the cascade used to generate.
 */
export function randomizeScheme(
  seed: string,
  _show: Show,
  base: Scheme,
  parts: readonly RandomPart[] = RANDOM_PARTS,
): Scheme {
  const rng = seeded(seed);
  const randomising = (part: RandomPart) => parts.includes(part);

  // **The colourways that are already there, re-dealt in place.** This used to
  // invent four fresh names out of `WORDS` and drop whatever the library held,
  // which was wrong twice over: a scheme somebody had grown to eight came back
  // as four, and — the part that actually broke things — a song pins a colourway
  // **by name**, so every pin in the scheme was orphaned by every press of the
  // button. Nothing said so; the songs just quietly fell back to the default.
  //
  // Names are a person's, so the randomiser does not touch them. What it deals
  // is what is inside them.
  const names = Object.keys(base.colorways);
  const randomizedColorways: Record<string, string[]> = {};
  for (const name of (names.length > 0 ? names : shuffled(rng, WORDS).slice(0, 4)))
    randomizedColorways[name] = palette(rng);
  const colorways = randomising('colours') ? randomizedColorways : base.colorways;

  const flows: Scheme['flows'] = { ...base.flows };
  if (randomising('flows')) {
    // Only what a previous randomise wired. A flow someone built by hand is work
    // rather than scaffolding, and deleting it as a side effect of this button
    // is not something one level of undo makes acceptable.
    for (const [id, def] of Object.entries(flows)) if (def.randomized) delete flows[id];
  }
  const wired: string[] = [];
  for (let i = 0; i < 4; i++) {
    const id = `random${i + 1}`;
    const [a, b] = shuffled(rng, WORDS);
    const circuit = randomizeCircuit(rng);
    if (!randomising('flows')) continue;
    flows[id] = { name: `${a[0].toUpperCase()}${a.slice(1)} ${b}`, circuit, randomized: true };
    wired.push(id);
  }

  const bars = pick(rng, [4, 8, 8, 16]);
  const rotation: Scheme['rotation'] = {
    // Emptied rather than filled: an empty pool means "everything there is",
    // which is what you want the moment after a randomise has just made four things.
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
    rotation: randomising('rotation') ? rotation : base.rotation,
    songs: base.songs,
    defaults: {
      ...base.defaults,
      // A fallback that names something that exists, whichever way round the
      // parts were randomised.
      colorway: colorways[base.defaults.colorway]
        ? base.defaults.colorway
        : (Object.keys(colorways)[0] ?? base.defaults.colorway),
      flow: flows[base.defaults.flow]
        ? base.defaults.flow
        : (wired[0] ?? Object.keys(flows)[0] ?? base.defaults.flow),
      pace: randomising('rotation') ? pace : base.defaults.pace,
    },
  };
}

export { WORDS };
