import { FAMILIES, familyOf } from './hints.ts';
import type {
  Blend,
  Circuit,
  CircuitNode,
  LayerSpec,
  Scheme,
  Show,
  SourceKind,
} from './protocol.ts';
import { BLENDS, SOURCE_KINDS } from './protocol.ts';

/**
 * A whole show, rolled.
 *
 * Not a scatter of random numbers over a scheme. A random show is easy and
 * always looks like noise; what makes a rolled one *look like a show* is that
 * the constraints a hand-made scheme obeys are still obeyed:
 *
 * - **One source per family, not per track.** Every arp in the set draws the
 *   same way, because four arps scattered across four unrelated sources read as
 *   four unrelated things when they are one family. The families come from the
 *   same name hints the resolver falls back to, which is why they live in
 *   `hints.ts` rather than in `server/`.
 * - **A song keeps its shape.** An intro is quieter than its chorus in every
 *   roll, because the energies are drawn from a range per role rather than from
 *   nothing. What varies is where in that range, and how far apart.
 * - **Colours are a harmony, not five random hues.** A base hue and one of five
 *   relationships to it, kept light enough to survive a projector — a cheap lamp
 *   has no black to work against, so a dark colourway is a dark screen.
 *
 * Deterministic in its seed, which is the whole reason there is a seed: undo
 * covers the roll you just did, and a seed covers the one from last Tuesday that
 * you should not have rolled away.
 */

/** xmur3 into mulberry32: short, fast, and identical everywhere it runs. */
function seeded(seed: string): () => number {
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
 * Five colours in one relationship, with one of them near white.
 *
 * The near-white is not decoration. Layers take a colour by depth, so a stack of
 * five saturated hues has nothing in it to read edges against; one light member
 * is what stops a busy frame turning to mud on a wall.
 */
const HARMONIES: readonly (readonly number[])[] = [
  [0, 22, 44, 14, 32], // analogous
  [0, 120, 240, 60, 300], // triadic
  [0, 180, 15, 195, 165], // complementary
  [0, 150, 210, 30, 180], // split complement
  [0, 6, 350, 12, 344], // near mono
];

function palette(rng: Rng): string[] {
  const base = rng() * 360;
  const harmony = pick(rng, HARMONIES);
  const light = Math.floor(rng() * harmony.length);
  return harmony.map((offset, i) =>
    i === light
      ? hex(base + offset, between(rng, 0.1, 0.3), between(rng, 0.86, 0.95))
      : hex(base + offset, between(rng, 0.62, 1), between(rng, 0.48, 0.7)),
  );
}

/**
 * How loud a section is allowed to be.
 *
 * The shape of a song is not up for grabs. A roll that made an intro louder than
 * its chorus would not be a different show, it would be a broken one — so what
 * varies is where in the range each lands, not the ordering between them.
 *
 * **The four that are actually ordered have disjoint bands**, and that is the
 * whole mechanism: `INTRO < VERSE < BUILD < CHORUS` holds for every seed because
 * the ranges cannot reach each other. Ranges that merely *tended* the right way
 * put an intro above a verse about one roll in thirty, which is exactly often
 * enough to happen on stage and never while you are looking. The rest —
 * a bridge, a jam, an ending — are not in that chain and may overlap freely,
 * because nothing says a bridge is louder than a verse.
 *
 * A role nobody here knows about gets the widest range there is.
 */
const SHAPE: Record<string, readonly [number, number]> = {
  PRACTICE: [0.05, 0.22],
  INTRO: [0.1, 0.24],
  VERSE: [0.26, 0.46],
  BUILD: [0.52, 0.74],
  CHORUS: [0.8, 1],
  ENDING: [0.16, 0.38],
  BRIDGE: [0.34, 0.58],
  JAM1: [0.58, 0.84],
  JAM2: [0.62, 0.9],
};

/** Sources a percussive family can wear, and ones a wash can. */
const PERCUSSIVE: readonly SourceKind[] = ['strobe', 'sparks', 'scan', 'bars', 'grid'];
const WASH: readonly SourceKind[] = ['plasma', 'noise', 'solid', 'tunnel'];

// --- circuits ------------------------------------------------------------

/** The geometry nodes a roll wires, and the inlet each one drives. */
const GEOMETRY: readonly (readonly [CircuitNode['kind'], string])[] = [
  ['fold', 'sides'],
  ['swirl', 'turn'],
  ['zoom', 'by'],
  ['wobble', 'amount'],
  ['tile', 'count'],
];

const SIGNALS = ['level', 'energy', 'beat', 'phase', 'pulse'] as const;
const WAVES = ['sine', 'saw', 'ramp', 'pulse'] as const;

/**
 * A circuit that always compiles and usually looks like something.
 *
 * A random walk over the whole vocabulary produces garbage nine times in ten.
 * This walks a **shape** instead — a point, a few things done to it, a sample,
 * a few things done to the colour — and randomises what fills each slot. The
 * shape is the part that makes it an effect; the fill is the part that makes it
 * a different one every time.
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

  let knobs = 0;
  /** Whatever drives a geometry node's amount: a knob, a meter, or a shape on one. */
  const drive = (x: number, y: number, into: string) => {
    const roll = rng();
    if (roll < 0.4 && knobs < 4) {
      knobs += 1;
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
    if (roll < 0.75) {
      const from = add({ kind: 'signal', op: pick(rng, SIGNALS), x, y });
      wire(`${from}/n`, into);
      return;
    }
    const source = add({ kind: 'signal', op: pick(rng, SIGNALS), x: x - 150, y });
    const shape = add({ kind: 'wave', op: pick(rng, WAVES), x, y });
    wire(`${source}/n`, `${shape}/phase`);
    wire(`${shape}/n`, into);
  };

  let column = 0;
  const at = () => 20 + column++ * 155;

  let carry = `${add({ kind: 'point', x: at(), y: 20 })}/p`;
  const steps = 1 + Math.floor(rng() * 3);
  for (const [kind, inlet] of shuffled(rng, GEOMETRY).slice(0, steps)) {
    const x = at();
    const node = add({ kind, x, y: 20 });
    wire(carry, `${node}/p`);
    drive(x, 150 + (next % 2) * 120, `${node}/${inlet}`);
    carry = `${node}/p`;
  }

  const sample = add({ kind: 'sample', x: at(), y: 20 });
  wire(carry, `${sample}/p`);
  carry = `${sample}/c`;

  if (chance(rng, 0.55)) {
    const x = at();
    const node = add({ kind: 'hue', x, y: 20 });
    wire(carry, `${node}/c`);
    drive(x, 150, `${node}/shift`);
    carry = `${node}/c`;
  }
  if (chance(rng, 0.4)) {
    const x = at();
    const node = add({ kind: 'levels', x, y: 20 });
    wire(carry, `${node}/c`);
    drive(x, 150, `${node}/gain`);
    carry = `${node}/c`;
  }

  const out = add({ kind: 'out', x: at(), y: 20 });
  wire(carry, `${out}/c`);
  return { nodes, cords };
}

// --- the roll ------------------------------------------------------------

/**
 * A whole new scheme, from a seed and whatever the set actually contains.
 *
 * Everything it names comes from the set — its songs, its roles, its tracks — so
 * a rolled scheme is one the editor can show you and you can then take apart.
 * Nothing here is hidden state: the result is an ordinary scheme, written to
 * `scheme.json` like any other, and the seed is the only thing that remembers
 * where it came from.
 */
export function rollScheme(seed: string, show: Show, base: Scheme): Scheme {
  const rng = seeded(seed);

  const names = shuffled(rng, WORDS).slice(0, 4);
  const colorways: Record<string, string[]> = {};
  for (const name of names) colorways[name] = palette(rng);

  // Spread rather than scattered: a shuffled cycle gives every colourway roughly
  // the same number of songs, where independent picks would leave one unused and
  // another on half the set.
  const wheel = shuffled(rng, names);
  const songs: Scheme['songs'] = {};
  show.songs.forEach((song, i) => {
    songs[song] = { colorway: wheel[i % wheel.length] };
    if (chance(rng, 0.35)) songs[song].bias = round2(between(rng, -0.12, 0.14));
  });

  const effects: Scheme['effects'] = { ...base.effects };
  // Anything rolled last time goes, or a roll a week in would be forty effects
  // deep and every archetype would be pointing at a ghost.
  for (const [id, def] of Object.entries(effects)) if (def.circuit) delete effects[id];
  const wired: string[] = [];
  for (let i = 0; i < 2; i++) {
    const id = `roll${i + 1}`;
    const [a, b] = shuffled(rng, WORDS);
    effects[id] = {
      name: `${a[0].toUpperCase()}${a.slice(1)} ${b}`,
      circuit: rollCircuit(rng),
    };
    wired.push(id);
  }

  const pool = [...Object.keys(effects)];
  const roles = [...new Set([...show.roles, ...Object.keys(base.archetypes)])].sort();
  const archetypes: Scheme['archetypes'] = {};
  for (const role of roles) {
    const [lo, hi] = SHAPE[role] ?? [0.3, 0.8];
    const energy = round2(between(rng, lo, hi));
    // A loud section reaches for more, which is the additive half of the cascade
    // doing what it is for rather than a rule about randomness.
    const count = energy > 0.7 ? 1 + Math.floor(rng() * 2) : rng() < energy + 0.3 ? 1 : 0;
    archetypes[role] = { energy, effects: shuffled(rng, pool).slice(0, count) };
  }

  const sources = shuffled(rng, SOURCE_KINDS);
  const byFamily: Record<string, SourceKind> = {};
  for (const family of FAMILIES) {
    const wanted =
      family === 'drums' ? PERCUSSIVE : family === 'pad' ? WASH : SOURCE_KINDS;
    // Prefer one nothing else took, so a five-track set is five different
    // pictures rather than the same one drawn five times.
    byFamily[family] = sources.find((s) => wanted.includes(s)) ?? pick(rng, wanted);
    const at = sources.indexOf(byFamily[family]);
    if (at >= 0) sources.splice(at, 1);
  }

  const layers: Scheme['layers'] = {};
  for (const layer of show.layers) {
    const spec: LayerSpec = { source: byFamily[familyOf(layer.name)] };
    if (chance(rng, 0.4)) spec.blend = pick(rng, BLENDS);
    if (chance(rng, 0.5)) spec.bias = round2(between(rng, -0.18, 0.18));
    if (chance(rng, 0.3)) spec.effects = [pick(rng, pool)];
    layers[layer.name] = spec;
  }

  // `over` first, because something at the bottom of the stack has to be opaque.
  const blend: Blend[] = ['over', ...shuffled(rng, BLENDS)];

  return {
    seed,
    colorways,
    songs,
    archetypes,
    layers,
    clips: {},
    effects,
    defaults: {
      colorway: pick(rng, names),
      energy: round2(between(rng, 0.32, 0.5)),
      blend,
      sources: shuffled(rng, SOURCE_KINDS),
      maxEffects: chance(rng, 0.35) ? 3 : 2,
    },
  };
}

export { WORDS };
