import type { Circuit, CircuitNode, NodeKind } from '../../protocol.ts';
import { EFFECT_PREAMBLE } from './shaders.ts';

/**
 * An effect built out of nodes, compiled to a fragment shader.
 *
 * The six built-ins are handwritten GLSL and always will be — they are the ones
 * worth having before anyone has wired anything. This is the other half: a
 * vocabulary small enough to hold in your head, wired on a canvas, producing a
 * shader that the compositor cannot tell from a built-in.
 *
 * ## Three signals, and everything follows from them
 *
 * A **point** (`p`) is where in the frame you are looking. A **number** (`n`) is
 * anything scalar — a knob, a meter, the beat. A **colour** (`c`) is a
 * premultiplied `vec4`. Geometry nodes move points about, `sample` turns a point
 * into a colour by reading the picture that arrived, colour nodes work on
 * colours, and `out` takes the one that leaves. That is every move a fragment
 * shader makes on a frame, and having exactly three types is what keeps the
 * canvas legible: a cord's shape tells you what it carries.
 *
 * Points are **centred and aspect-corrected** — zero in the middle, a circle
 * round. `sample` is the only node that converts back, so nothing else has to
 * know the frame's shape.
 *
 * ## Numbers are 0–1
 *
 * Every number a node produces is 0–1 unless it is `beat` or `time`, and every
 * number a node consumes is read as 0–1 and mapped internally to whatever that
 * node's useful range is. This is the rule that makes the vocabulary
 * *composable*: any outlet can go into any inlet and mean something, so wiring a
 * meter into a fold works without anyone having built a scaling node first. The
 * cost is that a node's range is its own business and not visible on the canvas;
 * the alternative is a patch bay of converters, which is how these things
 * usually die.
 *
 * ## Unconnected inlets have answers
 *
 * Every inlet has a fallback, so a half-wired circuit still compiles and still
 * draws. Building one of these is an incremental act — drop a node, see what it
 * did, wire the next — and a canvas that goes black until the graph is finished
 * cannot be built on. An unwired `sample` reads the frame where it already was;
 * an unwired point is the fragment's own.
 */

/** Which of the three things a port carries. Surfaced as `data-kind` on the canvas. */
export type Signal = 'p' | 'n' | 'c';

export interface PortSpec {
  name: string;
  kind: Signal;
  /** The GLSL used when nothing is wired here. */
  fallback?: string;
}

export interface NodeSpec {
  /** What it is called on the canvas. */
  name: string;
  /** One line, shown when the node is selected. */
  about: string;
  inlets: readonly PortSpec[];
  outlets: readonly PortSpec[];
  /** The modes this node has, if it has any. The first is the default. */
  ops?: readonly string[];
  /**
   * The GLSL for each outlet, given a reader for its inlets.
   *
   * Expressions rather than statements, and every one of them is a pure function
   * of its inputs — which is what lets the compiler emit them in any topological
   * order without tracking side effects.
   */
  emit(read: (inlet: string) => string, node: CircuitNode): Record<string, string>;
}

const P = (name: string, fallback = 'centred()'): PortSpec => ({
  name,
  kind: 'p',
  fallback,
});
const N = (name: string, fallback = '0.5'): PortSpec => ({
  name,
  kind: 'n',
  fallback,
});
const C = (name: string, fallback = 'texture(uTex, vUv)'): PortSpec => ({
  name,
  kind: 'c',
  fallback,
});

const SIGNALS: Record<string, string> = {
  level: 'uLevel',
  energy: 'uEnergy',
  beat: 'uBeat',
  phase: '(uPhase / uQuantum)',
  pulse: 'beatPulse(rate())',
  time: 'uTime',
  amount: 'uAmount',
  random: 'hash(vec2(uSeed, floor(uBeat)))',
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

/** Base first, top second — the same order the compositor stacks layers in. */
const MIXES: Record<string, (a: string, b: string) => string> = {
  over: (a, b) => `(${b} + ${a} * (1.0 - ${b}.a))`,
  add: (a, b) => `(${a} + ${b})`,
  screen: (a, b) => `(${a} + ${b} - ${a} * ${b})`,
  multiply: (a, b) => `(${a} * ${b})`,
};

export const NODE_SPECS: Record<NodeKind, NodeSpec> = {
  point: {
    name: 'point',
    about: 'Where this fragment is: zero in the middle, a circle round.',
    inlets: [],
    outlets: [P('p')],
    emit: () => ({ p: 'centred()' }),
  },

  signal: {
    name: 'signal',
    about: 'What the music is doing right now. The reason any of this moves.',
    inlets: [],
    outlets: [N('n')],
    ops: Object.keys(SIGNALS),
    emit: (_read, node) => ({ n: SIGNALS[node.op ?? 'level'] ?? 'uLevel' }),
  },

  value: {
    name: 'value',
    about: 'A knob. Named here, turned in the effect list, and never recompiled.',
    inlets: [],
    outlets: [N('n')],
    // The index is assigned by the compiler, which is the only thing that knows
    // how many knobs came before this one.
    emit: () => ({ n: 'uParams[0]' }),
  },

  track: {
    name: 'track',
    about: 'Another track\'s meter, by name. Absolute — it breaks if the look moves.',
    inlets: [],
    outlets: [N('level')],
    // The slot is the compiler's, like a knob's. The *name* is the node's, and
    // it is what makes this the addressing that stays put.
    emit: () => ({ level: 'uTracks[0]' }),
  },

  fold: {
    name: 'fold',
    about: 'Mirror the frame into wedges around the centre. A kaleidoscope.',
    inlets: [P('p'), N('sides', '0.2')],
    outlets: [P('p')],
    emit: (read) => ({ p: `cFold(${read('p')}, ${read('sides')})` }),
  },

  swirl: {
    name: 'swirl',
    about: 'Rotate by more the further out you are. Twists the frame.',
    inlets: [P('p'), N('turn')],
    outlets: [P('p')],
    emit: (read) => ({ p: `cSwirl(${read('p')}, ${read('turn')})` }),
  },

  zoom: {
    name: 'zoom',
    about: 'Push in or pull out. A half is life size.',
    inlets: [P('p'), N('by')],
    outlets: [P('p')],
    emit: (read) => ({ p: `cZoom(${read('p')}, ${read('by')})` }),
  },

  wobble: {
    name: 'wobble',
    about: 'Displace on a sine that runs on the beat.',
    inlets: [P('p'), N('amount', '0.3')],
    outlets: [P('p')],
    emit: (read) => ({ p: `cWobble(${read('p')}, ${read('amount')})` }),
  },

  tile: {
    name: 'tile',
    about: 'Repeat the frame in a grid.',
    inlets: [P('p'), N('count', '0.3')],
    outlets: [P('p')],
    emit: (read) => ({ p: `cTile(${read('p')}, ${read('count')})` }),
  },

  polar: {
    name: 'polar',
    about: 'A point as distance from the centre and angle around it.',
    inlets: [P('p')],
    outlets: [N('radius'), N('angle')],
    emit: (read) => ({
      radius: `clamp(length(${read('p')}) * 1.6, 0.0, 1.0)`,
      angle: `(atan(${read('p')}.y, ${read('p')}.x) / 6.28318 + 0.5)`,
    }),
  },

  sample: {
    name: 'sample',
    about: 'Read the picture that arrived, at a point. The only way in.',
    inlets: [P('p', 'centred()')],
    outlets: [C('c')],
    emit: (read) => ({
      c: `texture(uTex, clamp(uncentred(${read('p')}), 0.0, 1.0))`,
    }),
  },

  paint: {
    name: 'paint',
    about: "The song's own colour, at a brightness. How a number becomes a picture.",
    inlets: [N('amount')],
    outlets: [C('c')],
    emit: (read) => ({ c: `cPaint(${read('amount')})` }),
  },

  hue: {
    name: 'hue',
    about: 'Rotate the colour without touching the shape.',
    inlets: [C('c'), N('shift')],
    outlets: [C('c')],
    emit: (read) => ({ c: `cHue(${read('c')}, ${read('shift')})` }),
  },

  levels: {
    name: 'levels',
    about: 'Contrast and brightness. A half of each leaves it alone.',
    inlets: [C('c'), N('gain'), N('lift')],
    outlets: [C('c')],
    emit: (read) => ({
      c: `cLevels(${read('c')}, ${read('gain')}, ${read('lift')})`,
    }),
  },

  blend: {
    name: 'blend',
    about: 'Two pictures into one, the same four ways layers stack.',
    inlets: [C('base'), C('top'), N('amount', '1.0')],
    outlets: [C('c')],
    ops: Object.keys(MIXES),
    emit: (read, node) => {
      const op = MIXES[node.op ?? 'over'] ?? MIXES.over;
      return {
        c: `mix(${read('base')}, ${op(read('base'), read('top'))}, ${read('amount')})`,
      };
    },
  },

  math: {
    name: 'math',
    about: 'Two numbers into one.',
    inlets: [N('a'), N('b')],
    outlets: [N('n')],
    ops: Object.keys(MATH),
    emit: (read, node) => {
      const op = MATH[node.op ?? 'add'] ?? MATH.add;
      return { n: op(read('a'), read('b')) };
    },
  },

  wave: {
    name: 'wave',
    about: 'A number in, a shape out. Wire the beat in and it runs in time.',
    inlets: [N('phase', 'uBeat')],
    outlets: [N('n')],
    ops: Object.keys(WAVES),
    emit: (read, node) => {
      const op = WAVES[node.op ?? 'sine'] ?? WAVES.sine;
      return { n: op(read('phase')) };
    },
  },

  out: {
    name: 'out',
    about: 'What leaves. Mixed against the untouched frame by the effect amount.',
    inlets: [C('c')],
    outlets: [],
    emit: () => ({}),
  },
};

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

vec4 cPaint(float n) {
  float a = clamp(n, 0.0, 1.0);
  return vec4(charge(uColor) * a, a);
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

export interface CircuitKnob {
  /** The `value` node this knob is. */
  id: string;
  label: string;
  /** Which slot of `uParams` it rides in. */
  index: number;
  value: number;
}

export interface Compiled {
  source: string | null;
  error: string | null;
  /** In `uParams` order, which is the order the `value` nodes appear in. */
  knobs: CircuitKnob[];
}

/** At most eight, because that is the size of the bank in `EFFECT_PREAMBLE`. */
export const MAX_KNOBS = 8;

/** Likewise, and for the same bank-sized reason. */
export const MAX_TRACKS = 8;

/** One `track` node: what it names, and which slot of `uTracks` it reads. */
export interface CircuitTrack {
  id: string;
  /** The exact track name, or `master`. Empty until someone picks one. */
  name: string;
  index: number;
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
export function signalOf(circuit: Circuit, id: string): Signal | null {
  const { node, port } = splitPort(id);
  const held = circuit.nodes.find((n) => n.id === node);
  if (!held) return null;
  const spec = NODE_SPECS[held.kind];
  const found =
    spec.inlets.find((p) => p.name === port) ?? spec.outlets.find((p) => p.name === port);
  return found?.kind ?? null;
}

/**
 * Every track this circuit names, in the order the compiler will bank them.
 *
 * Positional rather than keyed by name so that two nodes naming the same track
 * still get a slot each — deduplicating them would make deleting one silently
 * change what the other reads.
 */
export function tracksOf(circuit: Circuit): CircuitTrack[] {
  return circuit.nodes
    .filter((node) => node.kind === 'track')
    .slice(0, MAX_TRACKS)
    .map((node, index) => ({ id: node.id, name: node.op ?? '', index }));
}

export function knobsOf(circuit: Circuit): CircuitKnob[] {
  return circuit.nodes
    .filter((node) => node.kind === 'value')
    .slice(0, MAX_KNOBS)
    .map((node, index) => ({
      id: node.id,
      label: node.label || `knob ${index + 1}`,
      index,
      value: node.value ?? 0.5,
    }));
}

/**
 * A circuit to a fragment shader, or the reason it isn't one.
 *
 * Only what `out` can reach is emitted. A node wired to nothing costs nothing,
 * which matters more than it sounds: building one of these means dropping a node
 * and looking at it, and a compiler that treated an unwired node as an error
 * would make the canvas unusable for exactly the way it gets used.
 */
export function compileCircuit(circuit: Circuit): Compiled {
  const knobs = knobsOf(circuit);
  const byId = new Map(circuit.nodes.map((node) => [node.id, node]));
  const slot = new Map(knobs.map((knob) => [knob.id, knob.index]));
  const trackSlot = new Map(tracksOf(circuit).map((track) => [track.id, track.index]));

  const end = circuit.nodes.find((node) => node.kind === 'out');
  if (!end)
    return {
      source: null,
      error: 'no out node — nothing leaves this circuit',
      knobs,
    };
  if (circuit.nodes.filter((n) => n.kind === 'out').length > 1) {
    return { source: null, error: 'more than one out node', knobs };
  }
  if (circuit.nodes.filter((n) => n.kind === 'value').length > MAX_KNOBS) {
    return { source: null, error: `more than ${MAX_KNOBS} knobs`, knobs };
  }
  if (circuit.nodes.filter((n) => n.kind === 'track').length > MAX_TRACKS) {
    return { source: null, error: `more than ${MAX_TRACKS} named tracks`, knobs };
  }

  /** Inlet address to the outlet feeding it. The last cord to an inlet wins. */
  const feeds = new Map<string, string>();
  for (const cord of circuit.cords) feeds.set(cord.to, cord.from);

  const lines: string[] = [];
  const named = new Map<string, string>();
  const open = new Set<string>();
  let failed: string | null = null;

  /** The GLSL variable an outlet lives in, emitting whatever it depends on first. */
  const resolve = (nodeId: string, port: string, want: Signal): string | null => {
    const node = byId.get(nodeId);
    if (!node) return null;
    const spec = NODE_SPECS[node.kind];
    const outlet = spec.outlets.find((p) => p.name === port);
    if (!outlet) return null;
    if (outlet.kind !== want) {
      failed ??= `${spec.name}.${port} carries ${outlet.kind}, not ${want}`;
      return null;
    }

    const key = portId(nodeId, port);
    const held = named.get(key);
    if (held) return held;
    if (open.has(nodeId)) {
      failed ??= `${spec.name} feeds itself — a circuit cannot loop`;
      return null;
    }
    open.add(nodeId);

    const read = (inlet: string): string => {
      const wanted = spec.inlets.find((p) => p.name === inlet);
      const fallback = wanted?.fallback ?? '0.0';
      const from = feeds.get(portId(nodeId, inlet));
      if (!from || !wanted) return fallback;
      const source = splitPort(from);
      return resolve(source.node, source.port, wanted.kind) ?? fallback;
    };

    const emitted =
      node.kind === 'value'
        ? { n: `uParams[${slot.get(node.id) ?? 0}]` }
        : node.kind === 'track'
          ? { level: `uTracks[${trackSlot.get(node.id) ?? 0}]` }
          : spec.emit(read, node);
    open.delete(nodeId);

    const at = circuit.nodes.indexOf(node);
    for (const [name, expression] of Object.entries(emitted)) {
      const kind = spec.outlets.find((p) => p.name === name)?.kind ?? 'n';
      const variable = `n${at}_${name}`;
      // Every outlet becomes a variable even when it is read once, so a node
      // feeding three others is computed once rather than three times.
      if (!named.has(portId(nodeId, name))) {
        lines.push(`  ${TYPES[kind]} ${variable} = ${expression};`);
        named.set(portId(nodeId, name), variable);
      }
    }
    return named.get(key) ?? null;
  };

  const from = feeds.get(portId(end.id, 'c'));
  let result = 'texture(uTex, vUv)';
  if (from) {
    const source = splitPort(from);
    result = resolve(source.node, source.port, 'c') ?? result;
  }
  if (failed) return { source: null, error: failed, knobs };

  const source = `${EFFECT_PREAMBLE}${HELPERS}
void main() {
${lines.join('\n')}
  MIXED(${result})
}`;
  return { source, error: null, knobs };
}

/**
 * What a new effect starts as.
 *
 * Not an empty canvas. An empty canvas asks you to know the vocabulary before
 * you have seen it work, and the first thing anyone wants is to move one knob
 * and watch the frame change — so a new circuit is already a working
 * kaleidoscope whose segment count is a knob, and the whole of learning this is
 * taking it apart.
 */
export function starterCircuit(): Circuit {
  return {
    nodes: [
      { id: 'p', kind: 'point', x: 30, y: 120 },
      { id: 'k', kind: 'value', x: 30, y: 230, value: 0.25, label: 'sides' },
      { id: 'f', kind: 'fold', x: 210, y: 140 },
      { id: 's', kind: 'sample', x: 390, y: 150 },
      { id: 'o', kind: 'out', x: 560, y: 155 },
    ],
    cords: [
      { from: 'p/p', to: 'f/p' },
      { from: 'k/n', to: 'f/sides' },
      { from: 'f/p', to: 's/p' },
      { from: 's/c', to: 'o/c' },
    ],
  };
}
