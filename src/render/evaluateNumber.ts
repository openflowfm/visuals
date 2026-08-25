import {
  LFO_SHAPES,
  TRACK_READS,
  type Circuit,
  type CircuitNode,
  type Show,
} from '../../protocol.ts';
import { NODE_SPECS, inletsOf, splitPort } from './circuit.ts';
import { lfoClock, lfoIdentity, lfoValue } from '../nodes/lfo/algorithm.ts';

/** Everything a CPU number chain reads at one display-clock tick. */
export interface NumberInputs {
  show: Show;
  beat: number;
  seconds: number;
  /** Seconds since the previous display tick, for a track's envelope. */
  dt: number;
  /** The same global pace the shader reads. Zero when the scheme says nothing. */
  pace?: number;
  /** The flow pass's seed. Its renderer default is 3.71. */
  seed?: number;
  /**
   * Latest numbers by the ids `valuesOf` gives them: a value node's id, or a
   * `node/inlet` address. Absent entries fall back to the circuit's stored
   * values, so a caller that has no gesture-local state passes nothing.
   */
  params?: Readonly<Record<string, number>>;
}

/** One latched reading of a circuit. Results are cached for the life of the sample. */
export interface NumberSample {
  /** A number leaving an outlet, or undefined when it is not CPU-evaluable. */
  outlet(id: string): number | undefined;
  /** The answer arriving at a number inlet, including its unwired answer. */
  inlet(id: string): number | undefined;
}

/**
 * A stateful CPU evaluator for the number half of a circuit.
 *
 * State is only a track envelope. Calling `sample` latches the supplied room
 * and clock; every outlet reached inside that sample is evaluated once, however
 * many downstream inlets ask for it. That is the display-rate counterpart of
 * filling one uniform bank per render frame, and it stops one shared track node
 * advancing its envelope twice because two rows happen to read it.
 */
export interface NumberEvaluator {
  sample(circuit: Circuit, inputs: NumberInputs): NumberSample;
  /** Forget every held track envelope, as mounting a fresh renderer would. */
  reset(): void;
}

const clamp = (value: number, low = 0, high = 1): number =>
  Math.max(low, Math.min(high, value));
const fract = (value: number): number => value - Math.floor(value);
const mix = (a: number, b: number, amount: number): number => a + (b - a) * amount;

/** The scalar form of the shader preamble's `hash(vec2)`. */
function hash(x: number, y: number, seed: number): number {
  return fract(Math.sin(x * 127.1 + y * 311.7 + seed) * 43758.5453);
}

/** The scalar form of the shader preamble's two-dimensional value noise. */
function noise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = fract(x);
  let fy = fract(y);
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  return mix(
    mix(hash(ix, iy, seed), hash(ix + 1, iy, seed), fx),
    mix(hash(ix, iy + 1, seed), hash(ix + 1, iy + 1, seed), fx),
    fy,
  );
}

/** The shader's quantised ladder of musical divisions. */
function rate(energy: number, pace: number, seed: number): number {
  const steps = [0.125, 0.25, 0.5, 1, 2, 3];
  const rung = energy * 3.2 + hash(11.3, 4.7, seed) * 2.2 + pace;
  return steps[clamp(Math.floor(rung), 0, steps.length - 1)];
}

/** The one pulse shape every shader calls "on the beat". */
function beatPulse(beat: number, division: number, energy: number): number {
  return Math.pow(1 - fract(beat * division), mix(2.5, 5, energy));
}

/** A stable 0–1 per song name, so `song.seed` is a different number per song. */
export function seedOf(name: string | null): number {
  if (!name) return 0.5;
  let held = 1779033703 ^ name.length;
  for (let i = 0; i < name.length; i++) {
    held = Math.imul(held ^ name.charCodeAt(i), 3432918353);
    held = (held << 13) | (held >>> 19);
  }
  held = Math.imul(held ^ (held >>> 16), 2246822507);
  return ((held ^ (held >>> 16)) >>> 0) / 4294967296;
}

/** Where the playing section sits among the ones the set uses, 0–1. */
export function sectionOf(show: Show): number {
  if (!show.role || show.roles.length < 2) return 0.5;
  const at = show.roles.indexOf(show.role);
  return at < 0 ? 0.5 : at / (show.roles.length - 1);
}

/** One number out of the set, by track name and by which number was asked for. */
export function trackReading(show: Show, name: string, read: string): number {
  if (name === 'master') {
    return read === 'level' ? show.master : read === 'fader' ? 1 : show.playing ? 1 : 0;
  }
  // Groups after tracks, because a `tracks` node draws the first list and a
  // person naming something that appears in both meant the drawable one. Both
  // are searched, so a `track` node pointed at a group bus reads it — usually
  // the better question, since a set with five kicks under `DRUMS` has one
  // number worth driving a flow from and it is the group's.
  const track =
    show.tracks.find((each) => each.name === name) ??
    show.groups.find((each) => each.name === name);
  if (!track) return 0;
  if (read === 'fader') return track.opacity;
  if (read === 'playing') return track.playing >= 0 ? 1 : 0;
  return track.level;
}

/** One attack/release step of the CPU envelope a track can ask for. */
export function smoothTrack(
  previous: number,
  current: number,
  smooth: number,
  dt: number,
): number {
  if (smooth <= 0 || current > previous) return current;
  const fall = 1 - Math.exp(-dt / (0.05 + smooth * 1.95));
  return previous + (current - previous) * fall;
}

/** A playback node, under the same uniforms the flow pass receives. */
function playback(node: CircuitNode, at: NumberInputs): number {
  const seed = at.seed ?? 3.71;
  switch (node.op ?? 'level') {
    case 'beat':
      return at.beat;
    case 'phase': {
      const quantum = at.show.quantum || 4;
      return (((at.beat % quantum) + quantum) % quantum) / quantum;
    }
    case 'pulse':
      return beatPulse(
        at.beat,
        rate(at.show.master, at.pace ?? 0, seed),
        at.show.master,
      );
    case 'time':
      return at.seconds;
    case 'random':
      return hash(seed, Math.floor(at.beat), seed);
    case 'level':
    default:
      return at.show.master;
  }
}

/** A song node, matching the five uniforms filled in `feed.ts`. */
function song(node: CircuitNode, show: Show): number {
  switch (node.op ?? 'seed') {
    case 'tempo':
      return clamp(show.tempo / 200);
    case 'key':
      return show.key ?? 0.5;
    case 'section':
      return sectionOf(show);
    case 'sections':
      return show.roles.length / 8;
    case 'seed':
    default:
      return seedOf(show.song);
  }
}

function maths(op: string | undefined, a: number, b: number): number {
  switch (op ?? 'add') {
    case 'subtract':
      return clamp(a - b);
    case 'multiply':
      return a * b;
    case 'min':
      return Math.min(a, b);
    case 'max':
      return Math.max(a, b);
    case 'average':
      return (a + b) * 0.5;
    case 'add':
    default:
      return clamp(a + b);
  }
}

function wave(op: string | undefined, phase: number, seed: number): number {
  switch (op ?? 'sine') {
    case 'saw':
      return fract(phase);
    case 'ramp':
      return 1 - fract(phase);
    case 'square':
      return fract(phase) < 0.5 ? 0 : 1;
    case 'pulse':
      return Math.pow(1 - fract(phase), 4);
    case 'noise':
      return noise(phase, phase * 0.37, seed);
    case 'sine':
    default:
      return Math.sin(phase * 6.28318) * 0.5 + 0.5;
  }
}

export function createNumberEvaluator(): NumberEvaluator {
  /** Same key and lifetime as the follower bank in `createFeed`. */
  const followed = new Map<string, number>();

  return {
    reset() {
      followed.clear();
    },

    sample(circuit, inputs) {
      const byId = new Map(circuit.nodes.map((node) => [node.id, node]));
      const feeds = new Map<string, string>();
      // `compileCircuit` takes the last answer in a malformed bare circuit.
      // Schemes are repaired to one cord per inlet before either reaches one.
      for (const cord of circuit.cords) feeds.set(cord.to, cord.from);

      const outputs = new Map<string, number | undefined>();
      const inlets = new Map<string, number | undefined>();
      const open = new Set<string>();

      const readInlet = (id: string): number | undefined => {
        if (inlets.has(id)) return inlets.get(id);
        const { node: nodeId, port: name } = splitPort(id);
        const node = byId.get(nodeId);
        const port = node && inletsOf(node).find((each) => each.name === name);
        if (!node || !port || port.kind !== 'n') {
          inlets.set(id, undefined);
          return undefined;
        }

        const from = feeds.get(id);
        let value: number | undefined;
        if (from) {
          const signal = readOutlet(from);
          // The same arithmetic the shader does, because a reading that
          // disagreed with the picture would be worse than no reading: the row
          // is what you set the range on, so it has to show where the range
          // actually put the inlet. See `readAt` in `circuit.ts`.
          if (signal === undefined) value = undefined;
          else {
            const base = node.values?.[name] ?? 0;
            const depth = node.depths?.[name] ?? 1;
            value = Math.max(0, Math.min(1, base + depth * signal));
          }
        } else {
          // The same order the shader answers in: a gesture in flight, then the
          // held number, then the spec's default — and only a live inlet with
          // none of those falls through to its signal.
          const held = inputs.params?.[id] ?? node.values?.[name] ?? port.at;
          if (held !== undefined) value = held;
          else if (port.fallbackInlet !== undefined)
            value = readInlet(`${nodeId}/${port.fallbackInlet}`);
          else if (port.fallback === 'uEnergy') value = inputs.show.master;
          else if (port.fallback === 'uBeat') value = inputs.beat;
        }
        inlets.set(id, value);
        return value;
      };

      const readOutlet = (id: string): number | undefined => {
        if (outputs.has(id)) return outputs.get(id);
        if (open.has(id)) return undefined;
        const { node: nodeId, port: name } = splitPort(id);
        const node = byId.get(nodeId);
        const port = node && NODE_SPECS[node.kind].outlets.find((each) => each.name === name);
        if (!node || !port || port.kind !== 'n' || node.kind === 'polar') {
          outputs.set(id, undefined);
          return undefined;
        }

        open.add(id);
        let value: number | undefined;
        switch (node.kind) {
          case 'value':
          case 'take':
            value = inputs.params?.[node.id] ?? node.value ?? 0.5;
            break;
          case 'playback':
            value = playback(node, inputs);
            break;
          case 'track': {
            const track = node.of ?? '';
            const read = node.op ?? TRACK_READS[0];
            const current = trackReading(inputs.show, track, read);
            const smooth = node.smooth ?? 0;
            if (smooth <= 0 || !track) value = current;
            else {
              const key = `${track}/${read}`;
              value = smoothTrack(followed.get(key) ?? 0, current, smooth, inputs.dt);
              followed.set(key, value);
            }
            break;
          }
          case 'song':
            value = song(node, inputs.show);
            break;
          case 'math': {
            const a = readInlet(`${node.id}/a`);
            const b = readInlet(`${node.id}/b`);
            if (a !== undefined && b !== undefined) value = maths(node.op, a, b);
            break;
          }
          case 'wave': {
            const phase = readInlet(`${node.id}/phase`);
            if (phase !== undefined) value = wave(node.op, phase, inputs.seed ?? 3.71);
            break;
          }
          case 'lfo': {
            const rate = readInlet(`${node.id}/rate`);
            const sync = readInlet(`${node.id}/sync`);
            const phase = readInlet(`${node.id}/phase`);
            if (rate !== undefined && sync !== undefined && phase !== undefined) {
              const shape = LFO_SHAPES.includes(
                (node.op ?? '') as (typeof LFO_SHAPES)[number],
              )
                ? ((node.op ?? LFO_SHAPES[0]) as (typeof LFO_SHAPES)[number])
                : LFO_SHAPES[0];
              value = lfoValue(
                shape,
                lfoClock(inputs.beat, inputs.seconds, rate, sync, phase),
                lfoIdentity(node.id),
                inputs.seed ?? 3.71,
              );
            }
            break;
          }
        }
        open.delete(id);
        outputs.set(id, value);
        return value;
      };

      return { outlet: readOutlet, inlet: readInlet };
    },
  };
}
