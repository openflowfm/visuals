import type { ParameterResponse } from '../../response.ts';

/**
 * What a port carries, and how one is declared.
 *
 * A leaf on purpose, the way `nodes/descriptor.ts` is. The compiler builds its
 * own nodes' ports out of these and so does every node that keeps its spec in
 * its own folder — and a folder importing them from the compiler would be
 * importing the module that imports it, which evaluates to `undefined` at the
 * exact moment a spec's inlet table is being built. Splitting the vocabulary
 * out is what lets both sides use the same builders instead of one side
 * spelling every `PortSpec` out as a literal.
 */

/** Which of the three things a port carries. Surfaced as `data-kind` on the canvas. */
export type Signal = 'p' | 'n' | 'c';

/** Documentation every real port is required to carry into the app. */
export interface PortDocumentation {
  /** One plain-language sentence about what arrives or leaves here. */
  description: string;
}

export interface PortSpec extends PortDocumentation {
  name: string;
  kind: Signal;
  /** The GLSL used when nothing is wired here and nothing is set. */
  fallback?: string;
  /**
   * The number this inlet holds when nothing is wired, and therefore where the
   * control on the node's face starts.
   *
   * A point and a colour have none — there is no one control for a position and
   * no useful constant for a picture. A live number (`ALIVE`) has none either,
   * but for the opposite reason: its resting answer is a signal, not a number.
   * Every `n` inlet is settable — one without an `at` simply starts live and
   * only holds a number once somebody sets one.
   */
  at?: number;
  /**
   * Another inlet on the same node whose answer this one borrows while it has
   * none of its own — unwired and unheld, it reads whatever that inlet reads.
   *
   * This is how a source's shape numbers follow its energy: `columns` on a
   * `bars` compiles to the energy expression until somebody catches it, so
   * promoting a constant to an inlet changes nothing until a hand does.
   */
  fallbackInlet?: string;
  /** A binary face control; it remains a number inlet on the wire. */
  control?: 'toggle';
  /** A domain-aware readout for values whose useful meaning is not a percent. */
  display?: 'lfo-rate' | 'phase';
  /** How this inlet turns the graph's normalized number into its working domain. */
  response?: ParameterResponse;
}


/** A number as GLSL. `1` has to be spelled `1.0` or the shader will not compile. */
export const asFloat = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

export const P = (name: string, description: string, fallback?: string): PortSpec => ({
  name,
  kind: 'p',
  description,
  fallback,
});
export const C = (name: string, description: string, fallback = 'vec4(0.0)'): PortSpec => ({
  name,
  kind: 'c',
  description,
  fallback,
});

/**
 * A settable number inlet, and the number it sits at until someone turns it.
 *
 * The fallback is that number as GLSL rather than a string written twice, so
 * what the face shows and what a shader with nothing set compiles cannot drift
 * apart.
 */
export const N = (name: string, description: string, at = 0.5): PortSpec => ({
  name,
  kind: 'n',
  description,
  at,
  fallback: asFloat(at),
});

/**
 * A number inlet whose unwired answer is a **signal** rather than a setting.
 *
 * There are two, and both are the reason this rig is not a screensaver:
 * `energy` reads the room and an `lfo`'s `clock` reads the beat. Neither has an
 * `at`, because their resting state is the signal — a default number here would
 * replace something already moving with a number that is not, which is a worse
 * default than the one it would be replacing.
 *
 * They can still be **held**. A number set on one of these goes into
 * `node.values` like any other and takes the inlet over until it is cleared,
 * which is what makes the row on the face a control rather than a reading. The
 * live signal is the default, not the law.
 */
export const ALIVE = (name: string, description: string, from: string): PortSpec => ({
  name,
  kind: 'n',
  description,
  fallback: from,
});

/** Every room-reactive mode gets one, so `rate` and `charge` have something to run on. */
export const E = () =>
  ALIVE('energy', 'How strongly the room drives this movement or brightness.', 'uEnergy');

/**
 * A number inlet that borrows the energy inlet's answer until somebody takes it.
 *
 * The promotion path for a constant with `e` mixed into it: as `FOLLOWS`, it
 * compiles to exactly the coupling it replaced — through a held or wired
 * energy too — and a graph that never touches it draws what it always drew.
 */
export const FOLLOWS = (name: string, description: string): PortSpec => ({
  name,
  kind: 'n',
  description,
  fallbackInlet: 'energy',
});


/**
 * The same builders under the names a node's own spec says them by.
 *
 * One letter reads well inside the compiler, where the ports of thirty nodes
 * are declared a few lines apart. It reads as noise in a folder that declares
 * four.
 */
export {
  P as pointPort,
  C as colourPort,
  N as numberPort,
  ALIVE as livePort,
  E as energyPort,
  FOLLOWS as followingPort,
};
