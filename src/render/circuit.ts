import {
  EFFECTS,
  MATH_OPS,
  PLAYBACK_NAMES,
  TRACK_READS,
  SONG_FACTS,
  SOURCES,
  TRACK_DRAWS,
  WAVE_SHAPES,
  type Circuit,
  type CircuitNode,
  type LookDef,
  type NodeKind,
} from '../../protocol.ts';
import { lookPreamble } from './shaders.ts';

/**
 * A look, compiled to a fragment shader.
 *
 * ## Three signals, and everything follows from them
 *
 * A **point** (`p`) is where in the frame you are looking. A **number** (`n`) is
 * anything scalar. A **colour** (`c`) is a premultiplied `vec4`. Having exactly
 * three types is what keeps the canvas legible: a cord's colour tells you what
 * it carries, and the editor refuses a cord it cannot type rather than inventing
 * a conversion.
 *
 * ## A colour is a function of a point, not a value
 *
 * This is the change that let the layer stack go away, and it is worth stating
 * plainly because it is unusual.
 *
 * The obvious way to build a node compositor is to give every colour node a
 * render target: draw node A into a texture, let node B sample it. That is what
 * the old renderer did with two ping-ponged buffers, and it is why an effect
 * could only ever work on "the frame that arrived" — a linear chain, because a
 * chain is all two buffers can express.
 *
 * Here a colour outlet compiles to an **expression evaluated at a point**, and
 * the point is threaded through resolution. So `kaleido` does not sample a
 * buffer; it asks its input for the colour at a *folded* point, and the input
 * re-evaluates itself there. Everything downstream of that composes for free:
 * two sources can be folded differently and blended, a look can be dropped
 * inside another look, and none of it needs a buffer.
 *
 * What it costs is honest and worth knowing: a **multi-tap** effect — `bloom`,
 * `smear`, `edge`, `shift` — evaluates its whole input once per tap. Nesting two
 * of them multiplies. `MAX_LINES` is the backstop, and it refuses by name rather
 * than handing the driver a shader that takes a second to compile.
 *
 * ## Numbers are 0–1
 *
 * Every number a node produces is 0–1 unless it is `beat` or `time`, and every
 * number a node consumes is read as 0–1 and mapped internally to whatever that
 * node's useful range is. Any outlet can go into any inlet and mean something,
 * so wiring a meter straight into a fold works without anyone having built a
 * scaling node first. The cost is that a node's internal range is its own
 * business; the alternative is a patch bay of converters, which is how these
 * things usually die.
 *
 * ## Unconnected inlets have answers, and a number inlet's answer is yours
 *
 * Every inlet has an answer, so a half-wired graph still compiles and still
 * draws. Building one of these means dropping a node, looking at what it did,
 * and wiring the next — a compiler that treated an unfinished graph as an error
 * would make the canvas unusable for exactly the way it gets used.
 *
 * For a **number** inlet that answer starts at the number in its `PortSpec` and
 * is then a knob on the node's face, held in `CircuitNode.knobs`. Wiring a knob
 * node into a `posterize` to set its one number was work nobody should have to
 * do, and the graph that came out said nothing that the number on the face does
 * not. What a set value must never be is *inlined*: it rides `uParams` like
 * every other knob, so turning it recompiles nothing.
 *
 * The exceptions are the two number inlets whose answer is already alive —
 * `energy` reads the room and a `wave`'s `phase` reads the beat. There is no
 * number to set there, only a signal to leave running or replace with a cord.
 */

/** Which of the three things a port carries. Surfaced as `data-kind` on the canvas. */
export type Signal = 'p' | 'n' | 'c';

export interface PortSpec {
  name: string;
  kind: Signal;
  /** The GLSL used when nothing is wired here and nothing is set. */
  fallback?: string;
  /**
   * The number this inlet holds when nothing is wired, and therefore the one a
   * knob on the node's face starts at.
   *
   * Present exactly when the inlet is **settable**. A point and a colour have
   * none — there is no one control for a position and no useful constant for a
   * picture — and neither have the two numbers whose answer is a live signal.
   */
  at?: number;
}

/** What a node's `emit` is handed. */
export interface Emitting {
  /** Resolve an inlet at the point this evaluation is happening at. */
  read(inlet: string): string;
  /** Resolve an inlet at some other point — how every geometry effect works. */
  readAt(inlet: string, at: string): string;
  /** The point expression this evaluation is happening at. */
  at: string;
  node: CircuitNode;
}

export interface NodeSpec {
  /** What it is called on the canvas. */
  name: string;
  /** One line, shown when the node is selected. */
  about: string;
  /**
   * The inlets, which for `source` and `effect` depend on the mode.
   *
   * A function rather than a list because a kaleidoscope's knobs are not a
   * ripple's, and giving every effect two inlets called `a` and `b` would make
   * the canvas unreadable to buy a simpler type here.
   */
  inlets: readonly PortSpec[] | ((node: CircuitNode) => readonly PortSpec[]);
  outlets: readonly PortSpec[];
  /** The modes this node has, if it has any. The first is the default. */
  ops?: readonly string[];
  /** True when the modes are names from the set rather than a fixed list. */
  named?: 'track' | 'look';
  emit(ctx: Emitting): Record<string, string>;
}

const P = (name: string, fallback?: string): PortSpec => ({ name, kind: 'p', fallback });
const C = (name: string, fallback = 'vec4(0.0)'): PortSpec => ({ name, kind: 'c', fallback });

/**
 * A settable number inlet, and the number it sits at until someone turns it.
 *
 * The fallback is that number as GLSL rather than a string written twice, so
 * the knob on the face and the constant in a shader with nothing set cannot
 * drift apart.
 */
const N = (name: string, at = 0.5): PortSpec => ({ name, kind: 'n', at, fallback: asFloat(at) });

/**
 * A number inlet whose unwired answer is a **signal** rather than a setting.
 *
 * There are two, and both are the reason this rig is not a screensaver:
 * `energy` reads the room and a `wave`'s `phase` reads the beat. Putting a knob
 * on either would offer to replace something already moving with a number that
 * is not, which is a worse default than the one it would be replacing — so
 * these are wired or left alone, and there is nothing on the face to turn.
 */
const ALIVE = (name: string, from: string): PortSpec => ({ name, kind: 'n', fallback: from });

/** Every effect gets one, so `rate` and `charge` have something to run on. */
const E = () => ALIVE('energy', 'uEnergy');

/** A number as GLSL. `1` has to be spelled `1.0` or the shader will not compile. */
const asFloat = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/**
 * The one port name the flattener writes and nobody types.
 *
 * A tilde, because a node id is `kind` plus a number and a port name comes off
 * a spec, so neither can ever collide with one. The canvas hides these; see
 * `look` below for the only one there is.
 */
export const INNER = '~inner';

const SIGNALS: Record<string, string> = {
  level: 'uLevel',
  beat: 'uBeat',
  phase: '(uPhase / uQuantum)',
  pulse: 'beatPulse(rate(uEnergy), uEnergy)',
  time: 'uTime',
  random: 'hash(vec2(uSeed, floor(uBeat)))',
};

const FACTS: Record<string, string> = {
  seed: 'uSongSeed',
  tempo: 'clamp(uSongTempo / 200.0, 0.0, 1.0)',
  // Already a pitch class over twelve when it reaches the uniform — a key is a
  // name on the wire and the reading of it belongs where the set is read.
  key: 'uSongKey',
  section: 'uSection',
  sections: 'uSections',
};

const MATH: Record<string, (a: string, b: string) => string> = {
  add: (a, b) => `clamp(${a} + ${b}, 0.0, 1.0)`,
  subtract: (a, b) => `clamp(${a} - ${b}, 0.0, 1.0)`,
  multiply: (a, b) => `(${a} * ${b})`,
  min: (a, b) => `min(${a}, ${b})`,
  max: (a, b) => `max(${a}, ${b})`,
  average: (a, b) => `((${a} + ${b}) * 0.5)`,
};

const WAVES: Record<string, (x: string) => string> = {
  sine: (x) => `(sin(${x} * 6.28318) * 0.5 + 0.5)`,
  saw: (x) => `fract(${x})`,
  ramp: (x) => `(1.0 - fract(${x}))`,
  square: (x) => `step(0.5, fract(${x}))`,
  pulse: (x) => `pow(1.0 - fract(${x}), 4.0)`,
  noise: (x) => `noise(vec2(${x}, ${x} * 0.37))`,
};

/**
 * Base first, top second — the order two things stack in.
 *
 * One `blendFunc` each, written out. These are the same four the track pass gets
 * from fixed-function blending, and they have to *stay* the same four: a `blend`
 * node that disagreed with how the set stacks would mean two answers to how two
 * pictures combine, which is the thing the graph exists to have one of.
 *
 * All four are on **premultiplied** colour, which is why `multiply` is not a
 * multiply. `a * b` alone multiplies the coverages as well as the colours, so a
 * top that was half transparent — or, worse, an inlet nobody has wired yet, which
 * is `vec4(0.0)` — took the base out entirely. That looked exactly like a node
 * that had come unhooked, and it was the one mode where an unwired inlet was not
 * a no-op. `DST_COLOR, ONE_MINUS_SRC_ALPHA` is the shape that behaves.
 */
const MIXES: Record<string, (a: string, b: string) => string> = {
  over: (a, b) => `(${b} + ${a} * (1.0 - ${b}.a))`,
  add: (a, b) => `(${a} + ${b})`,
  screen: (a, b) => `(${a} + ${b} - ${a} * ${b})`,
  multiply: (a, b) => `(${a} * ${b} + ${a} * (1.0 - ${b}.a))`,
};

/**
 * What each effect mode takes beyond its picture and its energy.
 *
 * The names are what appear on the faceplate, so they are the vocabulary
 * somebody reads the canvas in. They stay the ones the handwritten shaders used.
 */
/**
 * Which effect a node is, given whatever its `op` says.
 *
 * One reading, used by both the inlets and the emit. They used to answer this
 * differently — the inlets took `op` at its word and the emit fell back to the
 * first effect — so a mode nobody recognises, which is a thing a hand-edited
 * file can say, produced a node with no knob inlets at all whose shader was
 * calling for knobs that were therefore always zero.
 */
const effectOp = (node: CircuitNode): string =>
  EFFECTS.includes(node.op ?? '') ? node.op! : EFFECTS[0];

const EFFECT_KNOBS: Record<string, string[]> = {
  mirror: ['line', 'angle'],
  kaleido: ['segments', 'spin'],
  shift: ['spread', 'drive'],
  pixelate: ['blocks', 'resolve'],
  ripple: ['waves', 'depth', 'speed'],
  smear: ['reach', 'drive'],
  bloom: ['reach', 'floor'],
  slice: ['bands', 'throw'],
  edge: ['width', 'gain'],
  posterize: ['levels'],
  twist: ['turn', 'sway'],
  invert: ['hold', 'rate'],
};

/**
 * How each effect reads its input.
 *
 * Three shapes, and the difference between them is exactly what a graph makes
 * visible. A **remap** reads once at a moved point and costs nothing. A
 * **colour** operation reads once where it already was. A **tap** reads several
 * times, and is the only thing here that can make a shader expensive.
 */
const EFFECT_EMIT: Record<string, (ctx: Emitting, e: string, k: (i: number) => string) => string> =
  {
    mirror: (c, _e, k) => c.readAt('c', `fxMirror(${c.at}, ${k(0)}, ${k(1)})`),
    kaleido: (c, e, k) => c.readAt('c', `fxKaleido(${c.at}, ${k(0)}, ${k(1)}, ${e})`),
    pixelate: (c, e, k) => c.readAt('c', `fxPixelate(${c.at}, ${k(0)}, ${k(1)}, ${e})`),
    ripple: (c, e, k) => c.readAt('c', `fxRipple(${c.at}, ${k(0)}, ${k(1)}, ${k(2)}, ${e})`),
    slice: (c, e, k) => c.readAt('c', `fxSlice(${c.at}, ${k(0)}, ${k(1)}, ${e})`),
    twist: (c, e, k) => c.readAt('c', `fxTwist(${c.at}, ${k(0)}, ${k(1)}, ${e})`),

    posterize: (c, _e, k) => `fxPosterize(${c.read('c')}, ${k(0)})`,
    invert: (c, e, k) => `fxInvert(${c.read('c')}, ${k(0)}, ${k(1)}, ${e})`,

    // Channel separation that opens with the level, so it bites on transients
    // and closes to nothing in the gaps. Three taps, one per channel.
    shift: (c, e, k) => {
      const d = `(${k(0)} * 0.03 * (0.25 + uLevel * ${k(1)} * 2.0) * mix(0.5, 2.0, ${e}))`;
      const step = `vec2(${d} * uRes.x / uRes.y, 0.0)`;
      const mid = c.read('c');
      const lo = c.readAt('c', `(${c.at} + ${step})`);
      const hi = c.readAt('c', `(${c.at} - ${step})`);
      return `vec4(${lo}.r, ${mid}.g, ${hi}.b, ${mid}.a)`;
    },

    // A short radial blur toward the centre. Softens a picture into whatever it
    // is over, which is what makes it the opposite of ripple.
    smear: (c, _e, k) => {
      const reach = `(${k(0)} * (0.03 + uLevel * ${k(1)} * 0.12))`;
      const taps = [0, 1, 2, 3, 4, 5].map((i) =>
        c.readAt('c', `(${c.at} - ${c.at} * ${reach} * ${(i / 6).toFixed(4)})`),
      );
      return `((${taps.join(' + ')}) / 6.0)`;
    },

    // Eight taps on a ring, and only what is already bright gets added back.
    // The cheapest thing that makes a projector look like it cost more than it
    // did: a cheap lamp has no contrast to spare, so highlights must be built.
    bloom: (c, e, k) => {
      const reach = `((0.003 + ${k(0)} * 0.022) * (0.6 + uLevel * 0.8))`;
      const taps = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
        const a = ((i * Math.PI) / 4).toFixed(4);
        return c.readAt('c', `(${c.at} + vec2(cos(${a}), sin(${a})) * ${reach})`);
      });
      return `(${c.read('c')} + max((${taps.join(' + ')}) / 8.0 - vec4(${k(1)}), vec4(0.0)) * mix(0.4, 1.1, ${e}))`;
    },

    // Difference across a pixel, both ways. Throws away the fill and keeps the
    // outline, which turns any picture into a diagram — the one effect here that
    // makes a busy frame *less* busy.
    edge: (c, _e, k) => {
      // A fraction of the frame's height, and **not** a count of pixels.
      //
      // It was pixels, which is what an edge detector normally wants and is
      // wrong here: this rig is authored on a 320-pixel node face, judged on an
      // 800-pixel bench and projected at 1920, and a tap of one output pixel is
      // three different thicknesses in those three places. So the one node you
      // could not trust a preview of was the one whose whole job is a line.
      //
      // In plane units the bench predicts the wall exactly and a face is the
      // same picture with less of it, which is the trade everything else here
      // already makes. The same number in both directions, because centring is
      // what makes a circle round and therefore makes a step square — the
      // aspect belongs to the *uv* form of this, and carrying it across as well
      // stretched the horizontal difference and gave every outline a sideways
      // smear that looked like the effect was reading the wrong picture.
      const px = `(0.0012 + ${k(0)} * 0.006)`;
      const x = `vec2(${px}, 0.0)`;
      const y = `vec2(0.0, ${px})`;
      const h = `abs(${c.readAt('c', `(${c.at} + ${x})`)}.rgb - ${c.readAt('c', `(${c.at} - ${x})`)}.rgb)`;
      const v = `abs(${c.readAt('c', `(${c.at} + ${y})`)}.rgb - ${c.readAt('c', `(${c.at} - ${y})`)}.rgb)`;
      const m = `clamp(length(${h} + ${v}) * mix(1.5, 6.0, ${k(1)}), 0.0, 1.0)`;
      return `vec4(mix(uColor, vec3(1.0), 0.45) * ${m}, ${m})`;
    },
  };

export const NODE_SPECS: Record<NodeKind, NodeSpec> = {
  point: {
    name: 'point',
    about: 'Where this fragment is being read: zero in the middle, a circle round.',
    inlets: [],
    outlets: [P('p')],
    // Not `centred()`. It is wherever the thing downstream is *asking* about,
    // which is what lets an effect move a whole subgraph rather than itself.
    emit: (c) => ({ p: c.at }),
  },

  playback: {
    name: 'playback',
    about: 'Where the music is right now. The reason any of this moves.',
    inlets: [],
    outlets: [N('n')],
    ops: PLAYBACK_NAMES,
    emit: (c) => ({ n: SIGNALS[c.node.op ?? 'level'] ?? 'uLevel' }),
  },

  value: {
    name: 'value',
    about: 'One number, in every place you wire it. An inlet on its own has its own knob.',
    inlets: [],
    outlets: [N('n')],
    // The index is assigned by the compiler, which is the only thing that knows
    // how many knobs came before this one.
    emit: () => ({ n: 'uParams[0]' }),
  },

  track: {
    name: 'track',
    about: 'One track in the set: pick which, and which of its numbers. Named, so a rename breaks it.',
    inlets: [],
    outlets: [N('n')],
    ops: TRACK_READS,
    named: 'track',
    // The slot is assigned by the compiler; what goes *in* it is decided on the
    // CPU, because the smoothing is an envelope follower and one of those has
    // to remember what it saw last frame. See `feed.ts`.
    emit: () => ({ n: 'uTracks[0]' }),
  },

  song: {
    name: 'song',
    about: 'Facts about the song that is playing. `seed` is a different number per song.',
    inlets: [],
    outlets: [N('n')],
    ops: SONG_FACTS,
    emit: (c) => ({ n: FACTS[c.node.op ?? 'seed'] ?? 'uSongSeed' }),
  },

  source: {
    name: 'source',
    about: 'One of the pictures that ship, drawn wherever you point it.',
    inlets: [P('p'), E()],
    outlets: [C('c')],
    ops: SOURCES,
    emit: (c) => ({
      c: `laid(gen_${SOURCES.includes(c.node.op ?? '') ? c.node.op : SOURCES[0]}(${c.read('p')}, ${c.read('energy')}), ${c.read('energy')})`,
    }),
  },

  tracks: {
    name: 'tracks',
    about: 'The Live set itself: every playing track, drawn and mixed. Fire a scene, it changes.',
    inlets: [P('p')],
    outlets: [C('c')],
    ops: TRACK_DRAWS,
    // A pass rather than an expression — see `shaders.ts`. All this does is
    // read the picture that pass left.
    emit: (c) => ({ c: `fromTracks(${c.read('p')})` }),
  },

  look: {
    name: 'look',
    about: 'Another look, whole, as one node. This is where it gets complicated.',
    // `INNER` is the flattener's inlet, never a person's: `flatten` wires the
    // graph this node names into it, and the canvas hides any port whose name
    // starts with a tilde. It has to be a real inlet rather than a lookup on
    // the side, because reading it is how the point wired into `p` gets to act
    // on the whole sub-graph — without it the `p` cord was drawn and then
    // silently ignored, which is the worst thing a canvas can do.
    inlets: [P('p'), C(INNER)],
    outlets: [C('c')],
    named: 'look',
    // The whole node, and it is one line: read that graph, over there. An
    // unwired `p` falls back to the point being asked about, which is what
    // makes a nested look with nothing wired into it behave exactly as if its
    // nodes had been pasted in.
    emit: (c) => ({ c: c.readAt(INNER, c.read('p')) }),
  },

  paint: {
    name: 'paint',
    about: "The colourway's own colour, at a brightness. How a number becomes a picture.",
    inlets: [N('amount'), E()],
    outlets: [C('c')],
    emit: (c) => ({
      c: `vec4(charge(uColor, ${c.read('energy')}) * clamp(${c.read('amount')}, 0.0, 1.0), clamp(${c.read('amount')}, 0.0, 1.0))`,
    }),
  },

  fold: {
    name: 'fold',
    about: 'Mirror the frame into wedges around the centre. A kaleidoscope.',
    inlets: [P('p'), N('sides', 0.2)],
    outlets: [P('p')],
    emit: (c) => ({ p: `cFold(${c.read('p')}, ${c.read('sides')})` }),
  },

  swirl: {
    name: 'swirl',
    about: 'Rotate by more the further out you are. Twists the frame.',
    inlets: [P('p'), N('turn')],
    outlets: [P('p')],
    emit: (c) => ({ p: `cSwirl(${c.read('p')}, ${c.read('turn')})` }),
  },

  zoom: {
    name: 'zoom',
    about: 'Push in or pull out. A half is life size.',
    inlets: [P('p'), N('by')],
    outlets: [P('p')],
    emit: (c) => ({ p: `cZoom(${c.read('p')}, ${c.read('by')})` }),
  },

  wobble: {
    name: 'wobble',
    about: 'Displace on a sine that runs on the beat.',
    inlets: [P('p'), N('amount', 0.3)],
    outlets: [P('p')],
    emit: (c) => ({ p: `cWobble(${c.read('p')}, ${c.read('amount')})` }),
  },

  tile: {
    name: 'tile',
    about: 'Repeat the frame in a grid.',
    inlets: [P('p'), N('count', 0.3)],
    outlets: [P('p')],
    emit: (c) => ({ p: `cTile(${c.read('p')}, ${c.read('count')})` }),
  },

  polar: {
    name: 'polar',
    about: 'A point as distance from the centre and angle around it.',
    inlets: [P('p')],
    outlets: [N('radius'), N('angle')],
    emit: (c) => ({
      radius: `clamp(length(${c.read('p')}) * 1.6, 0.0, 1.0)`,
      angle: `(atan(${c.read('p')}.y, ${c.read('p')}.x) / 6.28318 + 0.5)`,
    }),
  },

  effect: {
    name: 'effect',
    about: 'One of the effects that ship, worked on the picture wired into it.',
    inlets: (node) => [C('c'), E(), ...EFFECT_KNOBS[effectOp(node)].map((name) => N(name))],
    outlets: [C('c')],
    ops: EFFECTS,
    emit: (c) => {
      const op = effectOp(c.node);
      const knobs = EFFECT_KNOBS[op];
      return { c: EFFECT_EMIT[op](c, c.read('energy'), (i) => c.read(knobs[i] ?? 'energy')) };
    },
  },

  hue: {
    name: 'hue',
    about: 'Rotate the colour without touching the shape.',
    inlets: [C('c'), N('shift')],
    outlets: [C('c')],
    emit: (c) => ({ c: `cHue(${c.read('c')}, ${c.read('shift')})` }),
  },

  levels: {
    name: 'levels',
    about: 'Contrast and brightness. A half of each is neutral.',
    inlets: [C('c'), N('gain'), N('lift')],
    outlets: [C('c')],
    emit: (c) => ({ c: `cLevels(${c.read('c')}, ${c.read('gain')}, ${c.read('lift')})` }),
  },

  blend: {
    name: 'blend',
    about: 'Two pictures into one. The mixer everything else used to be built out of.',
    inlets: [C('base'), C('top'), N('amount', 1)],
    outlets: [C('c')],
    ops: Object.keys(MIXES),
    emit: (c) => {
      const mix = MIXES[c.node.op ?? 'over'] ?? MIXES.over;
      return { c: `mix(${c.read('base')}, ${mix(c.read('base'), c.read('top'))}, ${c.read('amount')})` };
    },
  },

  math: {
    name: 'math',
    about: 'Arithmetic on two numbers.',
    inlets: [N('a'), N('b')],
    outlets: [N('n')],
    ops: MATH_OPS,
    emit: (c) => {
      const op = MATH[c.node.op ?? 'add'] ?? MATH.add;
      return { n: op(c.read('a'), c.read('b')) };
    },
  },

  wave: {
    name: 'wave',
    about: 'A shape over a phase. Wire the beat into it and it is in time.',
    inlets: [ALIVE('phase', 'uBeat')],
    outlets: [N('n')],
    ops: WAVE_SHAPES,
    emit: (c) => {
      const shape = WAVES[c.node.op ?? 'sine'] ?? WAVES.sine;
      return { n: shape(c.read('phase')) };
    },
  },

  out: {
    name: 'out',
    about: 'What leaves this look.',
    inlets: [C('c')],
    outlets: [],
    emit: () => ({}),
  },
};

/** A node's inlets, whichever way its spec declares them. */
export function inletsOf(node: CircuitNode): readonly PortSpec[] {
  const spec = NODE_SPECS[node.kind];
  return typeof spec.inlets === 'function' ? spec.inlets(node) : spec.inlets;
}

/**
 * The helper functions the node expressions call.
 *
 * Written once here rather than inlined per node, because several of them are
 * more than an expression and because a shader that reads like a shader is one
 * you can paste into a debugger.
 */
const HELPERS = `
vec2 cFold(vec2 p, float n) {
  float sides = 1.0 + floor(n * 11.0);
  float wedge = PI / sides;
  float a = abs(mod(atan(p.y, p.x), wedge * 2.0) - wedge);
  return vec2(cos(a), sin(a)) * length(p);
}

vec2 cSwirl(vec2 p, float n) {
  float a = (n - 0.5) * 12.56637 * length(p);
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c) * p;
}

vec2 cZoom(vec2 p, float n) {
  return p * exp2((0.5 - n) * 4.0);
}

vec2 cWobble(vec2 p, float n) {
  return p + vec2(sin(p.y * 9.0 + uBeat * PI), cos(p.x * 9.0 + uBeat * PI)) * n * 0.35;
}

vec2 cTile(vec2 p, float n) {
  float count = 1.0 + floor(n * 7.0);
  return fract(p * count + 0.5) - 0.5;
}

// Rotation about the grey axis: the short, correct hue shift. Undone and redone
// around the premultiply, or a translucent pixel rotates toward black.
vec4 cHue(vec4 c, float n) {
  float a = max(c.a, 1e-4);
  vec3 col = c.rgb / a;
  const vec3 k = vec3(0.57735027);
  float ang = (n - 0.5) * 6.28318;
  float co = cos(ang);
  vec3 shifted = col * co + cross(k, col) * sin(ang) + k * dot(k, col) * (1.0 - co);
  return vec4(clamp(shifted, 0.0, 1.0) * c.a, c.a);
}

vec4 cLevels(vec4 c, float gain, float lift) {
  float a = max(c.a, 1e-4);
  vec3 col = c.rgb / a;
  col = (col - 0.5) * exp2((gain - 0.5) * 3.0) + 0.5 + (lift - 0.5);
  return vec4(clamp(col, 0.0, 1.0) * c.a, c.a);
}
`;

/** GLSL types, by signal. */
const TYPES: Record<Signal, string> = { p: 'vec2', n: 'float', c: 'vec4' };

/**
 * One number riding the bank: a `value` node, or an inlet somebody set.
 *
 * Both are the same thing to the shader and to the cache — a float in
 * `uParams` that can be turned without recompiling — so they are one list and
 * one bank rather than two of each. What tells them apart is the `id`: a node
 * id for a `value` node, a `nodeId/inlet` address for an inlet's own knob.
 */
export interface CircuitKnob {
  id: string;
  label: string;
  /** Which slot of `uParams` it rides in. */
  index: number;
  value: number;
}

/** One `track` or `energy` node: what it names, and which slot it reads. */
export interface CircuitTrack {
  id: string;
  /** The exact track name, or `master`. Empty until someone picks one. */
  name: string;
  /** Which of the track's numbers — one of `TRACK_READS`. */
  read: string;
  index: number;
  /** How much of an envelope to put on it. Zero is the number itself. */
  smooth: number;
}

export interface Compiled {
  source: string | null;
  error: string | null;
  knobs: CircuitKnob[];
  tracks: CircuitTrack[];
  /** How each Live track should draw, if this look asked for the set at all. */
  draws: string | null;
}

/**
 * How many knobs one look may have.
 *
 * Not the size of the bank — the bank is cut to fit the graph, because the
 * shader is generated. This is the backstop, and what it is protecting is the
 * driver: a bank is a uniform array, a fragment shader has a floor on how many
 * uniform vectors it is guaranteed, and a float array is the packing that eats
 * them fastest. Sixty-four is far more knobs than a graph anyone can read has,
 * and well under what the smallest WebGL2 implementation promises.
 */
export const MAX_KNOBS = 64;

/** At most eight named tracks: the bank is a fixed-size uniform array. */
export const MAX_TRACKS = 8;

/**
 * How many GLSL statements a look may emit.
 *
 * The backstop on multi-tap nesting. A `bloom` over a `smear` evaluates its
 * input forty-eight times, and two more of those is a shader that takes a
 * second to compile and a frame to draw. Refusing by name is much kinder than
 * letting the driver stall — and the number is high enough that no sane graph
 * reaches it.
 */
export const MAX_LINES = 2000;

/** A port address, as cords name it. */
export function portId(node: string, port: string): string {
  return `${node}/${port}`;
}

export function splitPort(id: string): { node: string; port: string } {
  const at = id.lastIndexOf('/');
  return at < 0 ? { node: id, port: '' } : { node: id.slice(0, at), port: id.slice(at + 1) };
}

/** What a port carries, for a canvas that colours cords and refuses bad ones. */
export function signalOf(circuit: Circuit, id: string): Signal | null {
  const { node, port } = splitPort(id);
  const held = circuit.nodes.find((n) => n.id === node);
  if (!held) return null;
  const spec = NODE_SPECS[held.kind];
  const found =
    inletsOf(held).find((p) => p.name === port) ?? spec.outlets.find((p) => p.name === port);
  return found?.kind ?? null;
}

/**
 * Whether anything at all is wired to `out`.
 *
 * A look that has nothing on it compiles, and deliberately: it draws transparent
 * black, which is the state every graph passes through on the way to being one.
 * What was missing was **saying so**. A canvas full of nodes that produces a
 * black frame looks identical to a canvas full of nodes that produces a black
 * frame *because it is broken*, and the difference is one cord.
 *
 * A fact about the graph, so the sentence someone reads belongs to the canvas
 * rather than to the compiler.
 */
export function reachesOut(circuit: Circuit): boolean {
  const end = circuit.nodes.find((node) => node.kind === 'out');
  return !!end && circuit.cords.some((cord) => cord.to === portId(end.id, 'c'));
}

/**
 * Whether wiring this outlet into that inlet would make the graph eat itself.
 *
 * The same argument [`wouldLoop`](../../protocol.ts) makes about a look inside a
 * look, one level down. The compiler refuses a loop by name, but the honest
 * message it can give is about a node rather than about the cord you were
 * holding — and by then the whole look has gone black. Refusing at the moment of
 * dropping is a sentence about the thing just clicked.
 */
export function wouldFeedItself(circuit: Circuit, from: string, to: string): boolean {
  const start = splitPort(from).node;
  const target = splitPort(to).node;
  if (start === target) return true;
  const onward = new Map<string, string[]>();
  for (const cord of circuit.cords) {
    const at = splitPort(cord.from).node;
    onward.set(at, [...(onward.get(at) ?? []), splitPort(cord.to).node]);
  }
  const seen = new Set<string>();
  const walk = (at: string): boolean => {
    if (at === start) return true;
    if (seen.has(at)) return false;
    seen.add(at);
    return (onward.get(at) ?? []).some(walk);
  };
  return walk(target);
}

/**
 * A graph as the model requires it: **exactly one `out`**, and no cord pointing
 * at a port that is not there.
 *
 * Both are things a *file* can say and the editor cannot. Nothing in the browser
 * can delete the last `out` or drop a second one, so this is not a safety net
 * under the editor — it is the door a hand-written `scheme.json` comes through,
 * and it belongs at that door rather than in the compiler. Repairing here means
 * the repair is **written back** the next time anything saves, so a file that
 * was wrong is a file that stops being wrong; repairing in the compiler would
 * mean quietly redoing the same fix sixty times a second forever and never
 * telling anyone.
 *
 * A cord to a port that is not there is the other half, and it is the one a
 * *file this app wrote* can contain: an `effect` node's knobs are its mode's, so
 * a scheme saved before a mode was changed can carry a cord addressed to an
 * inlet that no longer exists. The compiler ignores those, which is worse than
 * it sounds — the canvas cannot draw a cord to a port that is not mounted, so
 * what you see is an outlet lit up with no wire leaving it.
 *
 * A **value** addressed to an inlet that is not there is the same thing one
 * step quieter, and it comes through the same door for the same reason.
 */
export function repaired(circuit: Circuit): Circuit {
  const ends = circuit.nodes.filter((node) => node.kind === 'out');
  // The one with something wired to it, so a file with two of them keeps the
  // one that was drawing rather than the one that happened to be written first.
  const fed = new Set(circuit.cords.map((cord) => splitPort(cord.to).node));
  const keep = ends.find((node) => fed.has(node.id)) ?? ends[0];

  const nodes = (
    keep
      ? circuit.nodes.filter((node) => node.kind !== 'out' || node.id === keep.id)
      : [...circuit.nodes, madeOut(circuit)]
  ).map(keepKnobs);

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const kept = new Map<string, CircuitCordLike>();
  for (const cord of circuit.cords) {
    const from = splitPort(cord.from);
    const to = splitPort(cord.to);
    const source = byId.get(from.node);
    const sink = byId.get(to.node);
    if (!source || !sink) continue;
    if (!NODE_SPECS[source.kind].outlets.some((port) => port.name === from.port)) continue;
    if (!inletsOf(sink).some((port) => port.name === to.port)) continue;
    // An inlet takes one thing, which is the rule `connect` keeps and the rule
    // the compiler resolves by. A file naming two is saying the later one.
    kept.set(cord.to, { from: cord.from, to: cord.to });
  }
  return { nodes, cords: [...kept.values()] };
}

/** An `out` for a graph that arrived without one, parked clear of the rest. */
function madeOut(circuit: Circuit): CircuitNode {
  const taken = new Set(circuit.nodes.map((node) => node.id));
  let id = 'out';
  for (let n = 1; taken.has(id); n++) id = `out${n}`;
  const right = circuit.nodes.reduce((most, node) => Math.max(most, node.x), 0);
  return { id, kind: 'out', x: right + 220, y: circuit.nodes[0]?.y ?? 60 };
}

/**
 * Every `track` node, in the order they take slots in the one bank.
 *
 * One bank rather than two, which is what merging `energy` into `track` bought:
 * the CPU fills each slot with whatever that node asked for — a meter, a fader,
 * a gate, any of them through an envelope — and the shader reads a number
 * without learning which. Two banks meant a look could name eight tracks *and*
 * eight energies and a shader declaring sixteen floats to hold what is almost
 * always two.
 */
export const tracksOf = (circuit: Circuit): CircuitTrack[] =>
  circuit.nodes
    .filter((node) => node.kind === 'track')
    .slice(0, MAX_TRACKS)
    .map((node, index) => ({
      id: node.id,
      name: node.of ?? '',
      read: node.op ?? TRACK_READS[0],
      index,
      // Zero, so a `track` that never asked for one is the number itself. The
      // default belongs here rather than at the reader, which cannot tell a
      // node that wants none from a node that has not said.
      smooth: node.value ?? 0,
    }));

/**
 * Every number riding `uParams`, in the order the shader reads them.
 *
 * Walked in node order and, within a node, in inlet order, so the bank a graph
 * produces is a function of the graph rather than of the order somebody
 * happened to turn things. `paramsOf` and the compiler both call this, which is
 * what keeps the slot a knob was compiled into and the slot its value is
 * written to the same number.
 *
 * **A wired inlet's value is not in here.** The cord decides what that inlet
 * reads, so the stored number is dormant — kept on the node so unwiring gives
 * it back, but costing no slot while a cord is on top of it.
 */
export function knobsOf(circuit: Circuit): CircuitKnob[] {
  const wired = new Set(circuit.cords.map((cord) => cord.to));
  const knobs: CircuitKnob[] = [];
  for (const node of circuit.nodes) {
    if (node.kind === 'value') {
      knobs.push({
        id: node.id,
        label: node.label || `knob ${knobs.length + 1}`,
        index: knobs.length,
        value: node.value ?? 0.5,
      });
      continue;
    }
    if (!node.knobs) continue;
    for (const port of inletsOf(node)) {
      const held = node.knobs[port.name];
      if (port.at === undefined || held === undefined) continue;
      const id = portId(node.id, port.name);
      if (wired.has(id)) continue;
      knobs.push({ id, label: port.name, index: knobs.length, value: held });
    }
  }
  return knobs;
}

/**
 * A node with only the values its inlets can hold.
 *
 * The same treatment a cord gets, at both the doors a cord gets it: `setNode`
 * when a mode change moves the inlets under it, and `repaired` for a file that
 * says something the editor cannot. A number left behind on an inlet that is
 * not there is worse than a stray cord — a cord at least lights an outlet up,
 * where a value is invisible until the mode comes back and it silently returns.
 *
 * Kept **by name**, which is the same kindness cords get: `bloom` and `smear`
 * share a `reach`, and it is the same knob in both.
 */
export function keepKnobs(node: CircuitNode): CircuitNode {
  if (!node.knobs) return node;
  const settable = new Map(inletsOf(node).map((port) => [port.name, port.at]));
  const kept: Record<string, number> = {};
  for (const [name, value] of Object.entries(node.knobs)) {
    if (settable.get(name) !== undefined) kept[name] = value;
  }
  if (Object.keys(kept).length === Object.keys(node.knobs).length) return node;
  if (Object.keys(kept).length > 0) return { ...node, knobs: kept };
  // The field goes rather than emptying, because `scheme.json` is a file
  // somebody reads and diffs, and an empty map on every node it ever touched
  // is a page of noise saying nothing.
  const bare = { ...node };
  delete bare.knobs;
  return bare;
}

/**
 * A look and everything it contains, as one graph.
 *
 * The graph a `look` node names is **pasted in around it**, with every id
 * prefixed so two copies of the same look cannot collide. Expanding before
 * compiling rather than teaching the compiler about sub-looks is what keeps the
 * compiler one thing: knobs and named tracks both get their bank slots
 * from the expanded graph without anyone writing a second pass to gather them.
 *
 * **Around it, not in place of it.** The node survives, holding the sub-graph on
 * its reserved inlet, because a look node has a point inlet and a point inlet
 * has to be able to do something: reading a whole sub-look somewhere other than
 * here is only expressible if there is still a node to do the reading. Splicing
 * the node out left that cord pointing at an address nothing looked up, so it
 * drew on the canvas and changed nothing on the wall.
 *
 * A look that cannot be found is dropped rather than refused — a look you
 * deleted should make the thing that used it go quiet, not stop the show.
 */
export function flatten(
  looks: Record<string, LookDef>,
  id: string,
  prefix = '',
  seen: readonly string[] = [],
): { circuit: Circuit; error: string | null } {
  const def = looks[id];
  if (!def) return { circuit: { nodes: [], cords: [] }, error: null };
  if (seen.includes(id)) {
    return { circuit: { nodes: [], cords: [] }, error: `${def.name || id} contains itself` };
  }

  const nodes: CircuitNode[] = [];
  const cords: CircuitCordLike[] = [];
  let error: string | null = null;

  for (const node of def.circuit.nodes) {
    const here = `${prefix}${node.id}`;
    nodes.push({ ...node, id: here });
    if (node.kind !== 'look') continue;

    const inner = flatten(looks, node.op ?? '', `${here}~`, [...seen, id]);
    error ??= inner.error;
    // The sub-look's own `out` is not an out any more; it is the junction this
    // node reads, so whatever fed it lands on the reserved inlet instead.
    const end = inner.circuit.nodes.find((n) => n.kind === 'out');
    const from = end ? feedOf(inner.circuit, portId(end.id, 'c')) : null;
    for (const each of inner.circuit.nodes) if (each.kind !== 'out') nodes.push(each);
    for (const cord of inner.circuit.cords) {
      if (end && splitPort(cord.to).node === end.id) continue;
      cords.push(cord);
    }
    if (from) cords.push({ from, to: portId(here, INNER) });
  }

  for (const cord of def.circuit.cords) {
    cords.push({ from: `${prefix}${cord.from}`, to: `${prefix}${cord.to}` });
  }

  return { circuit: { nodes, cords }, error };
}

type CircuitCordLike = { from: string; to: string };

function feedOf(circuit: Circuit, inlet: string): string | null {
  for (const cord of circuit.cords) if (cord.to === inlet) return cord.from;
  return null;
}

/**
 * A look to a fragment shader, or the reason it isn't one.
 *
 * Only what `out` can reach is emitted. A node wired to nothing costs nothing,
 * which matters more than it sounds: building one of these means dropping a node
 * and looking at it, and a compiler that treated an unwired node as an error
 * would make the canvas unusable for exactly the way it gets used.
 */
export function compileLook(looks: Record<string, LookDef>, id: string): Compiled {
  const expanded = flatten(looks, id);
  const empty: Compiled = {
    source: null,
    error: expanded.error,
    knobs: [],
    tracks: [],
    draws: null,
  };
  if (expanded.error) return empty;
  return compileCircuit(expanded.circuit);
}

export function compileCircuit(circuit: Circuit): Compiled {
  const knobs = knobsOf(circuit);
  const tracks = tracksOf(circuit);
  const drawn = circuit.nodes.find((node) => node.kind === 'tracks');
  const draws = drawn ? (drawn.op ?? TRACK_DRAWS[0]) : null;
  const bare: Compiled = { source: null, error: null, knobs, tracks, draws };

  const byId = new Map(circuit.nodes.map((node) => [node.id, node]));
  const slot = new Map(knobs.map((knob) => [knob.id, knob.index]));
  const trackSlot = new Map(tracks.map((track) => [track.id, track.index]));

  // Exactly one, and the backstop rather than the rule. `out` is not in the node
  // browser and the model refuses to delete it, so neither of these can be
  // reached from the editor; `repaired` fixes both at the door a file comes
  // through. What is left is a `compileCircuit` called on a graph nobody built
  // — a probe, a test — and for that a sentence beats a broken shader.
  const ends = circuit.nodes.filter((node) => node.kind === 'out');
  if (ends.length === 0) return { ...bare, error: 'no out node — nothing leaves this look' };
  if (ends.length > 1) return { ...bare, error: 'more than one out node' };
  if (knobs.length > MAX_KNOBS) {
    return { ...bare, error: `more than ${MAX_KNOBS} knobs` };
  }
  if (circuit.nodes.filter((n) => n.kind === 'track').length > MAX_TRACKS) {
    return { ...bare, error: `more than ${MAX_TRACKS} named tracks` };
  }

  /** Inlet address to the outlet feeding it. The last cord to an inlet wins. */
  const feeds = new Map<string, string>();
  for (const cord of circuit.cords) feeds.set(cord.to, cord.from);

  const lines: string[] = [];
  const named = new Map<string, string>();
  const open = new Set<string>();
  let failed: string | null = null;
  let serial = 0;

  /**
   * The GLSL variable an outlet lives in **at a point**, emitting whatever it
   * depends on first.
   *
   * The cache is keyed by the point as well as the port, which is the whole of
   * how a colour becomes a function: the same node read at two points is two
   * variables, and read at the same point twice is one.
   */
  const resolve = (nodeId: string, port: string, want: Signal, at: string): string | null => {
    const node = byId.get(nodeId);
    if (!node) return null;
    const spec = NODE_SPECS[node.kind];
    const outlet = spec.outlets.find((p) => p.name === port);
    if (!outlet) return null;
    if (outlet.kind !== want) {
      failed ??= `${spec.name}.${port} carries ${outlet.kind}, not ${want}`;
      return null;
    }

    const key = `${portId(nodeId, port)}@${at}`;
    const held = named.get(key);
    if (held) return held;
    // The **node**, not the node at this point. A node is only ever reachable
    // from its own inlets by going round a loop, so this cannot refuse anything
    // legitimate — where keying it by the point could not catch anything at
    // all once a loop had a geometry effect in it, because the point expression
    // grew on every trip round and never repeated. That descended until the
    // stack gave out, which reaches a person as a page that has stopped rather
    // than as a sentence about their wiring.
    if (open.has(nodeId)) {
      failed ??= `${spec.name} feeds itself — a look cannot loop`;
      return null;
    }
    if (lines.length > MAX_LINES) {
      failed ??= 'too big to draw — an effect that takes many samples is nested too deep';
      return null;
    }
    open.add(nodeId);

    /**
     * What an inlet reads with nothing wired to it: the number somebody set,
     * or the answer its spec came with.
     *
     * A set value is a **slot**, never the number itself. Writing `0.62` into
     * the source would make every knob a recompile — `signatureOf` leaves knob
     * values out precisely so that dragging one does not rebuild the shader
     * sixty times a second, and an inlined constant hands that back at every
     * inlet on the canvas.
     */
    const answer = (port: PortSpec, where: string): string => {
      const held = slot.get(portId(nodeId, port.name));
      if (held !== undefined) return `uParams[${held}]`;
      return port.fallback ?? (port.kind === 'p' ? where : '0.0');
    };

    const readAt = (inlet: string, where: string): string => {
      const wanted = inletsOf(node).find((p) => p.name === inlet);
      if (!wanted) return '0.0';
      const from = feeds.get(portId(nodeId, inlet));
      if (!from) return answer(wanted, where);
      const source = splitPort(from);
      return resolve(source.node, source.port, wanted.kind, where) ?? answer(wanted, where);
    };

    const ctx: Emitting = {
      at,
      node,
      read: (inlet) => readAt(inlet, at),
      readAt,
    };

    const emitted =
      node.kind === 'value'
        ? { n: `uParams[${slot.get(node.id) ?? 0}]` }
        : node.kind === 'track'
          ? { n: `uTracks[${trackSlot.get(node.id) ?? 0}]` }
          : spec.emit(ctx);
    open.delete(nodeId);

    // A serial rather than the node's index, because one node is now several
    // variables — one per point it was read at — and two of them sharing a name
    // is a shader that compiles and draws the wrong thing.
    for (const [name, expression] of Object.entries(emitted)) {
      const kind = spec.outlets.find((p) => p.name === name)?.kind ?? 'n';
      const cached = `${portId(nodeId, name)}@${at}`;
      if (named.has(cached)) continue;
      const variable = `v${serial++}`;
      lines.push(`  ${TYPES[kind]} ${variable} = ${expression};`);
      named.set(cached, variable);
    }
    return named.get(key) ?? null;
  };

  const from = feeds.get(portId(ends[0].id, 'c'));
  let result = 'vec4(0.0)';
  if (from) {
    const source = splitPort(from);
    result = resolve(source.node, source.port, 'c', 'centred()') ?? result;
  }
  if (failed) return { ...bare, error: failed };

  const source = `${lookPreamble(knobs.length)}${HELPERS}
void main() {
${lines.join('\n')}
  fragColor = ${result};
}`;
  return { ...bare, source, error: null };
}

/**
 * What a new look starts as.
 *
 * Not an empty canvas. An empty canvas asks you to know the vocabulary before
 * you have seen it work, and the first thing anyone wants is to move one knob
 * and watch the frame change.
 *
 * It starts with the **set** in it, which is a claim about what this rig is for:
 * the picture should already be reacting to whoever is playing before you have
 * decided anything, and taking the tracks node out is a deliberate act rather
 * than the default state.
 */
export function starterCircuit(): Circuit {
  return {
    nodes: [
      { id: 'live', kind: 'tracks', op: 'by name', x: 40, y: 60 },
      { id: 'wash', kind: 'source', op: 'plasma', x: 40, y: 250 },
      { id: 'k', kind: 'value', x: 40, y: 400, value: 0.35, label: 'wash' },
      { id: 'fold', kind: 'effect', op: 'kaleido', x: 260, y: 60 },
      { id: 'mix', kind: 'blend', op: 'screen', x: 500, y: 140 },
      { id: 'o', kind: 'out', x: 720, y: 150 },
    ],
    cords: [
      { from: 'live/c', to: 'fold/c' },
      { from: 'fold/c', to: 'mix/base' },
      { from: 'wash/c', to: 'mix/top' },
      { from: 'k/n', to: 'mix/amount' },
      { from: 'mix/c', to: 'o/c' },
    ],
  };
}

/** An empty one, for when you would rather start from nothing. */
export function bareCircuit(): Circuit {
  return {
    nodes: [
      { id: 'live', kind: 'tracks', op: 'by name', x: 60, y: 120 },
      { id: 'o', kind: 'out', x: 360, y: 130 },
    ],
    cords: [{ from: 'live/c', to: 'o/c' }],
  };
}
