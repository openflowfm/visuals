import {
  LENS_MODES,
  GRADE_MODES,
  SPREAD_MODES,
  DISPLACE_MODES,
  HALFTONE_MODES,
  READ_NAMES,
  MIX_MODES,
  MATH_OPS,
  PLAYBACK_NAMES,
  TRACK_READS,
  SONG_FACTS,
  SOURCES,
  FIELD_MODES,
  FRACTAL_MODES,
  LIGHT_MODES,
  IMAGE_MODES,
  VIDEO_MODES,
  TRACK_DRAWS,
  BLENDS,
  COLOR_ROLES,
  COLOR_ROLE_DETAILS,
  type Circuit,
  type CircuitNode,
  type FlowDef,
  type NodeKind,
} from '../../protocol.ts';
import { ALIVE, asFloat, C, E, FOLLOWS, N, P } from './ports.ts';
import type { PortDocumentation, PortSpec, Signal } from './ports.ts';
export type { PortDocumentation, PortSpec, Signal } from './ports.ts';
export {
  P as pointPort,
  C as colourPort,
  N as numberPort,
  ALIVE as livePort,
  E as energyPort,
} from './ports.ts';
import { CIRCUIT_HELPERS } from './glsl/circuit.ts';
import { FIELD_WORK } from './glsl/fields.ts';
import { SOURCE_VALUES } from './glsl/sources.ts';
import { LIGHT_WORK } from './glsl/light.ts';
import { FRACTAL_ITERATIONS, flowPreamble } from './shaders.ts';
import { VIDEO_NODE_SPEC } from '../nodes/video/spec.ts';
import { IMAGE_NODE_SPEC } from '../nodes/image/spec.ts';
import { LFO_NODE_SPEC } from '../nodes/lfo/spec.ts';
import { GLOW_NODE_SPEC } from '../nodes/glow/spec.ts';
import { SHADE_NODE_SPEC } from '../nodes/shade/spec.ts';
import { FIGURE_NODE_SPEC } from '../nodes/figure/spec.ts';
import { ARRAY_NODE_SPEC } from '../nodes/array/spec.ts';
import { FORM_NODE_SPEC } from '../nodes/form/spec.ts';
import {
  productionResponse,
  responseGlsl,
  responseKey,
  type ParameterResponse,
  type ResponseOverrides,
} from '../../response.ts';

/**
 * A flow, compiled to a fragment shader.
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
 * two sources can be folded differently and blended, a flow can be dropped
 * inside another flow, and none of it needs a buffer.
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
 * is then a number on the node's face, held in `CircuitNode.values`. Wiring a
 * `value` node into a `posterize` to set its one number was work nobody should
 * have to do, and the graph that came out said nothing that the number on the
 * face does not. What a set number must never be is *inlined*: it rides
 * `uParams` like every other one, so turning it recompiles nothing.
 *
 * The exceptions are the two number inlets whose answer is already alive —
 * `energy` reads the room and an `lfo`'s `clock` reads the beat. There is no
 * number to set there, only a signal to leave running or replace with a cord.
 */

/** What a node's `emit` is handed. */
export interface Emitting {
  /** Resolve an inlet at the point this evaluation is happening at. */
  read(inlet: string): string;
  /** Resolve an inlet at some other point — how every geometry effect works. */
  readAt(inlet: string, at: string): string;
  /** The point expression this evaluation is happening at. */
  at: string;
  /**
   * The outlet being asked for.
   *
   * A node emits every outlet it has in one go, which is right for `polar` —
   * both its numbers come off the same decomposition — and wrong for `lens`,
   * whose colour outlet *reads its input* while its point outlet does not.
   * Emitting the colour when somebody only wanted the point sends the resolver
   * back round a graph that was never circular, and it refuses a legal flow.
   */
  outlet: string;
  node: CircuitNode;
}

/** One documented way a node can behave. */
export interface NodeModeDocumentation {
  /** The value written to `CircuitNode.op`. */
  name: string;
  /** What choosing this mode does, in user language rather than shader language. */
  description: string;
}

/** Documentation common to the renderer, browser, faceplate, and search. */
export interface NodeDocumentation {
  /** What the node does regardless of its current mode. */
  description: string;
  /** Every fixed mode, in the order the app offers them. */
  modes?: readonly NodeModeDocumentation[];
}

export interface NodeSpec extends NodeDocumentation {
  /** What it is called on the canvas. */
  name: string;
  /**
   * The inlets, which for `lens`, `grade`, and `spread` depend on the mode.
   *
   * A function rather than a list because a kaleidoscope's numbers are not a
   * ripple's, and giving every effect two inlets called `a` and `b` would make
   * the canvas unreadable to buy a simpler type here.
   */
  inlets: readonly PortSpec[] | ((node: CircuitNode) => readonly PortSpec[]);
  outlets: readonly PortSpec[];
  /**
   * Which inlets an outlet actually reads. Absent means all of them.
   *
   * Only `lens` needs it, and it needs it badly: its `p` outlet is a function of
   * the point alone, so a lens whose point feeds a picture that feeds the lens's
   * colour back is a graph that terminates and draws. Anything that reasoned
   * node-to-node would call that a loop and refuse the cord.
   */
  reads?(node: CircuitNode, outlet: string): readonly string[];
  /** True when the modes are names from the set rather than a fixed list. */
  named?: 'track' | 'flow';
  /** Which server media-library asset this node names. */
  asset?: 'image' | 'video';
  /**
   * Worst-case fixed work each evaluation adds to the shader budget.
   *
   * Most nodes are straight expressions and cost nothing here. An iterative
   * node names its loop or sample ceiling, so reading it at nine bloom taps
   * costs nine times what reading it once does even though both are only a few
   * GLSL lines. A function may charge modes with different fixed bounds.
   */
  work?: number | ((node: CircuitNode) => number);
  emit(ctx: Emitting): Record<string, string>;
}

/**
 * Turn a fixed vocabulary into documented modes without allowing a missing row.
 *
 * The mapped type is the enforcement: add a string to `SOURCES`, `MATH_OPS`,
 * or another protocol list and TypeScript points here until its description is
 * written. The app receives the ordered array, so it never keeps a second copy.
 */
function documentedModes<const Names extends readonly string[]>(
  names: Names,
  descriptions: { readonly [Name in Names[number]]: string },
): readonly NodeModeDocumentation[] {
  return names.map((name) => ({
    name,
    description: descriptions[name as Names[number]],
  }));
}

/** The names of a node's documented modes, for code that only needs `op`. */
export function modesOf(kind: NodeKind): readonly string[] {
  return NODE_SPECS[kind].modes?.map((mode) => mode.name) ?? [];
}

/** The node or mode description the browser and faceplate should show. */
export function descriptionOf(kind: NodeKind, op?: string): string {
  const spec = NODE_SPECS[kind];
  return spec.modes?.find((mode) => mode.name === op)?.description ?? spec.description;
}


/**
 * The one port name the flattener writes and nobody types.
 *
 * A tilde, because a node id is `kind` plus a number and a port name comes off
 * a spec, so neither can ever collide with one. The canvas hides these; see
 * `flow` below for the only one there is.
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

  // The two that carve rather than combine, and the reason `blend` has its own
  // mode list. Everything above is a pair of GL blend factors written out; a
  // stencil is not expressible as one, because it reads the top picture's
  // BRIGHTNESS where fixed-function hardware only ever reads its alpha.
  //
  // Brightness and not alpha is the whole point on footage: a video's alpha is
  // 1 in every pixel, so `over` can never be masked and `multiply` darkens the
  // outside instead of removing it. Wire the same picture into both inlets and
  // this is a luma key; wire a light or a source in and it is a mask.
  //
  // The luminance is taken off the **premultiplied** colour on purpose, so it is
  // brightness times coverage in one number: a lamp that fades to nothing at its
  // edge should stop masking there, and dividing the coverage back out first
  // would make its faintest edge as strong a mask as its core.
  stencil: (a, b) => `(${a} * fxLuma(${b}.rgb))`,
  cut: (a, b) => `(${a} * (1.0 - fxLuma(${b}.rgb)))`,
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
 * file can say, produced a node with no settable inlets at all whose shader was
 * calling for numbers that were therefore always zero.
 */
const modeOf = <const Modes extends readonly string[]>(
  node: CircuitNode,
  modes: Modes,
): Modes[number] =>
  (modes.includes(node.op ?? '') ? node.op! : modes[0]) as Modes[number];

/**
 * Which numbers each mode takes, by the family that owns it.
 *
 * Kept as separate tables rather than one because the split is the point: the list
 * is the shape of a *mode*, and a mode belongs to exactly one kind now.
 */
const LENS_VALUES = {
  zoom: ['by'],
  swirl: ['turn'],
  fold: ['sides'],
  wobble: ['amount'],
  tile: ['count'],
  mirror: ['line', 'angle'],
  kaleido: ['segments', 'spin'],
  twist: ['turn', 'sway'],
  ripple: ['waves', 'depth', 'speed'],
  slice: ['bands', 'throw'],
  pixelate: ['blocks', 'resolve'],
  creep: ['grow'],
} as const satisfies Record<string, readonly string[]>;

const GRADE_VALUES = {
  levels: ['gain', 'lift'],
  saturate: ['amount'],
  hue: ['shift'],
  tint: ['amount', 'bias'],
  // `steps`, where it was `levels` — which is now the name of the mode beside
  // it. An inlet and a sibling mode sharing a word is the kind of collision
  // that only shows up when somebody reads the dropdown out loud.
  posterize: ['steps'],
  solarize: ['pivot', 'amount'],
  channels: ['rotate'],
  invert: ['hold', 'rate'],
  highlights: ['knee', 'amount'],
} as const satisfies Record<string, readonly string[]>;

/**
 * Both displacements take one number and it is the same number, which is what
 * makes them modes of one node rather than two kinds: flicking between them
 * with the picture up moves nothing — the field stays wired, the amount stays
 * set, and what changes is how the field is READ.
 */
const DISPLACE_VALUES = {
  map: ['amount'],
  curl: ['amount'],
} as const satisfies Record<string, readonly string[]>;

const HALFTONE_VALUES = {
  dots: ['size', 'tilt'],
  lines: ['size', 'tilt'],
  // No tilt: a dither is an ordered matrix aligned to the frame, and turning it
  // would be turning the grid the threshold is defined on rather than turning a
  // screen laid over the picture.
  dither: ['size'],
  scanlines: ['size', 'weight'],
} as const satisfies Record<string, readonly string[]>;

const SPREAD_VALUES = {
  bloom: ['reach', 'floor'],
  smear: ['reach', 'drive'],
  edge: ['width', 'gain'],
  // `split`, where it was `spread` — same collision, this time with the kind.
  shift: ['split', 'drive'],
  streak: ['reach', 'gain'],
  disperse: ['split', 'drive'],
} as const satisfies Record<string, readonly string[]>;

const FRACTAL_VALUES = {
  mandelbrot: ['zoom', 'turn', 'detail'],
  julia: ['zoom', 'turn', 'detail', 'shape'],
} as const satisfies Record<string, readonly string[]>;

const FIELD_VALUES = {
  cells: ['weave'],
  clouds: ['weave'],
  metaballs: ['balls', 'apart'],
} as const satisfies Record<string, readonly string[]>;

const LIGHT_VALUES = {
  lamp: ['carry', 'soft'],
  beam: ['aim', 'spread'],
  shafts: ['blades', 'haze'],
  caustics: ['weave', 'glint'],
} as const satisfies Record<string, readonly string[]>;

/**
 * Where each hung light hangs until a cord moves it, in centred space.
 *
 * `caustics` has no entry and no `from` inlet: water light is a surface the
 * frame is under, not a point in it, and an inlet that moved nothing would
 * teach the wrong physics.
 */
const LIGHT_HUNG: Partial<Record<(typeof LIGHT_MODES)[number], string>> = {
  lamp: 'vec2(0.0)',
  beam: 'vec2(0.0, 0.45)',
  shafts: 'vec2(0.0, 0.45)',
};

type ValueInlet =
  | (typeof LENS_VALUES)[keyof typeof LENS_VALUES][number]
  | (typeof GRADE_VALUES)[keyof typeof GRADE_VALUES][number]
  | (typeof SPREAD_VALUES)[keyof typeof SPREAD_VALUES][number]
  | (typeof DISPLACE_VALUES)[keyof typeof DISPLACE_VALUES][number]
  | (typeof HALFTONE_VALUES)[keyof typeof HALFTONE_VALUES][number]
  | (typeof FRACTAL_VALUES)[keyof typeof FRACTAL_VALUES][number]
  | (typeof FIELD_VALUES)[keyof typeof FIELD_VALUES][number]
  | (typeof LIGHT_VALUES)[keyof typeof LIGHT_VALUES][number]
  | (typeof SOURCE_VALUES)[keyof typeof SOURCE_VALUES][number];

/**
 * Every mode-dependent control, by the port name the graph saves.
 *
 * Derived from the executable inlet tables above, so adding a control is a
 * type error until the sentence the faceplate will show has been written.
 */
const VALUE_DESCRIPTION: Record<ValueInlet, string> = {
  by: 'How far the picture is zoomed in or out.',
  turn: 'How far, and in which direction, the picture rotates.',
  sides: 'How many mirrored sides the point is folded into.',
  amount: 'How strongly the point or colour is changed.',
  count: 'How many times the picture repeats across the frame.',
  line: 'Where the mirror line crosses the frame.',
  angle: 'The angle of the mirror line around the frame.',
  segments: 'How many mirrored wedges make up the kaleidoscope.',
  spin: 'How much the kaleidoscope turns with the beat.',
  sway: 'How much the twist rocks back and forth with the beat.',
  waves: 'How many wave fronts cross the picture.',
  depth: 'How far the ripple displaces the picture beneath it.',
  speed: 'How quickly each ripple travels away from the centre.',
  bands: 'How many horizontal bands the picture is cut into.',
  throw: 'How far each sliced band is pushed sideways.',
  blocks: 'How large the pixel blocks become.',
  resolve: 'How far the blocks resolve back into the picture.',
  grow: 'How fast the picture grows or shrinks, per second rather than per step.',
  gain: 'How strongly the resulting colour or edge is amplified.',
  lift: 'How much brightness is added to the darkest colours.',
  shift: 'How far every hue rotates around the colour wheel.',
  bias: 'Where the recolouring lands: down in the shadows or up in the highlights.',
  pivot: 'How bright a colour must be before it is folded back down.',
  rotate: 'Which way round the red, green and blue channels are swapped.',
  size: 'How coarse the pattern is, from a fine screen to a few large marks.',
  tilt: 'The angle the screen is laid across the frame at.',
  weight: 'How far the dimmed rows fall below the lit ones.',
  steps: 'How aggressively the colours are reduced to flat bands.',
  hold: 'How long the inverted state is held.',
  rate: 'Which musical division drives the change.',
  knee: 'How bright a colour must be before it starts rolling off.',
  reach: 'How far from this point the surrounding picture is sampled.',
  floor: 'How bright something must be before it blooms.',
  drive: 'How strongly the room energy drives the effect.',
  width: 'How far apart the samples used to find an edge are.',
  split: 'How far the colour channels separate.',
  zoom: 'How deeply the fractal is magnified, on a bounded logarithmic scale.',
  detail: 'How many bounded orbit steps are used to reveal fine structure.',
  shape: 'Which Julia-set seed is traced around the useful connected region.',
  balls: 'How many metaballs are active, from two through the bounded ceiling of seven.',
  apart: 'How far the metaballs separate, ending in a fully spaced elliptical ring.',
  carry: 'How far the light carries before it dies away.',
  soft: 'How much of the light is hot core against outer halo.',
  aim: 'Which way the beam points, swung about straight down.',
  spread: 'How wide the cone opens.',
  blades: 'How many distinct rays streak the fan.',
  haze: 'How far the rays carry through the air.',
  weave: 'How tightly the pattern is woven.',
  glint: 'How sharply the bright crossings flash.',
  columns: 'How many columns divide the bar.',
  flight: 'How far each ring flies before it dies.',
  cover: 'How much of the frame the field covers.',
  pulse: 'Which musical division the flash lands on.',
  tiles: 'How many tiles divide the frame.',
  spokes: 'How many spokes fan around the centre.',
  arms: 'How many arms wind out of the centre.',
  coil: 'How tightly the arms coil as they leave the centre.',
  lines: 'How many lines rule the frame.',
  shower: 'How thickly the sparks fill the frame.',
};

/**
 * The numbers that follow the energy inlet until somebody takes them.
 *
 * Every promoted constant is in here, because every one of them had `e` mixed
 * into it — which is what keeps the promotion invisible on a graph nobody has
 * touched. A name absent from this set sits at `VALUE_AT` instead.
 */
const VALUE_FOLLOWS: ReadonlySet<string> = new Set([
  ...Object.values(SOURCE_VALUES).flat(),
  ...FIELD_VALUES.cells,
  ...FIELD_VALUES.clouds,
]);

/**
 * Where a number starts when nobody has turned it. A half unless it says.
 *
 * Keyed by name, and by `mode/name` where one word starts in two places. That
 * second form exists because the names are the vocabulary somebody reads the
 * canvas in, so the same word SHOULD appear on more than one mode — and
 * `amount` is a wobble of a third at rest and a saturation of exactly what
 * arrived. A centred control resting off its centre is a node that changed the
 * picture by being dropped, which is the bargain every unwired inlet makes.
 */
const VALUE_AT: Record<string, number> = {
  // A shoulder that starts near the top and rolls hard: anywhere lower and the
  // node is a contrast control wearing the wrong name.
  knee: 0.65,
  'highlights/amount': 0.55,
  sides: 0.2,
  weight: 0.6,
  'saturate/amount': 0.5,
  amount: 0.3,
  count: 0.3,
  zoom: 0,
  detail: 0.35,
  balls: 0.4,
  apart: 0.5,
  soft: 0.4,
  spread: 0.35,
  glint: 0.6,
};

/** The modes that read an energy. The rest have no such inlet to leave unwired. */
const NEEDS_ENERGY = new Set([
  ...SOURCES,
  'kaleido',
  'twist',
  'ripple',
  'slice',
  'pixelate',
  'invert',
  'bloom',
  'shift',
  'streak',
  'disperse',
  'mandelbrot',
  'julia',
  'cells',
  'clouds',
  'metaballs',
  'lamp',
  'beam',
  'shafts',
  'caustics',
]);

const valuePorts = (kind: NodeKind, names: readonly ValueInlet[], op: string): PortSpec[] => [
  ...(NEEDS_ENERGY.has(op) ? [E()] : []),
  ...names.map((name) => {
    const port = VALUE_FOLLOWS.has(name)
      ? FOLLOWS(name, VALUE_DESCRIPTION[name])
      : N(name, VALUE_DESCRIPTION[name], VALUE_AT[`${op}/${name}`] ?? VALUE_AT[name] ?? 0.5);
    const response = productionResponse({ kind, mode: op, inlet: name });
    if (response) port.response = response;
    return port;
  }),
];

/**
 * Where each `lens` mode moves the point to.
 *
 * Eleven functions of a point, which is all a lens has ever been — five of them
 * were standalone node kinds and six were `effect` modes, written under two
 * prefixes in two files, and `fold` and `kaleido` were the same wedge fold
 * twice. Reading the point off the node's own `p` inlet rather than off
 * `ctx.at` is the only change to any of them, and with that inlet unwired the
 * two are the same thing.
 */
const LENS_POINT: Record<string, (ctx: Emitting, e: string, k: (i: number) => string) => string> = {
  zoom: (c, _e, k) => `cZoom(${c.read('p')}, ${k(0)})`,
  swirl: (c, _e, k) => `cSwirl(${c.read('p')}, ${k(0)})`,
  fold: (c, _e, k) => `cFold(${c.read('p')}, ${k(0)})`,
  wobble: (c, _e, k) => `cWobble(${c.read('p')}, ${k(0)})`,
  tile: (c, _e, k) => `cTile(${c.read('p')}, ${k(0)})`,
  mirror: (c, _e, k) => `fxMirror(${c.read('p')}, ${k(0)}, ${k(1)})`,
  kaleido: (c, e, k) => `fxKaleido(${c.read('p')}, ${k(0)}, ${k(1)}, ${e})`,
  twist: (c, e, k) => `fxTwist(${c.read('p')}, ${k(0)}, ${k(1)}, ${e})`,
  ripple: (c, e, k) => `fxRipple(${c.read('p')}, ${k(0)}, ${k(1)}, ${k(2)}, ${e})`,
  slice: (c, e, k) => `fxSlice(${c.read('p')}, ${k(0)}, ${k(1)}, ${e})`,
  pixelate: (c, e, k) => `fxPixelate(${c.read('p')}, ${k(0)}, ${k(1)}, ${e})`,
  creep: (c, _e, k) => `fxCreep(${c.read('p')}, ${k(0)})`,
};

/** The colour where it already is. Eight one-liners, and none of them move. */
const GRADE_EMIT: Record<string, (ctx: Emitting, e: string, k: (i: number) => string) => string> = {
  levels: (c, _e, k) => `cLevels(${c.read('c')}, ${k(0)}, ${k(1)})`,
  saturate: (c, _e, k) => `fxSaturate(${c.read('c')}, ${k(0)})`,
  hue: (c, _e, k) => `cHue(${c.read('c')}, ${k(0)})`,
  tint: (c, _e, k) => `fxTint(${c.read('c')}, ${k(0)}, ${k(1)})`,
  posterize: (c, _e, k) => `fxPosterize(${c.read('c')}, ${k(0)})`,
  solarize: (c, _e, k) => `fxSolarize(${c.read('c')}, ${k(0)}, ${k(1)})`,
  channels: (c, _e, k) => `fxChannels(${c.read('c')}, ${k(0)})`,
  invert: (c, e, k) => `fxInvert(${c.read('c')}, ${k(0)}, ${k(1)}, ${e})`,
  highlights: (c, _e, k) => `fxHighlights(${c.read('c')}, ${k(0)}, ${k(1)})`,
};

/**
 * Where a displacement moves the point to.
 *
 * The field is read **at the point being displaced** rather than at the point
 * this evaluation happens to be at, which is the difference between a field
 * that travels with a lens in front of it and one that stays nailed to the
 * frame while the picture slides underneath it.
 */
const DISPLACE_POINT: Record<string, (ctx: Emitting, k: (i: number) => string) => string> = {
  map: (c, k) => {
    const at = c.read('p');
    return `fxDisplaceMap(${at}, ${c.readAt('field', at)}, ${k(0)})`;
  },
  curl: (c, k) => {
    const at = c.read('p');
    return `fxDisplaceCurl(${at}, ${c.readAt('field', at)}, ${k(0)})`;
  },
};

/**
 * The four screens, each one tap of its input and a function of where it is.
 *
 * `c.at` rather than a `p` inlet: a screen is laid across the FRAME, and one
 * that could be moved independently of the picture under it would slide the
 * dots off the content they are made of.
 */
const HALFTONE_EMIT: Record<string, (ctx: Emitting, k: (i: number) => string) => string> = {
  dots: (c, k) => `fxDots(${c.read('c')}, ${c.at}, ${k(0)}, ${k(1)})`,
  lines: (c, k) => `fxLines(${c.read('c')}, ${c.at}, ${k(0)}, ${k(1)})`,
  dither: (c, k) => `fxDither(${c.read('c')}, ${c.at}, ${k(0)})`,
  scanlines: (c, k) => `fxScanlines(${c.read('c')}, ${c.at}, ${k(0)}, ${k(1)})`,
};

/**
 * One number off a picture, unpremultiplied first.
 *
 * Every colour on the wire is premultiplied, so a half-covered white pixel is
 * `vec4(0.5, 0.5, 0.5, 0.5)` and reading `.r` raw would call it grey. Dividing
 * the coverage back out is what makes `luma` mean the brightness you can SEE
 * rather than the brightness times how much of it is there — and it is why
 * `alpha` is the one mode that does not divide, because coverage is the thing
 * it is asking about.
 */
const READ_EMIT: Record<string, (colour: string) => string> = {
  luma: (c) => `clamp(fxLuma(${c}.rgb / max(${c}.a, 1e-4)), 0.0, 1.0)`,
  red: (c) => `clamp(${c}.r / max(${c}.a, 1e-4), 0.0, 1.0)`,
  green: (c) => `clamp(${c}.g / max(${c}.a, 1e-4), 0.0, 1.0)`,
  blue: (c) => `clamp(${c}.b / max(${c}.a, 1e-4), 0.0, 1.0)`,
  alpha: (c) => `clamp(${c}.a, 0.0, 1.0)`,
};

/**
 * The four that read their input several times.
 *
 * The only family that can make a shader too big to draw, which is why it is a
 * family: nesting two of these multiplies everything upstream of them, and
 * `MAX_LINES` is the backstop rather than the plan.
 */
const SPREAD_EMIT: Record<string, (ctx: Emitting, e: string, k: (i: number) => string) => string> =
  {
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

    // Bright things smeared sideways, the way light through an anamorphic
    // element flares along one axis only. Nine taps in a line, weighted so the
    // near ones dominate, and — like `bloom` — only what is already bright is
    // added back, because a streak over the whole frame is a horizontal blur
    // and reads as a broken projector rather than a lens.
    //
    // The reach is in **plane units and corrected for aspect**, so the streak is
    // as long a fraction of the frame's *width* at every resolution. Without the
    // correction a streak dialled in on the bench arrives at 16:9 shorter than
    // it was drawn, which is the trap `edge` documents from the other side.
    streak: (c, e, k) => {
      const reach = `((0.012 + ${k(0)} * 0.22) * (0.55 + uLevel * 0.75))`;
      // **Squared spacing, halving weights.** Evenly spaced taps of similar
      // weight do not read as a smear at all — they read as six copies of the
      // picture in a row, which is what the first version of this did. A tail
      // that falls off geometrically while the samples spread out to meet it is
      // the cheapest thing that looks continuous: the near taps carry almost
      // all of the light and sit almost on top of the source, and the far ones
      // are too faint to be seen as anything but a glow by the time they are
      // far enough apart to be told apart.
      const arms = [1, 2, 3, 4, 5, 6];
      const total = arms.reduce((sum, i) => sum + 2 * 0.55 ** i, 0);
      const taps = arms.flatMap((i) => {
        const at = ((i / arms.length) ** 2).toFixed(4);
        const weight = (0.55 ** i).toFixed(4);
        const step = `vec2(${reach} * ${at} * uRes.x / uRes.y, 0.0)`;
        return [
          `${c.readAt('c', `(${c.at} + ${step})`)} * ${weight}`,
          `${c.readAt('c', `(${c.at} - ${step})`)} * ${weight}`,
        ];
      });
      const gathered = `((${taps.join(' + ')}) / ${total.toFixed(4)})`;
      return `(${c.read('c')} + max(${gathered} - vec4(0.06), vec4(0.0)) * mix(0.6, 1.8, ${e}) * ${k(1)} * 3.0)`;
    },

    // The picture read at six radii and each read kept for a different part of
    // the spectrum, which is what a real lens does to a bright edge off-axis:
    // the further from the middle, the further the colours have walked apart.
    //
    // Radial rather than the sideways separation `shift` does, and that is the
    // whole difference between them. `shift` is a *glitch* — three whole
    // channels shoved apart in one direction, and it reads as a broken signal,
    // which is often what is wanted. This is an *optic*: nothing moves at the
    // centre, everything smears outward, and the fringe is red one side and blue
    // the other because it is the same lens on both.
    disperse: (c, e, k) => {
      const split = `(${k(0)} * 0.055 * (0.35 + uLevel * ${k(1)} * 1.6) * mix(0.5, 1.5, ${e}))`;
      // Six weights across a rainbow, and the divisors are their own sums, so a
      // white pixel at the centre comes back white rather than tinted.
      const weights: readonly (readonly [number, number, number])[] = [
        [1.0, 0.15, 0.0],
        [0.9, 0.5, 0.0],
        [0.4, 1.0, 0.1],
        [0.1, 0.9, 0.5],
        [0.0, 0.4, 1.0],
        [0.0, 0.1, 1.0],
      ];
      const sum = weights.reduce<[number, number, number]>(
        (into, w) => [into[0] + w[0], into[1] + w[1], into[2] + w[2]],
        [0, 0, 0],
      );
      const reads = weights.map((w, i) => {
        const along = (i / (weights.length - 1)) * 2 - 1;
        const at = `(${c.at} * (1.0 + ${along.toFixed(4)} * ${split}))`;
        return { tap: c.readAt('c', at), w };
      });
      const channel = (band: 0 | 1 | 2) =>
        `(${reads
          .filter((read) => read.w[band] > 0)
          .map((read) => `${read.tap}.${'rgb'[band]} * ${read.w[band].toFixed(3)}`)
          .join(' + ')}) / ${sum[band].toFixed(3)}`;
      // The most opaque of the six, so a fringe that has walked off the shape
      // still composites instead of vanishing into what it walked onto.
      const cover = reads.map((read) => `${read.tap}.a`).reduce((a, b) => `max(${a}, ${b})`);
      return `vec4(${channel(0)}, ${channel(1)}, ${channel(2)}, ${cover})`;
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
      return `vec4(mix(uPrimary, vec3(1.0), 0.45) * ${m}, ${m})`;
    },
  };

const PLAYBACK_MODES = documentedModes(PLAYBACK_NAMES, {
  level: "The room's master meter, from silence to its current loudness.",
  beat: 'Continuous musical beats. Wire it into an lfo when you need a repeating shape.',
  phase: 'The current position through the bar, from its first beat to its last.',
  pulse: 'A hit at the start of each beat that decays before the next one.',
  time: 'Seconds since the renderer opened, for motion that should not lock to the music.',
  random: 'A stable random number that changes once on every beat.',
});

const TRACK_MODES = documentedModes(TRACK_READS, {
  level: "The track's output meter, with the node's smoothing applied.",
  fader: "The current position of the track's volume fader.",
  playing: 'One while this track has a playing clip, and zero while it does not.',
});

const SONG_MODES = documentedModes(SONG_FACTS, {
  seed: 'A stable different number for every song, for free per-song variation.',
  tempo: "The song's stated tempo, normalized to a number the graph can use.",
  key: "The song's musical key as a position around the chromatic scale.",
  section: 'Where the playing section sits among the sections used by this set.',
  sections: 'How many distinct sections the current set uses.',
});

const SOURCE_MODES = documentedModes(SOURCES, {
  solid: 'The active colour, breathing over the bar and brightening with the room.',
  bars: 'Vertical bars whose heights form a bar of music, swept by the playhead.',
  rings: 'Rings launched on the beat and expanding away from the centre.',
  noise: 'A drifting field that thickens with the room. Weather rather than a metronome.',
  strobe: 'Whole-frame flashes on the beat, with no shape competing for attention.',
  grid: 'A field of cells, each lighting on its own beat.',
  tunnel: 'A corridor rushing toward the viewer on the beat.',
  plasma: 'A full-frame wash made by crossing four moving sine fields.',
  spiral: 'Arms winding out of the centre and turning on the beat.',
  scan: 'Horizontal lines with a bar of light sweeping down them.',
  sparks: 'A field of cells that fire on their own beats and drift as they fade.',
  checker: 'Alternating square tiles that flip on a musical division.',
  rays: 'Alternating angular beams turning around the centre on the beat.',
});

const FIELD_MODE_DOCUMENTATION = documentedModes(FIELD_MODES, {
  cells: 'Distance to the nearest jittered feature point in a bounded cellular field.',
  clouds: 'Four fixed octaves of gradient noise drifting as one continuous field.',
  metaballs: 'Two to seven independently orbiting Gaussian fields that merge into soft shapes.',
});

const FRACTAL_MODE_DOCUMENTATION = documentedModes(FRACTAL_MODES, {
  mandelbrot: 'The classic connected escape-time set, bounded to a safe amount of detail.',
  julia: 'A related escape-time set whose shape control moves through useful Julia seeds.',
});

const LIGHT_MODE_DOCUMENTATION = documentedModes(LIGHT_MODES, {
  lamp: 'A soft point of light in haze — a hot core over an inverse-square halo.',
  beam: 'A stage spotlight cone with dust drifting through it, aimed about straight down.',
  shafts: 'Crepuscular rays fanning down from a hanging point, streaked and slowly marching.',
  caustics: 'Sunlight through water: two drifting cellular layers whose crossings glint.',
});

const TRACK_DRAW_MODES = documentedModes(TRACK_DRAWS, {
  'by name': 'Draw every playing track from the visual hint in that track’s name.',
  solid: 'Draw every playing track as a breathing field of its assigned colour.',
  bars: 'Draw every playing track as vertical musical bars.',
  rings: 'Draw every playing track as expanding rings.',
  noise: 'Draw every playing track as a drifting noise field.',
  strobe: 'Draw every playing track as a full-frame beat flash.',
  grid: 'Draw every playing track as a pulsing grid.',
  tunnel: 'Draw every playing track as a rushing tunnel.',
  plasma: 'Draw every playing track as a moving plasma wash.',
  spiral: 'Draw every playing track as a turning spiral.',
  scan: 'Draw every playing track as sweeping scan lines.',
  sparks: 'Draw every playing track as a drifting field of sparks.',
  checker: 'Draw every playing track as alternating square tiles.',
  rays: 'Draw every playing track as rotating angular beams.',
});

const LENS_MODE_DOCUMENTATION = documentedModes(LENS_MODES, {
  zoom: 'Read the picture closer to or farther from its centre.',
  swirl: 'Rotate the picture increasingly as it moves away from the centre.',
  fold: 'Mirror the picture into repeated sides around the centre.',
  wobble: 'Displace the picture with crossing waves.',
  tile: 'Repeat the picture across the frame.',
  mirror: 'Reflect the picture across a movable line.',
  kaleido: 'Fold the picture into wedges and rotate them with the beat.',
  twist: 'Turn the picture more strongly toward its edges and sway it with the beat.',
  ripple: 'Send a wave from the centre that displaces the picture as it passes.',
  slice: 'Cut the picture into horizontal bands and throw them sideways.',
  pixelate: 'Break the picture into blocks that resolve across the bar.',
  creep: 'Zoom continuously at a speed, for a point fed back into its own picture.',
});

const GRADE_MODE_DOCUMENTATION = documentedModes(GRADE_MODES, {
  levels: 'Raise or lower the picture’s brightness and its darkest colours.',
  saturate: 'Drain the colour out toward grey, or push it past where it was.',
  hue: 'Rotate every colour while leaving the picture in place.',
  tint: 'Recolour the picture from its own brightness, ending at the room’s colour.',
  posterize: 'Reduce continuous colour into a small number of flat bands.',
  solarize: 'Fold everything brighter than a pivot back down the other side.',
  channels: 'Swap the red, green and blue channels around each other.',
  invert: 'Turn the colours into their opposites on a musical pulse.',
  highlights: 'Roll the brightest colours off into white instead of letting them clip.',
});

const DISPLACE_MODE_DOCUMENTATION = documentedModes(DISPLACE_MODES, {
  map: 'Push the point by a picture’s red and green, the way a displacement map is read.',
  curl: 'Push the point in the direction a picture’s brightness names.',
});

const HALFTONE_MODE_DOCUMENTATION = documentedModes(HALFTONE_MODES, {
  dots: 'Reduce the picture to a screen of dots that grow with its brightness.',
  lines: 'Reduce the picture to ruled lines that thicken with its brightness.',
  dither: 'Reduce the picture to a fixed pattern of lit and unlit points.',
  scanlines: 'Dim alternating rows, the way a tube draws a picture.',
});

const READ_MODES = documentedModes(READ_NAMES, {
  luma: 'How bright the picture is here, weighted the way an eye reads it.',
  red: 'How much red the picture has here.',
  green: 'How much green the picture has here.',
  blue: 'How much blue the picture has here.',
  alpha: 'How much of the frame the picture actually covers here.',
});

const SPREAD_MODE_DOCUMENTATION = documentedModes(SPREAD_MODES, {
  bloom: 'Add nearby copies of bright areas back over the picture.',
  smear: 'Blend nearby samples into a short radial blur.',
  edge: 'Keep the changes between nearby samples and throw the fill away.',
  shift: 'Separate the colour channels, opening on transients and closing in gaps.',
  streak: 'Smear the bright parts sideways, the way an anamorphic lens flares.',
  disperse: 'Split the picture into its spectrum along the line out from the centre.',
});

const BLEND_MODES = documentedModes(MIX_MODES, {
  over: 'Place the top picture over the base according to its opacity.',
  add: 'Sum both pictures, making overlaps brighter.',
  screen: 'Combine both pictures while rolling bright overlaps toward white.',
  multiply: 'See the base through the top, making overlaps darker.',
  stencil: 'Keep the base only where the top picture is bright.',
  cut: 'Keep the base only where the top picture is dark.',
});

const MATH_MODES = documentedModes(MATH_OPS, {
  add: 'Add both numbers and stop at one.',
  subtract: 'Subtract the second number from the first and stop at zero.',
  multiply: 'Multiply both numbers. The result may be greater than one.',
  min: 'Use whichever of the two numbers is lower.',
  max: 'Use whichever of the two numbers is higher.',
  average: 'Use the midpoint between both numbers.',
});

/**
 * The three things a flow can hand out through a `give`, named for what they
 * are rather than for a letter.
 */
const GIVE_MODE_NAMES = ['number', 'point', 'colour'] as const;
const GIVE_MODES: readonly NodeModeDocumentation[] = [
  {
    name: 'number',
    description: 'Give one number — a reactive value other flows wire like any other signal.',
  },
  { name: 'point', description: 'Give a point, for a flow that computes a position.' },
  { name: 'colour', description: 'Give a picture, without putting it on the wall.' },
];
const GIVE_KINDS: Record<(typeof GIVE_MODE_NAMES)[number], Signal> = {
  number: 'n',
  point: 'p',
  colour: 'c',
};

export const NODE_SPECS: Record<NodeKind, NodeSpec> = {
  point: {
    name: 'point',
    description:
      'The position currently being drawn: zero in the middle, with distance and direction around it.',
    inlets: [],
    outlets: [P('p', 'The current position in the frame.')],
    // Not `centred()`. It is wherever the thing downstream is *asking* about,
    // which is what lets an effect move a whole subgraph rather than itself.
    emit: (c) => ({ p: c.at }),
  },

  playback: {
    name: 'playback',
    description: 'Live numbers describing where the music is right now.',
    inlets: [],
    outlets: [N('n', 'The selected playback reading.')],
    modes: PLAYBACK_MODES,
    emit: (c) => ({ n: SIGNALS[c.node.op ?? 'level'] ?? 'uLevel' }),
  },

  value: {
    name: 'value',
    description: 'One reusable number that changes every inlet it is wired to.',
    inlets: [],
    outlets: [N('n', 'The number set on this node.')],
    // The index is assigned by the compiler, which is the only thing that knows
    // how many numbers came before this one.
    emit: () => ({ n: 'uParams[0]' }),
  },

  take: {
    name: 'take',
    description:
      'A number this flow asks for. Used inside another flow, it becomes a named inlet on that face; here it is the number set on it.',
    inlets: [],
    outlets: [N('n', 'The number taken in, or the one set here until something supplies it.')],
    // A `value` to its own graph: the flattener swaps in whatever the parent
    // wired or held, and with nothing supplied the number set here stands.
    emit: () => ({ n: 'uParams[0]' }),
  },

  track: {
    name: 'track',
    description:
      'One named track in the set, read as a meter, fader position, or playing gate.',
    inlets: [],
    outlets: [N('n', 'The selected live reading from this track.')],
    modes: TRACK_MODES,
    named: 'track',
    // The slot is assigned by the compiler; what goes *in* it is decided on the
    // CPU, because the smoothing is an envelope follower and one of those has
    // to remember what it saw last frame. See `feed.ts`.
    emit: () => ({ n: 'uTracks[0]' }),
  },

  song: {
    name: 'song',
    description: 'A musical or structural fact about the song that is playing.',
    inlets: [],
    outlets: [N('n', 'The selected fact about the current song.')],
    modes: SONG_MODES,
    emit: (c) => ({ n: FACTS[c.node.op ?? 'seed'] ?? 'uSongSeed' }),
  },

  source: {
    name: 'source',
    description: 'A generated picture, drawn at a point and animated by the room.',
    inlets: (node) => {
      const op = modeOf(node, SOURCES);
      return [
        P('p', 'Where in the generated picture to read.'),
        ...valuePorts('source', SOURCE_VALUES[op], op),
      ];
    },
    outlets: [C('c', 'The generated picture.')],
    modes: SOURCE_MODES,
    emit: (c) => {
      const op = modeOf(c.node, SOURCES);
      const args = [
        c.read('p'),
        c.read('energy'),
        ...SOURCE_VALUES[op].map((name) => c.read(name)),
      ];
      return {
        c: `laid(gen_${op}(${args.join(', ')}), ${c.read('energy')})`,
      };
    },
  },

  field: {
    name: 'field',
    description:
      'A bounded procedural picture whose fixed work is charged before the graph reaches the GPU.',
    inlets: (node) => {
      const op = modeOf(node, FIELD_MODES);
      return [
        P('p', 'Where in the procedural field to read.'),
        ...valuePorts('field', FIELD_VALUES[op], op),
      ];
    },
    outlets: [C('c', 'The generated field picture.')],
    modes: FIELD_MODE_DOCUMENTATION,
    work: (node) => FIELD_WORK[modeOf(node, FIELD_MODES)],
    emit: (c) => {
      const op = modeOf(c.node, FIELD_MODES);
      const values = FIELD_VALUES[op];
      const args = [c.read('p'), c.read('energy'), ...values.map((name) => c.read(name))];
      return {
        c: `laid(field_${op}(${args.join(', ')}), ${c.read('energy')})`,
      };
    },
  },

  fractal: {
    name: 'fractal',
    description:
      'A bounded iterative picture with an explicit GPU budget, offered as Mandelbrot or Julia.',
    inlets: (node) => {
      const op = modeOf(node, FRACTAL_MODES);
      const values = FRACTAL_VALUES[op];
      return [
        P('p', 'Where in the fractal plane to read.'),
        ...valuePorts('fractal', values, op),
      ];
    },
    outlets: [C('c', 'The generated fractal picture.')],
    modes: FRACTAL_MODE_DOCUMENTATION,
    // Charged at the hard ceiling rather than at the current detail setting.
    // Detail is a uniform and may move without recompiling; accepting a graph
    // that is safe only while its control happens to be low would not be safe.
    work: FRACTAL_ITERATIONS,
    emit: (c) => {
      const op = modeOf(c.node, FRACTAL_MODES);
      const names = FRACTAL_VALUES[op];
      const value = (name: (typeof names)[number]) => c.read(name);
      const common = `${c.read('p')}, ${value('zoom')}, ${value('turn')}, ${value('detail')}`;
      const expression =
        op === 'julia'
          ? `fractalJulia(${common}, ${value('shape')}, ${c.read('energy')})`
          : `fractalMandelbrot(${common}, ${c.read('energy')})`;
      return { c: `laid(${expression}, ${c.read('energy')})` };
    },
  },

  light: {
    name: 'light',
    description:
      'A bounded 2D light hung in the frame — a lamp, a beam, shafts, or caustics — priced like a field.',
    inlets: (node) => {
      const op = modeOf(node, LIGHT_MODES);
      const hung = LIGHT_HUNG[op];
      return [
        P('p', 'Where in the frame the light is read.'),
        ...(hung ? [P('from', 'Where the light hangs.', hung)] : []),
        ...valuePorts('light', LIGHT_VALUES[op], op),
      ];
    },
    outlets: [C('c', 'The light, as a picture.')],
    modes: LIGHT_MODE_DOCUMENTATION,
    work: (node) => LIGHT_WORK[modeOf(node, LIGHT_MODES)],
    emit: (c) => {
      const op = modeOf(c.node, LIGHT_MODES);
      const args = [
        c.read('p'),
        ...(LIGHT_HUNG[op] ? [c.read('from')] : []),
        c.read('energy'),
        ...LIGHT_VALUES[op].map((name) => c.read(name)),
      ];
      return { c: `laid(light_${op}(${args.join(', ')}), ${c.read('energy')})` };
    },
  },

  video: VIDEO_NODE_SPEC,
  image: IMAGE_NODE_SPEC,
  glow: GLOW_NODE_SPEC,
  shade: SHADE_NODE_SPEC,
  figure: FIGURE_NODE_SPEC,
  array: ARRAY_NODE_SPEC,
  form: FORM_NODE_SPEC,

  last: {
    name: 'last',
    description: 'The frame this flow drew last time, fading as it ages.',
    inlets: [
      P('p', 'Where in the previous frame to read.'),
      N(
        'fade',
        'How long what was drawn survives, from a flicker to a couple of seconds.',
        0.45,
      ),
    ],
    outlets: [C('c', 'The previous frame, dimmed by its age.')],
    // One texture read, exactly like a video — and one buffer however many
    // `last` nodes a graph has, because they all read the same frame. There is
    // no ceiling on them for the same reason: a second one costs a sample, not
    // a decoder.
    work: 1,
    emit: (c) => ({ c: `fromLast(${c.read('p')}, ${c.read('fade')})` }),
  },

  tracks: {
    name: 'tracks',
    description:
      'Every playing track in the Live set, drawn in its assigned colour and mixed into one picture.',
    inlets: [P('p', 'Where in the combined set picture to read.')],
    outlets: [C('c', 'The combined picture of every playing track.')],
    modes: TRACK_DRAW_MODES,
    // A pass rather than an expression — see `shaders.ts`. All this does is
    // read the picture that pass left.
    emit: (c) => ({ c: `fromTracks(${c.read('p')})` }),
  },

  flow: {
    name: 'flow',
    description: 'Another saved flow, used whole as one picture inside this graph.',
    // `INNER` is the flattener's inlet, never a person's: `flatten` wires the
    // graph this node names into it, and the canvas hides any port whose name
    // starts with a tilde. It has to be a real inlet rather than a lookup on
    // the side, because reading it is how the point wired into `p` gets to act
    // on the whole sub-graph — without it the `p` cord was drawn and then
    // silently ignored, which is the worst thing a canvas can do.
    inlets: [
      P('p', 'Where in the nested flow to read.'),
      C(INNER, 'The nested flow output supplied internally by the compiler.'),
    ],
    outlets: [C('c', 'The picture produced by the nested flow.')],
    named: 'flow',
    // The whole node, and it is one line: read that graph, over there. An
    // unwired `p` falls back to the point being asked about, which is what
    // makes a nested flow with nothing wired into it behave exactly as if its
    // nodes had been pasted in.
    emit: (c) => ({ c: c.readAt(INNER, c.read('p')) }),
  },

  colorway: {
    name: 'colorway',
    description: 'The colourway that is up, as five colours named for the job each does.',
    // `paint`, which was this node with one outlet called `c` and a description
    // that said "the colourway's colour" while meaning the first of five. The
    // other four were unreachable from a graph: a flow drew from `colors[0]`
    // and every generator invented its second colour by mixing toward white or
    // toward its own complement. These outlets are the whole palette, so a
    // source can be told which colour to draw in rather than guessing.
    //
    // One `amount` for all five rather than one each. It is a master dim on
    // whatever you take out of here, which is what `paint`'s was; five would be
    // five controls on a node whose job is to hand out colours, and the graph
    // already has `grade` for dimming one of them on its own.
    inlets: [N('amount', 'The brightness and opacity of every colour taken from here.'), E()],
    outlets: COLOR_ROLES.map((role) => C(role, COLOR_ROLE_DETAILS[role])),
    emit: (c) => {
      const amount = `clamp(${c.read('amount')}, 0.0, 1.0)`;
      const energy = c.read('energy');
      return Object.fromEntries(
        COLOR_ROLES.map((role, i) => [
          role,
          `vec4(charge(uColors[${i}], ${energy}) * ${amount}, ${amount})`,
        ]),
      );
    },
  },

  lens: {
    name: 'lens',
    description:
      'Move the point a picture is read at, or apply a geometry effect at that moved point.',
    // `c` on a node somebody is using as geometry, and `p` on one somebody is
    // using as an effect. Neither is dead weight: which outlet you take is the
    // whole difference between the two, and a node with only one of them would
    // be two nodes again.
    inlets: (node) => {
      const op = modeOf(node, LENS_MODES);
      const values = LENS_VALUES[op as keyof typeof LENS_VALUES];
      return [
        P('p', 'The position to transform.'),
        C('c', 'The picture to read through the transformed position.'),
        ...valuePorts('lens', values, op),
      ];
    },
    outlets: [
      P('p', 'The transformed position.'),
      C('c', 'The input picture read at the transformed position.'),
    ],
    modes: LENS_MODE_DOCUMENTATION,
    // The `p` outlet cannot see the `c` inlet, and saying so is what makes a
    // lens feeding a picture that feeds the lens back a **legal** graph rather
    // than a refused one. See `wouldFeedItself`.
    reads: (node, outlet) => {
      const named = inletsOf(node).map((port) => port.name);
      return outlet === 'p' ? named.filter((name) => name !== 'c') : named;
    },
    emit: (c) => {
      const op = modeOf(c.node, LENS_MODES);
      const names = LENS_VALUES[op as keyof typeof LENS_VALUES];
      const moved = LENS_POINT[op](c, c.read('energy'), (i) =>
        names[i] ? c.read(names[i]) : '0.0',
      );
      // One outlet, and only the one asked for. Emitting the colour to fill a
      // cache slot nobody wanted sends the resolver back round a graph that was
      // never circular — and emitting the point beside it declares a line of
      // GLSL that nothing reads, which is a line off the budget for nothing.
      const one: Record<string, string> =
        c.outlet === 'p' ? { p: moved } : { c: c.readAt('c', moved) };
      return one;
    },
  },

  displace: {
    name: 'displace',
    description: 'Move the point by what a picture says, rather than by a fixed shape.',
    inlets: (node) => {
      const op = modeOf(node, DISPLACE_MODES);
      const values = DISPLACE_VALUES[op as keyof typeof DISPLACE_VALUES];
      return [
        P('p', 'The position to displace.'),
        C('field', 'The picture whose colour decides which way this point moves.'),
        ...valuePorts('displace', values, op),
      ];
    },
    outlets: [P('p', 'The displaced position.')],
    modes: DISPLACE_MODE_DOCUMENTATION,
    emit: (c) => {
      const op = modeOf(c.node, DISPLACE_MODES);
      const names = DISPLACE_VALUES[op as keyof typeof DISPLACE_VALUES];
      return { p: DISPLACE_POINT[op](c, (i) => (names[i] ? c.read(names[i]) : '0.0')) };
    },
  },

  place: {
    name: 'place',
    description: 'Turn horizontal and vertical numbers into one position in the frame.',
    // The one node in the vocabulary that makes a point out of nothing you were
    // handed, which is why it has no `p` inlet. `polar` takes a point apart and
    // this puts one together, so a pair of `lfo`s or a pair of meters can name
    // somewhere to read a picture — which nothing could say before.
    //
    // **Cartesian, and no polar mode.** Two numbers read as `radius` and
    // `angle` is a real second answer, but it is not a *mode* of this one: a
    // mode moves the inlets, and these two are the only inlets there are, so
    // flicking would cut every cord on the node. That is a change of wiring
    // rather than a change of mind, which is the line between a kind and a
    // mode here. See `docs/flows.md`.
    inlets: [
      N('x', 'The horizontal position: zero at the left, one at the right.'),
      N('y', 'The vertical position: zero at the bottom, one at the top.'),
    ],
    outlets: [P('p', 'The position described by x and y.')],
    // `recentred` and not a hand-written `(n - 0.5) * 2.0`, because the plane
    // is `vUv - 0.5` with the x scaled by the aspect — ±0.5 up and down, ±0.89
    // across on 16:9. Doubling about the middle overshoots both, by different
    // amounts, so the picture would sit in the middle half of the travel one
    // way and the middle 89% of it the other. Through the helper that already
    // knows the frame's shape, 0 and 1 are its own edges in both axes.
    emit: (c) => ({ p: `recentred(vec2(${c.read('x')}, ${c.read('y')}))` }),
  },

  polar: {
    name: 'polar',
    description: 'Split a position into its distance from the centre and direction around it.',
    inlets: [P('p', 'The position to measure from the centre.')],
    outlets: [
      N('radius', 'The distance from the centre, from zero to one.'),
      N('angle', 'The direction around the centre, wrapped from zero to one.'),
    ],
    emit: (c) => ({
      radius: `clamp(length(${c.read('p')}) * 1.6, 0.0, 1.0)`,
      angle: `(atan(${c.read('p')}.y, ${c.read('p')}.x) / 6.28318 + 0.5)`,
    }),
  },

  grade: {
    name: 'grade',
    description: 'Change the colour already at this point without moving the picture.',
    inlets: (node) => {
      const op = modeOf(node, GRADE_MODES);
      const values = GRADE_VALUES[op as keyof typeof GRADE_VALUES];
      return [
        C('c', 'The picture whose colours will be changed.'),
        ...valuePorts('grade', values, op),
      ];
    },
    outlets: [C('c', 'The colour-adjusted picture.')],
    modes: GRADE_MODE_DOCUMENTATION,
    emit: (c) => {
      const op = modeOf(c.node, GRADE_MODES);
      const names = GRADE_VALUES[op as keyof typeof GRADE_VALUES];
      return {
        c: GRADE_EMIT[op](c, c.read('energy'), (i) => (names[i] ? c.read(names[i]) : '0.0')),
      };
    },
  },

  spread: {
    name: 'spread',
    description:
      'Read the picture several times around each point to blur, bloom, outline, or split it.',
    inlets: (node) => {
      const op = modeOf(node, SPREAD_MODES);
      const values = SPREAD_VALUES[op as keyof typeof SPREAD_VALUES];
      return [
        C('c', 'The picture to sample around each point.'),
        ...valuePorts('spread', values, op),
      ];
    },
    outlets: [C('c', 'The picture made from the surrounding samples.')],
    modes: SPREAD_MODE_DOCUMENTATION,
    emit: (c) => {
      const op = modeOf(c.node, SPREAD_MODES);
      const names = SPREAD_VALUES[op as keyof typeof SPREAD_VALUES];
      return {
        c: SPREAD_EMIT[op](c, c.read('energy'), (i) => (names[i] ? c.read(names[i]) : '0.0')),
      };
    },
  },

  halftone: {
    name: 'halftone',
    description: 'Throw brightness away in a pattern that keeps the picture readable.',
    inlets: (node) => {
      const op = modeOf(node, HALFTONE_MODES);
      const values = HALFTONE_VALUES[op as keyof typeof HALFTONE_VALUES];
      return [
        C('c', 'The picture to reduce to a pattern.'),
        ...valuePorts('halftone', values, op),
      ];
    },
    outlets: [C('c', 'The patterned picture, transparent between its marks.')],
    modes: HALFTONE_MODE_DOCUMENTATION,
    emit: (c) => {
      const op = modeOf(c.node, HALFTONE_MODES);
      const names = HALFTONE_VALUES[op as keyof typeof HALFTONE_VALUES];
      return { c: HALFTONE_EMIT[op](c, (i) => (names[i] ? c.read(names[i]) : '0.0')) };
    },
  },

  blend: {
    name: 'blend',
    description: 'Combine a base picture and a top picture into one frame.',
    /**
     * Every mode keeps all three inlets. What the mode moves is what the top
     * inlet answers **when nothing is wired to it**, and it has to move,
     * because an unwired inlet is a no-op in this vocabulary and the identity
     * of a carve is not the identity of a sum.
     *
     * Nothing on top is nothing added, nothing screened and nothing multiplied
     * — all of which are `vec4(0.0)`. But nothing on top of a `stencil` is a
     * mask that lets everything through, which is white, and nothing on top of
     * a `cut` is a mask that takes nothing away, which is black. Left at zero,
     * a fresh `stencil` would black the frame the moment it was dropped and
     * read as a node that had come unhooked, which is the exact complaint that
     * fixed `multiply`.
     */
    inlets: (node) => [
      C('base', 'The picture underneath.'),
      C(
        'top',
        'The picture placed over, combined with, or carved out of the base.',
        node.op === 'stencil' ? 'vec4(1.0)' : node.op === 'cut' ? 'vec4(0.0, 0.0, 0.0, 1.0)' : 'vec4(0.0)',
      ),
      N('amount', 'How much of the blended result replaces the base.', 1),
    ],
    outlets: [C('c', 'The combined picture.')],
    modes: BLEND_MODES,
    emit: (c) => {
      const mix = MIXES[c.node.op ?? 'over'] ?? MIXES.over;
      return { c: `mix(${c.read('base')}, ${mix(c.read('base'), c.read('top'))}, ${c.read('amount')})` };
    },
  },

  math: {
    name: 'math',
    description: 'Combine two numbers with one arithmetic operation.',
    inlets: [
      N('a', 'The first number in the operation.'),
      N('b', 'The second number in the operation.'),
    ],
    outlets: [N('n', 'The result of the selected operation.')],
    modes: MATH_MODES,
    emit: (c) => {
      const op = MATH[c.node.op ?? 'add'] ?? MATH.add;
      return { n: op(c.read('a'), c.read('b')) };
    },
  },

  read: {
    name: 'read',
    description: 'Take one number off a picture, so what is drawn can drive what happens next.',
    inlets: [
      C('c', 'The picture to measure.'),
      P('p', 'Where in the picture to measure. The point being drawn, unwired.'),
    ],
    outlets: [N('n', 'The measured number, from zero to one.')],
    modes: READ_MODES,
    emit: (c) => {
      const op = modeOf(c.node, READ_NAMES);
      return { n: READ_EMIT[op](c.readAt('c', c.read('p'))) };
    },
  },

  lfo: LFO_NODE_SPEC,

  give: {
    name: 'give',
    description:
      'A signal this flow hands out. Used inside another flow, it becomes a named outlet on that face.',
    inlets: (node) => {
      const kind = GIVE_KINDS[modeOf(node, GIVE_MODE_NAMES)];
      return kind === 'n'
        ? [{ name: 'in', kind, description: 'The number this flow gives.' }]
        : kind === 'p'
          ? [P('in', 'The point this flow gives.')]
          : [C('in', 'The picture this flow gives.')];
    },
    outlets: [],
    modes: GIVE_MODES,
    // A door, not a picture: nothing inside this flow reads it, so it emits
    // nothing. The flattener wires the parent's readers straight to whatever
    // feeds it.
    emit: () => ({}),
  },

  out: {
    name: 'out',
    description: 'The finished picture that leaves this flow for the wall or another flow.',
    inlets: [C('c', 'The finished picture this flow produces.')],
    outlets: [],
    emit: () => ({}),
  },
};

/** A node's inlets, whichever way its spec declares them. */
export function inletsOf(node: CircuitNode): readonly PortSpec[] {
  const spec = NODE_SPECS[node.kind];
  return typeof spec.inlets === 'function' ? spec.inlets(node) : spec.inlets;
}

/** GLSL types, by signal. */
const TYPES: Record<Signal, string> = { p: 'vec2', n: 'float', c: 'vec4' };

/**
 * One number riding the bank: a `value` node, or an inlet somebody set.
 *
 * Both are the same thing to the shader and to the cache — a float in
 * `uParams` that can be turned without recompiling — so they are one list and
 * one bank rather than two of each. What tells them apart is the `id`: a node
 * id for a `value` node, a `nodeId/inlet` address for a number set on an inlet.
 */
export interface CircuitValue {
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

export interface CircuitVideo {
  id: string;
  asset: string;
  mode: (typeof VIDEO_MODES)[number];
  index: number;
}

export interface CircuitImage {
  id: string;
  asset: string;
  mode: (typeof IMAGE_MODES)[number];
  index: number;
}

export interface Compiled {
  source: string | null;
  error: string | null;
  values: CircuitValue[];
  tracks: CircuitTrack[];
  /** Reachable disk videos, in their fixed two texture slots. */
  videos: CircuitVideo[];
  /** Reachable still images, in their fixed four texture slots. */
  images: CircuitImage[];
  /** How each Live track should draw, if this flow asked for the set at all. */
  draws: string | null;
  /**
   * Whether anything in the flattened graph reads the previous frame.
   *
   * A fact about the graph rather than about the destination, and the only one
   * a caller needs in order to know whether to keep a history buffer for it.
   * Every `last` node in a flow reads the same frame, so this is a yes or a no
   * and never a count.
   */
  feedback: boolean;
  /**
   * Charged fixed work in this shader, against `MAX_SHADER_WORK`.
   *
   * Already counted to enforce the ceiling; published because it is the
   * compiler's own prediction of what a flow costs, and `tools/benchmark.ts`
   * measures what it actually costs. A model nobody checks against a
   * measurement is a model that drifts.
   */
  work: number;
}

/**
 * How many numbers one flow may set.
 *
 * Not the size of the bank — the bank is cut to fit the graph, because the
 * shader is generated. This is the backstop, and what it is protecting is the
 * driver: a bank is a uniform array, a fragment shader has a floor on how many
 * uniform vectors it is guaranteed, and a float array is the packing that eats
 * them fastest. Sixty-four is far more numbers than a graph anyone can read has,
 * and well under what the smallest WebGL2 implementation promises.
 */
export const MAX_VALUES = 64;

/** At most eight named tracks: the bank is a fixed-size uniform array. */
export const MAX_TRACKS = 8;

/** Two decoders/textures is the initial hard ceiling for one flattened flow. */
export const MAX_VIDEOS = 2;

/** Four persistent textures is the hard ceiling for one flattened flow. */
export const MAX_IMAGES = 4;

/**
 * How many GLSL statements a flow may emit.
 *
 * The backstop on multi-tap nesting. A `bloom` over a `smear` evaluates its
 * input forty-eight times, and two more of those is a shader that takes a
 * second to compile and a frame to draw. Refusing by name is much kinder than
 * letting the driver stall — and the number is high enough that no sane graph
 * reaches it.
 */
export const MAX_LINES = 2000;

/**
 * Worst-case fixed shader work a fragment may be asked to perform.
 *
 * Two full-detail fractals may be blended. Bounded procedural fields share the
 * same budget. A spread over an expensive picture is refused when its
 * three-to-nine reads would multiply hidden loops or samples while still
 * looking like only a handful of generated GLSL statements to `MAX_LINES`.
 */
export const MAX_SHADER_WORK = FRACTAL_ITERATIONS * 2;

/** Compatibility name for callers that predate bounded procedural fields. */
export const MAX_ITERATIVE_WORK = MAX_SHADER_WORK;

/** The outlets of this node that depend on that inlet. */
function outletsReading(node: CircuitNode, inlet: string): string[] {
  const spec = NODE_SPECS[node.kind];
  return spec.outlets
    .map((port) => port.name)
    .filter((name) => (spec.reads?.(node, name) ?? inletsOf(node).map((p) => p.name)).includes(inlet));
}

/** A port address, as cords name it. */
export function portId(node: string, port: string): string {
  return `${node}/${port}`;
}

export function splitPort(id: string): { node: string; port: string } {
  const at = id.lastIndexOf('/');
  return at < 0 ? { node: id, port: '' } : { node: id.slice(0, at), port: id.slice(at + 1) };
}

/** What a port carries, for a canvas that colours cords and refuses bad ones. */
export function signalOf(
  circuit: Circuit,
  id: string,
  flows?: Readonly<Record<string, FlowDef>>,
): Signal | null {
  const { node, port } = splitPort(id);
  const held = circuit.nodes.find((n) => n.id === node);
  if (!held) return null;
  const spec = NODE_SPECS[held.kind];
  const found =
    inletsOf(held).find((p) => p.name === port) ?? spec.outlets.find((p) => p.name === port);
  if (found) return found.kind;
  // A flow node's doors, when the canvas can see the flow it names.
  if (held.kind === 'flow' && flows) {
    const def = flows[held.op ?? ''];
    if (!def) return null;
    const doors = flowDoors(def);
    const door =
      doors.takes.find((d) => d.name === port) ?? doors.gives.find((d) => d.name === port);
    return door?.kind ?? null;
  }
  return null;
}

/**
 * Whether anything at all is wired to `out`.
 *
 * A flow that has nothing on it compiles, and deliberately: it draws transparent
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

/** The inlets of this node that outlet depends on. The inverse of `outletsReading`. */
function inletsRead(node: CircuitNode, outlet: string): readonly string[] {
  const spec = NODE_SPECS[node.kind];
  return spec.reads?.(node, outlet) ?? inletsOf(node).map((port) => port.name);
}

/**
 * Every node whose work reaches a door out of this flow.
 *
 * A door is `out`'s inlet or a `give`'s: those are the only two ways a picture
 * or a number leaves, and a provider flow that ends in `give` is as finished as
 * a top-level one that ends in `out`. A node this set omits contributes nothing
 * to what the flow draws or hands over.
 *
 * Backwards, port to port, for the reason [`wouldFeedItself`] walks forwards
 * that way: a node is not one thing. `lens` hands back a point that never
 * looked at its colour, so a picture wired into a lens whose *point* outlet is
 * the only one anybody reads is genuinely doing nothing, and node-to-node
 * reachability would call it live. `reads` is the same table both directions
 * consult, so the two walks cannot disagree about what depends on what.
 *
 * A graph with no door at all has no live nodes, which is the honest answer
 * rather than a special case: nothing in it reaches anywhere. Callers that
 * want to say something kinder about an empty canvas have `reachesOut`.
 */
export function liveNodes(circuit: Circuit): Set<string> {
  const byId = new Map(circuit.nodes.map((node) => [node.id, node]));
  const feeding = new Map<string, string[]>();
  for (const cord of circuit.cords) {
    feeding.set(cord.to, [...(feeding.get(cord.to) ?? []), cord.from]);
  }

  const live = new Set<string>();
  const seen = new Set<string>();
  const queue: string[] = [];

  const wantInlet = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    queue.push(id);
  };

  for (const node of circuit.nodes) {
    if (node.kind !== 'out' && node.kind !== 'give') continue;
    live.add(node.id);
    for (const port of inletsOf(node)) wantInlet(portId(node.id, port.name));
  }

  while (queue.length > 0) {
    const inlet = queue.pop()!;
    for (const outlet of feeding.get(inlet) ?? []) {
      const { node: id, port } = splitPort(outlet);
      const node = byId.get(id);
      if (!node) continue;
      live.add(id);
      for (const name of inletsRead(node, port)) wantInlet(portId(id, name));
    }
  }
  return live;
}

/**
 * The nodes `liveNodes` leaves out, in the order the circuit lists them.
 *
 * Two callers want opposite things from this one fact. The editor names them
 * so a branch that stopped short is easy to find and finish — never a refusal,
 * because a graph on its way to being wired is stranded almost continuously.
 * The lab refuses a *candidate* that has any, because a stranded branch draws
 * nothing: the picture is identical to the same graph without it, so admitting
 * one means a second id, a second dot and a second comparison for a work
 * already in the corpus.
 */
export function strandedNodes(circuit: Circuit): string[] {
  const live = liveNodes(circuit);
  return circuit.nodes.filter((node) => !live.has(node.id)).map((node) => node.id);
}

/**
 * Whether wiring this outlet into that inlet would make the graph eat itself.
 *
 * The same argument [`wouldLoop`](../../protocol.ts) makes about a flow inside a
 * flow, one level down. The compiler refuses a loop by name, but the honest
 * message it can give is about a node rather than about the cord you were
 * holding — and by then the whole flow has gone black. Refusing at the moment of
 * dropping is a sentence about the thing just clicked.
 */
export function wouldFeedItself(circuit: Circuit, from: string, to: string): boolean {
  const byId = new Map(circuit.nodes.map((node) => [node.id, node]));
  const onward = new Map<string, string[]>();
  for (const cord of circuit.cords) {
    onward.set(cord.from, [...(onward.get(cord.from) ?? []), cord.to]);
  }
  const seen = new Set<string>();
  /**
   * Forward from an inlet: through its node to the outlets that **read** it,
   * and on along whatever those feed.
   *
   * Port to port rather than node to node, which is what `lens` forced and what
   * was always more honest. A node is not one thing that everything inside it
   * depends on — `lens` hands back a point that never looked at its colour, and
   * `polar` hands back two numbers — so asking "can this node reach that node"
   * refuses graphs that terminate perfectly well.
   */
  const walk = (inlet: string): boolean => {
    if (seen.has(inlet)) return false;
    seen.add(inlet);
    const { node: id, port } = splitPort(inlet);
    const node = byId.get(id);
    if (!node) return false;
    for (const outlet of outletsReading(node, port)) {
      const at = portId(id, outlet);
      if (at === from) return true;
      for (const next of onward.get(at) ?? []) if (walk(next)) return true;
    }
    return false;
  };
  return walk(to);
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
 * *file this app wrote* can contain: an `effect` node's inlets are its mode's, so
 * a scheme saved before a mode was changed can carry a cord addressed to an
 * inlet that no longer exists. The compiler ignores those, which is worse than
 * it sounds — the canvas cannot draw a cord to a port that is not mounted, so
 * what you see is an outlet lit up with no wire leaving it.
 *
 * A **value** addressed to an inlet that is not there is the same thing one
 * step quieter, and it comes through the same door for the same reason.
 */
export function repaired(circuit: Circuit, flows?: Readonly<Record<string, FlowDef>>): Circuit {
  const ends = circuit.nodes.filter((node) => node.kind === 'out');
  // The one with something wired to it, so a file with two of them keeps the
  // one that was drawing rather than the one that happened to be written first.
  // A file with none keeps none: a flow with no out is a provider, not a
  // mistake to paper over.
  const fed = new Set(circuit.cords.map((cord) => splitPort(cord.to).node));
  const keep = ends.find((node) => fed.has(node.id)) ?? ends[0];

  const nodes = circuit.nodes
    .filter((node) => node.kind !== 'out' || node.id === keep?.id)
    .map(keepValues);

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const kept = new Map<string, CircuitCordLike>();
  for (const cord of circuit.cords) {
    const from = splitPort(cord.from);
    const to = splitPort(cord.to);
    const source = byId.get(from.node);
    const sink = byId.get(to.node);
    if (!source || !sink) continue;
    if (signalOfPort(source, from.port, flows, 'out') === null) continue;
    if (signalOfPort(sink, to.port, flows, 'in') === null) continue;
    // An inlet takes one thing, which is the rule `connect` keeps and the rule
    // the compiler resolves by. A file naming two is saying the later one.
    kept.set(cord.to, { from: cord.from, to: cord.to });
  }
  return { nodes, cords: [...kept.values()] };
}

/**
 * What one side of one node's port carries, doors included.
 *
 * The one place a flow node's ports are more than its spec: the flow it names
 * may take and give, and a cord landing on one of those doors is as real as a
 * cord landing on `p`. Without the flows record the doors cannot be seen, and
 * a door cord is kept on trust rather than stripped — a cord a repair cannot
 * check is not a cord it should delete.
 */
function signalOfPort(
  node: CircuitNode,
  port: string,
  flows: Readonly<Record<string, FlowDef>> | undefined,
  side: 'in' | 'out',
): Signal | null {
  const spec = NODE_SPECS[node.kind];
  const found =
    side === 'in'
      ? inletsOf(node).find((p) => p.name === port)
      : spec.outlets.find((p) => p.name === port);
  if (found) return found.kind;
  if (node.kind !== 'flow') return null;
  const def = flows?.[node.op ?? ''];
  // No record, or a flow that is gone: the doors cannot be seen, so a door
  // cord is kept on trust — deleting a flow should quiet what used it, not
  // strip its wiring so it cannot come back.
  if (!def) return 'n';
  const doors = flowDoors(def);
  const door =
    side === 'in'
      ? doors.takes.find((d) => d.name === port)
      : doors.gives.find((d) => d.name === port);
  return door?.kind ?? null;
}

/**
 * Every `track` node, in the order they take slots in the one bank.
 *
 * One bank rather than two, which is what merging `energy` into `track` bought:
 * the CPU fills each slot with whatever that node asked for — a meter, a fader,
 * a gate, any of them through an envelope — and the shader reads a number
 * without learning which. Two banks meant a flow could name eight tracks *and*
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
      smooth: node.smooth ?? 0,
    }));

/**
 * Every number riding `uParams`, in the order the shader reads them.
 *
 * Walked in node order and, within a node, in inlet order, so the bank a graph
 * produces is a function of the graph rather than of the order somebody
 * happened to turn things. `paramsOf` and the compiler both call this, which is
 * what keeps the slot a number was compiled into and the slot it is written to
 * the same one.
 *
 * **A wired inlet's value is not in here.** The cord decides what that inlet
 * reads, so the stored number is dormant — kept on the node so unwiring gives
 * it back, but costing no slot while a cord is on top of it.
 */
/**
 * Where an inlet's depth rides, given where its value rides.
 *
 * A suffix rather than a second map, so one list still describes the whole
 * bank and everything downstream of it — the size, the writes, the trimming —
 * keeps working without learning that some entries come in pairs. `/` is
 * already the separator inside a port address, so nothing a person can type
 * collides with this.
 */
export function depthId(port: string): string {
  return `${port}/~depth`;
}

export function valuesOf(circuit: Circuit): CircuitValue[] {
  const wired = new Set(circuit.cords.map((cord) => cord.to));
  const values: CircuitValue[] = [];
  for (const node of circuit.nodes) {
    // A `take` inside its own flow is a `value` wearing a door's name: it
    // holds a slot so its number can be turned live, until a parent supplies
    // it and the flattener swaps it out entirely.
    if (node.kind === 'value' || node.kind === 'take') {
      values.push({
        id: node.id,
        label: node.label || `value ${values.length + 1}`,
        index: values.length,
        value: node.value ?? 0.5,
      });
      continue;
    }
    for (const port of inletsOf(node)) {
      // Every number inlet, the live ones included: an unwired `energy` with a
      // held number reads that number from the bank, and without one it stays
      // on its live fallback and costs nothing.
      if (port.kind !== 'n') continue;
      const id = portId(node.id, port.name);
      const held = node.values?.[port.name];
      if (!wired.has(id)) {
        if (held === undefined) continue;
        values.push({ id, label: port.name, index: values.length, value: held });
        continue;
      }
      // A wired inlet sitting at zero with a full depth *is* a cord that
      // replaces its inlet, so it costs no slot and compiles to what it always
      // compiled to. Give it either half of a range and it takes a pair, both
      // riding `uParams` so that turning one is never a recompile — and both
      // together, so the pair a shader was built around cannot half-vanish.
      const base = held ?? 0;
      const depth = node.depths?.[port.name] ?? 1;
      if (base === 0 && depth === 1) continue;
      values.push({ id, label: port.name, index: values.length, value: base });
      values.push({
        id: depthId(id),
        label: `${port.name} depth`,
        index: values.length,
        value: depth,
      });
    }
  }
  return values;
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
 * share a `reach`, and it is the same number in both.
 */
export function keepValues(node: CircuitNode): CircuitNode {
  // A flow node's number inlets are the takes of the flow it names, which this
  // walk cannot see. Its held numbers are kept whole rather than guessed at —
  // a stale one is dormant and invisible, the same kindness a cord gets.
  if (node.kind === 'flow') return node;
  const numbered = new Set(
    inletsOf(node)
      .filter((port) => port.kind === 'n')
      .map((port) => port.name),
  );
  let out = trimmed(node, 'values', numbered);
  out = trimmed(out, 'depths', numbered);
  return out;
}

/**
 * One of a node's number maps, with every name no inlet answers to dropped.
 *
 * Both maps are keyed by inlet name and both go stale the same way — a mode
 * change moves the inlets out from under them — so they are trimmed by the
 * same walk rather than by two that could drift apart.
 */
function trimmed(
  node: CircuitNode,
  field: 'values' | 'depths',
  numbered: ReadonlySet<string>,
): CircuitNode {
  const held = node[field];
  if (!held) return node;
  const kept: Record<string, number> = {};
  for (const [name, value] of Object.entries(held)) {
    if (numbered.has(name)) kept[name] = value;
  }
  if (Object.keys(kept).length === Object.keys(held).length) return node;
  if (Object.keys(kept).length > 0) return { ...node, [field]: kept };
  // The field goes rather than emptying, because `scheme.json` is a file
  // somebody reads and diffs, and an empty map on every node it ever touched
  // is a page of noise saying nothing.
  const bare = { ...node };
  delete bare[field];
  return bare;
}

/**
 * A flow and everything it contains, as one graph.
 *
 * The graph a `flow` node names is **pasted in around it**, with every id
 * prefixed so two copies of the same flow cannot collide. Expanding before
 * compiling rather than teaching the compiler about sub-flows is what keeps the
 * compiler one thing: set numbers and named tracks both get their bank slots
 * from the expanded graph without anyone writing a second pass to gather them.
 *
 * **Around it, not in place of it.** The node survives, holding the sub-graph on
 * its reserved inlet, because a flow node has a point inlet and a point inlet
 * has to be able to do something: reading a whole sub-flow somewhere other than
 * here is only expressible if there is still a node to do the reading. Splicing
 * the node out left that cord pointing at an address nothing looked up, so it
 * drew on the canvas and changed nothing on the wall.
 *
 * A flow that cannot be found is dropped rather than refused — a flow you
 * deleted should make the thing that used it go quiet, not stop the show.
 */
/**
 * One door on a flow, read as a port for the `flow` node that names it.
 */
export interface FlowDoor {
  /** The door's label, which is the port's name on the parent face. */
  name: string;
  kind: Signal;
  /** A take's resting number, for the parent face's fader. */
  at?: number;
  /** The door node's id inside its own flow, for the flattener. */
  nodeId: string;
  description: string;
}

/**
 * The doors on a flow: the numbers it takes, and the signals it gives.
 *
 * These are its `take` and `give` nodes, read as the interface a `flow` node
 * wears — an inlet per named take, an outlet per named give. The label is the
 * port name, so a door with no label is no door yet; a name the flow node
 * already owns (`p` among the takes, `c` among the gives, anything starting
 * `~`) is shadowed and skipped; and the first door to claim a name keeps it.
 */
export function flowDoors(def: FlowDef): { takes: FlowDoor[]; gives: FlowDoor[] } {
  const takes: FlowDoor[] = [];
  const gives: FlowDoor[] = [];
  const claimedIn = new Set<string>();
  const claimedOut = new Set<string>();
  for (const node of def.circuit.nodes) {
    if (node.kind !== 'take' && node.kind !== 'give') continue;
    const name = (node.label ?? '').trim();
    if (!name || name.startsWith('~')) continue;
    if (node.kind === 'take') {
      if (name === 'p' || claimedIn.has(name)) continue;
      claimedIn.add(name);
      takes.push({
        name,
        kind: 'n',
        at: node.value ?? 0.5,
        nodeId: node.id,
        description: `The ${name} this flow takes.`,
      });
    } else {
      if (name === 'c' || claimedOut.has(name)) continue;
      claimedOut.add(name);
      gives.push({
        name,
        kind: GIVE_KINDS[modeOf(node, GIVE_MODE_NAMES)],
        nodeId: node.id,
        description: `The ${name} this flow gives.`,
      });
    }
  }
  return { takes, gives };
}

export function flatten(
  flows: Record<string, FlowDef>,
  id: string,
  prefix = '',
  seen: readonly string[] = [],
): { circuit: Circuit; error: string | null } {
  const def = flows[id];
  if (!def) return { circuit: { nodes: [], cords: [] }, error: null };
  if (seen.includes(id)) {
    return { circuit: { nodes: [], cords: [] }, error: `${def.name || id} contains itself` };
  }

  const nodes: CircuitNode[] = [];
  const cords: CircuitCordLike[] = [];
  let error: string | null = null;

  /** This graph's own cords, prefixed up front so a door can rewrite an end. */
  const own: CircuitCordLike[] = def.circuit.cords.map((cord) => ({
    from: `${prefix}${cord.from}`,
    to: `${prefix}${cord.to}`,
  }));
  /**
   * Reads of a nested flow's gives, redirected to what feeds them inside.
   * An entry of `null` is a give with nothing behind it: the cord goes, and
   * the reader falls back exactly as it does on any unwired inlet.
   */
  const givenFrom = new Map<string, string | null>();

  for (const node of def.circuit.nodes) {
    const here = `${prefix}${node.id}`;
    nodes.push({ ...node, id: here });
    if (node.kind !== 'flow') continue;

    const inner = flatten(flows, node.op ?? '', `${here}~`, [...seen, id]);
    error ??= inner.error;
    // The sub-flow's own `out` is not an out any more; it is the junction this
    // node reads, so whatever fed it lands on the reserved inlet instead.
    const end = inner.circuit.nodes.find((n) => n.kind === 'out');
    const from = end ? feedOf(inner.circuit, portId(end.id, 'c')) : null;

    const doors = flows[node.op ?? ''] ? flowDoors(flows[node.op ?? '']) : null;
    /** A supplied take vanishes; its readers take the parent's cord instead. */
    const takeFeeds = new Map<string, string>();
    /** Every door that vanishes here, so its cords vanish with it. */
    const dropped = new Set<string>();
    for (const door of doors?.takes ?? []) {
      const pasted = `${here}~${door.nodeId}`;
      const source = feedOf({ cords: own }, portId(here, door.name));
      if (source) {
        takeFeeds.set(pasted, source);
        dropped.add(pasted);
      }
    }
    for (const door of doors?.gives ?? []) {
      const pasted = `${here}~${door.nodeId}`;
      givenFrom.set(portId(here, door.name), feedOf(inner.circuit, portId(pasted, 'in')));
      dropped.add(pasted);
    }

    for (const each of inner.circuit.nodes) {
      if (each.kind === 'out' || dropped.has(each.id)) continue;
      if (each.kind === 'take') {
        // An unsupplied take stands, holding the number the parent face set
        // on it — or its own, the same order every settable inlet answers in.
        const door = doors?.takes.find((d) => `${here}~${d.nodeId}` === each.id);
        if (door) {
          nodes.push({ ...each, value: node.values?.[door.name] ?? each.value });
          continue;
        }
      }
      nodes.push(each);
    }
    for (const cord of inner.circuit.cords) {
      if (end && splitPort(cord.to).node === end.id) continue;
      if (dropped.has(splitPort(cord.to).node)) continue;
      const source = takeFeeds.get(splitPort(cord.from).node);
      cords.push(source ? { from: source, to: cord.to } : cord);
    }
    if (from) cords.push({ from, to: portId(here, INNER) });
  }

  for (const cord of own) {
    const redirected = givenFrom.get(cord.from);
    if (redirected === null) continue;
    cords.push(redirected === undefined ? cord : { from: redirected, to: cord.to });
  }

  return { circuit: { nodes, cords }, error };
}

type CircuitCordLike = { from: string; to: string };

function feedOf(circuit: { cords: readonly CircuitCordLike[] }, inlet: string): string | null {
  for (const cord of circuit.cords) if (cord.to === inlet) return cord.from;
  return null;
}

/**
 * A flow to a fragment shader, or the reason it isn't one.
 *
 * Only what `out` can reach is emitted. A node wired to nothing costs nothing,
 * which matters more than it sounds: building one of these means dropping a node
 * and looking at it, and a compiler that treated an unwired node as an error
 * would make the canvas unusable for exactly the way it gets used.
 */
export interface CompileOptions {
  /** Development-only substitutions used by the response calibration bench. */
  responses?: ResponseOverrides;
}

export function compileFlow(
  flows: Record<string, FlowDef>,
  id: string,
  options: CompileOptions = {},
): Compiled {
  const expanded = flatten(flows, id);
  const empty: Compiled = {
    source: null,
    error: expanded.error,
    feedback: false,
    work: 0,
    values: [],
    tracks: [],
    videos: [],
    images: [],
    draws: null,
  };
  if (expanded.error) return empty;
  return compileCircuit(expanded.circuit, options);
}

export function compileCircuit(circuit: Circuit, options: CompileOptions = {}): Compiled {
  const values = valuesOf(circuit);
  const tracks = tracksOf(circuit);
  const drawn = circuit.nodes.find((node) => node.kind === 'tracks');
  const draws = drawn ? (drawn.op ?? TRACK_DRAWS[0]) : null;
  const bare: Compiled = {
    source: null,
    error: null,
    values,
    tracks,
    videos: [],
    images: [],
    draws,
    feedback: false,
    work: 0,
  };
  let feedback = false;

  const byId = new Map(circuit.nodes.map((node) => [node.id, node]));
  const slot = new Map(values.map((each) => [each.id, each.index]));
  const trackSlot = new Map(tracks.map((track) => [track.id, track.index]));
  const videoSlot = new Map<string, number>();
  const usedVideos: CircuitVideo[] = [];
  const imageSlot = new Map<string, number>();
  const usedImages: CircuitImage[] = [];

  // At most one. A flow with no `out` at all is legal now — a provider, whose
  // doors are `give` nodes and whose picture is honestly nothing — so only the
  // two-out file is refused, and `repaired` collapses that at the door anyway.
  const ends = circuit.nodes.filter((node) => node.kind === 'out');
  if (ends.length > 1) return { ...bare, error: 'more than one out node' };
  if (values.length > MAX_VALUES) {
    return { ...bare, error: `more than ${MAX_VALUES} numbers set` };
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
  let shaderWork = 0;

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
    // The **outlet**, not the node, and not the node at this point.
    //
    // By the node was right until `lens` had two outlets: its point never flows
    // at its colour, so a lens feeding a picture that feeds the lens back is a
    // graph that terminates, and a node-wide guard refused it. By outlet the
    // set is still finite — two entries for a lens — so it still terminates,
    // and it still catches every real loop, because a colour that comes back
    // round reaches the same outlet with that outlet already open.
    //
    // Not by the *point*, which was the tempting third option and caught
    // nothing at all: the point expression grows on every trip round a loop and
    // never repeats, so the descent ran until the stack gave out — which
    // reaches a person as a page that has stopped rather than as a sentence
    // about their wiring.
    const here = portId(nodeId, port);
    if (open.has(here)) {
      failed ??= `${spec.name} feeds itself — a flow cannot loop`;
      return null;
    }
    if (lines.length > MAX_LINES) {
      failed ??= 'too big to draw — an effect that takes many samples is nested too deep';
      return null;
    }
    if (node.kind === 'last') feedback = true;
    shaderWork += typeof spec.work === 'function' ? spec.work(node) : (spec.work ?? 0);
    if (shaderWork > MAX_SHADER_WORK) {
      failed ??= 'too expensive to draw — a costly picture is being sampled too many times';
      return null;
    }
    open.add(here);
    // Named once for the nested inlet readers; function declarations do not
    // retain the map lookup's narrowing even though they only run in this call.
    const subject = node;

    /**
     * What an inlet reads with nothing wired to it: the number somebody set,
     * or the answer its spec came with.
     *
     * A set value is a **slot**, never the number itself. Writing `0.62` into
     * the source would make every one of these a recompile — `signatureOf`
     * leaves the values out precisely so that dragging one does not rebuild the
     * shader sixty times a second, and an inlined constant hands that back at
     * every inlet on the canvas.
     */
    function answer(port: PortSpec, where: string): string {
      const held = slot.get(portId(nodeId, port.name));
      if (held !== undefined) return `uParams[${held}]`;
      // A follower with nothing of its own reads its named sibling — through
      // that inlet's own cord or held number, so `columns` follows whatever
      // `energy` is actually doing rather than the raw room uniform.
      if (port.fallbackInlet !== undefined) return readRawAt(port.fallbackInlet, where);
      return port.fallback ?? (port.kind === 'p' ? where : '0.0');
    }

    function readRawAt(inlet: string, where: string): string {
      const wanted = inletsOf(subject).find((p) => p.name === inlet);
      if (!wanted) return '0.0';
      const id = portId(nodeId, inlet);
      const from = feeds.get(id);
      if (!from) return answer(wanted, where);
      const source = splitPort(from);
      const signal = resolve(source.node, source.port, wanted.kind, where);
      if (signal === null) return answer(wanted, where);
      // A cord into a number is scaled and offset by the pair the inlet holds,
      // rather than replacing it. A point and a colour have no such pair —
      // there is no one control shape for either and nothing sensible to
      // multiply — so they arrive as they left.
      if (wanted.kind !== 'n') return signal;
      const base = slot.get(id);
      const depth = slot.get(depthId(id));
      if (base === undefined || depth === undefined) return signal;
      // Clamped here rather than where it is set, so a depth can be carried
      // past the end of the range and still mean something when the value
      // moves back under it. Bitwig's rule, and it is the one that makes a
      // range you set once survive being slid around.
      return `clamp(uParams[${base}] + uParams[${depth}] * ${signal}, 0.0, 1.0)`;
    }

    function readAt(inlet: string, where: string): string {
      const wanted = inletsOf(subject).find((p) => p.name === inlet);
      if (!wanted) return '0.0';
      const raw = readRawAt(inlet, where);
      if (wanted.kind !== 'n') return raw;
      const mode = subject.op ?? '';
      const target = { kind: subject.kind, mode, inlet };
      const response =
        options.responses?.[responseKey(target)] ?? wanted.response ?? productionResponse(target);
      return response ? responseGlsl(response, raw) : raw;
    }

    const ctx: Emitting = {
      at,
      outlet: port,
      node,
      read: (inlet) => readAt(inlet, at),
      readAt,
    };

    const emitted =
      node.kind === 'value' || node.kind === 'take'
        ? { n: `uParams[${slot.get(node.id) ?? 0}]` }
        : node.kind === 'track'
          ? { n: `uTracks[${trackSlot.get(node.id) ?? 0}]` }
          : node.kind === 'video'
            ? (() => {
                let index = videoSlot.get(node.id);
                if (index === undefined) {
                  index = usedVideos.length;
                  if (index >= MAX_VIDEOS) {
                    failed ??= `more than ${MAX_VIDEOS} reachable video nodes`;
                    return { c: 'vec4(0.0)' };
                  }
                  videoSlot.set(node.id, index);
                  usedVideos.push({
                    id: node.id,
                    asset: node.asset ?? '',
                    mode: VIDEO_MODES.includes(
                      (node.op ?? '') as (typeof VIDEO_MODES)[number],
                    )
                      ? ((node.op ?? VIDEO_MODES[0]) as (typeof VIDEO_MODES)[number])
                      : VIDEO_MODES[0],
                    index,
                  });
                }
                return { c: `fromVideo${index}(${ctx.read('p')})` };
              })()
          : node.kind === 'image'
            ? (() => {
                let index = imageSlot.get(node.id);
                if (index === undefined) {
                  index = usedImages.length;
                  if (index >= MAX_IMAGES) {
                    failed ??= `more than ${MAX_IMAGES} reachable image nodes`;
                    return { c: 'vec4(0.0)' };
                  }
                  imageSlot.set(node.id, index);
                  usedImages.push({
                    id: node.id,
                    asset: node.asset ?? '',
                    mode: IMAGE_MODES.includes(
                      (node.op ?? '') as (typeof IMAGE_MODES)[number],
                    )
                      ? ((node.op ?? IMAGE_MODES[0]) as (typeof IMAGE_MODES)[number])
                      : IMAGE_MODES[0],
                    index,
                  });
                }
                const contain = usedImages[index]?.mode === 'contain' ? 'true' : 'false';
                return { c: `fromImage${index}(${ctx.read('p')}, ${contain})` };
              })()
          : spec.emit(ctx);
    open.delete(here);

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

  const from = ends[0] ? feeds.get(portId(ends[0].id, 'c')) : undefined;
  let result = 'vec4(0.0)';
  if (from) {
    const source = splitPort(from);
    result = resolve(source.node, source.port, 'c', 'centred()') ?? result;
  }
  if (failed) return { ...bare, error: failed };

  const source = `${flowPreamble(values.length)}${CIRCUIT_HELPERS}
void main() {
${lines.join('\n')}
  fragColor = ${result};
}`;
  return {
    ...bare,
    source,
    videos: usedVideos,
    images: usedImages,
    feedback,
    work: shaderWork,
    error: null,
  };
}

/**
 * What a new flow starts as.
 *
 * Not an empty canvas. An empty canvas asks you to know the vocabulary before
 * you have seen it work, and the first thing anyone wants is to turn one number
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
      { id: 'fold', kind: 'lens', op: 'kaleido', x: 260, y: 60 },
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
