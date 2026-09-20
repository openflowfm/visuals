import type { ParameterResponse } from '../../response.ts';
import { COLOR_ROLES, type ColorRole } from '../../protocol.ts';

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
  /** Cosmetic faceplate name. `name` remains the stable graph address. */
  label?: string;
  /** Visible palette-role default for an overridable colour inlet. */
  colorRole?: ColorRole;
  /** Optional visual grouping for setup-published controls. */
  group?: string;
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
   * Reserved for explicit semantic aliases. Normal node controls use their
   * own independent defaults.
   */
  fallbackInlet?: string;
  /**
   * A face control that is not a fader; it remains a number inlet on the wire.
   *
   * `modes` is the mode chooser. Unwired, the node's `op` is the answer and the
   * chooser sets it — one source of truth, the way a held number is the answer
   * until a cord overrides it. Wired, the number decides and the chooser says
   * what is driving it.
   */
  control?: 'toggle' | 'modes';
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

/** A normal colour inlet whose unwired default is one named palette role. */
export const roleColorPort = (name: string, description: string, role: ColorRole = 'primary'): PortSpec => ({
  ...C(name, description, `vec4(uColors[${COLOR_ROLES.indexOf(role)}], 1.0)`),
  colorRole: role,
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
 * An LFO's clock and a form's travelling camera are examples: their
 * resting answer follows time rather than a fixed numeric setting.
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
};
