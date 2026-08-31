import type { CircuitNode, FlowDef } from './protocol.ts';
import {
  PRODUCTION_RESPONSES,
  RESPONSE_SET_VERSION,
  isIdentityResponse,
  responseKey,
  type ParameterResponse,
} from './response.ts';

/**
 * Carrying dialled numbers across a change to what a number means.
 *
 * A flow stores 0–1 and the inlet's response turns that into its working
 * domain. Change a response and every stored number in every saved flow starts
 * meaning something else — silently, because the file did not change and
 * nothing recompiles differently. That already happened once: response-set
 * version 3 reshaped 82 inlets and moved the shader arithmetic out of three
 * more, and fourteen of the twenty-seven flows in a real library came back
 * looking different with nobody having touched them.
 *
 * So a response set is a **version**, a scheme records which one its numbers
 * were dialled against, and a stored value crosses a version boundary by being
 * re-solved: find the number that, under the new response, delivers what the
 * old one delivered. `visuals/docs/calibration.md` step 5 is this file.
 *
 * **The stamp is load-bearing.** Unlike the other repairs in `server/scheme.ts`
 * this is not idempotent — solving twice compounds — so `Scheme.responses` is
 * what says a migration has already run. It is written by `merge`, which is
 * the one door, and a file without one genuinely is version 1.
 */

const TAU = Math.PI * 2;

/** What a scheme with no stamp is: every stored number predates responses entirely. */
export const OLDEST_RESPONSE_SET_VERSION = 1;

/**
 * What a stored value delivered before response-set version 3, in the units the
 * current response answers in.
 *
 * Only three keys need an entry. The eighty-two normalized calibrations left
 * their shader arithmetic exactly where it was and simply reshaped the range in
 * front of it, so before version 3 they delivered the stored number itself —
 * which is the identity this table falls back to.
 *
 * These three are the ones whose GLSL moved in the same commit: `cSwirl` and
 * `fxTwist` stopped centring their own argument and `fxKaleido` stopped scaling
 * its own, so the old shader term is what has to be reproduced, divided by the
 * TAU each of them now multiplies by.
 */
const DELIVERED_BEFORE_VERSION_3: Readonly<Record<string, (stored: number) => number>> = {
  'lens/kaleido/spin': (stored) => ((stored - 0.5) * 0.6) / TAU,
  'lens/twist/turn': (stored) => ((stored - 0.5) * 9) / TAU,
  'lens/swirl/turn': (stored) => ((stored - 0.5) * 12.56637) / TAU,
};

export interface ResponseEra {
  /** The version this era ends at: a file below it has to cross this era. */
  upTo: number;
  /** What each key delivered during it, in the units the current response answers in. */
  delivered: Readonly<Record<string, (stored: number) => number>>;
  /**
   * When the version above it landed in source.
   *
   * Nothing in the renderer reads this. It is here for the one question a file
   * cannot answer about itself — which side of a promotion a given flow was
   * authored on — for the flows that do carry a creation time somewhere else.
   * The lab's candidates do, in `lab.sqlite3`; a flow somebody named by hand
   * does not, and no amount of inspection will place it.
   */
  promotedAt: string;
}

/** Every era before the current one, oldest first. A version N file crosses each one above it. */
export const ERAS: readonly ResponseEra[] = [
  // ccf6968 "Add visual parameter calibration bench", 2026-08-27 10:28:03 -0400.
  { upTo: 3, delivered: DELIVERED_BEFORE_VERSION_3, promotedAt: '2026-08-27T14:28:03Z' },
];

/** The version something made at `when` was authored under. */
export function versionAt(when: Date | string | number): number {
  const at =
    typeof when === 'number' ? when : typeof when === 'string' ? Date.parse(when) : when.getTime();
  let version = OLDEST_RESPONSE_SET_VERSION;
  for (const era of ERAS) if (at >= Date.parse(era.promotedAt)) version = era.upTo;
  return version;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * The stored number that makes `response` answer `target`.
 *
 * The inverse of `evaluateResponse`, and it has to be written against that
 * function rather than derived from the curve's name: `centered-power` reaches
 * its two halves from `center` by different spans, and inverting the wrong half
 * lands a value on the wrong side of neutral, which for a rotation is the
 * difference between spinning one way and the other.
 *
 * **Not always exact, and it says so.** A response with a maximum reach below
 * one cannot answer what its predecessor answered at the endpoints — that is
 * what a reach change *is* — so the caller is told rather than handed a clamped
 * number that quietly means something else.
 */
export function invertResponse(
  response: ParameterResponse,
  target: number,
): { value: number; exact: boolean } {
  if (isIdentityResponse(response)) return { value: clamp01(target), exact: true };
  switch (response.kind) {
    case 'linear': {
      if (response.max === response.min) return { value: 0, exact: target === response.min };
      const raw = (target - response.min) / (response.max - response.min);
      return { value: clamp01(raw), exact: raw >= 0 && raw <= 1 };
    }
    case 'exponential': {
      if (response.min <= 0 || response.max <= 0 || response.max === response.min) {
        return { value: 0, exact: false };
      }
      const raw = Math.log(target / response.min) / Math.log(response.max / response.min);
      return { value: clamp01(raw), exact: raw >= 0 && raw <= 1 };
    }
    case 'centered-power': {
      const { center, neutral, min, max, exponent } = response;
      if (exponent <= 0) return { value: clamp01(center), exact: false };
      if (target === neutral) return { value: clamp01(center), exact: true };
      // Which half, decided by the target rather than by the sign of anything:
      // a response may put `neutral` anywhere between `min` and `max`.
      const below = target < neutral;
      const span = below ? neutral - min : max - neutral;
      if (span === 0) return { value: clamp01(center), exact: false };
      const reach = (below ? neutral - target : target - neutral) / span;
      const distance = Math.pow(clamp01(reach), 1 / exponent);
      const arm = below ? Math.max(center, 1e-9) : Math.max(1 - center, 1e-9);
      const value = below ? center - distance * arm : center + distance * arm;
      return { value: clamp01(value), exact: reach <= 1 };
    }
    case 'steps': {
      // The middle of the bucket whose value is nearest: the representative that
      // survives a later change to how many steps there are.
      if (response.values.length === 0) return { value: 0, exact: false };
      let at = 0;
      for (let i = 1; i < response.values.length; i += 1) {
        const best = response.values[at] ?? 0;
        const here = response.values[i] ?? 0;
        if (Math.abs(here - target) < Math.abs(best - target)) at = i;
      }
      return {
        value: clamp01((at + 0.5) / response.values.length),
        exact: (response.values[at] ?? 0) === target,
      };
    }
  }
}

/** One stored number that a version change moved, and where it lives. */
export interface ResponseChange {
  flow: string;
  node: string;
  inlet: string;
  key: string;
  was: number;
  now: number;
  /** What both numbers deliver — the thing the migration is preserving. */
  delivers: number;
  unit: string;
  /**
   * False when the new response cannot answer what the old one did, which is a
   * deliberate maximum-reach change rather than a bug. The value is the closest
   * the new range reaches.
   */
  exact: boolean;
}

/**
 * Every flow's stored values, re-solved from `from` to the current version.
 *
 * Returns new objects throughout rather than mutating: this runs inside
 * `merge`, whose contract is that a scheme goes in and a repaired one comes
 * out, and a caller comparing the two is how the report tool works.
 */
export function migrateFlowResponses(
  flows: Record<string, FlowDef>,
  from: number,
): { flows: Record<string, FlowDef>; changes: ResponseChange[] } {
  const changes: ResponseChange[] = [];
  const out: Record<string, FlowDef> = {};
  let moved = false;

  for (const [id, def] of Object.entries(flows)) {
    // A flow may be ahead of its scheme — see `FlowDef.responses`. Its own stamp
    // wins, and is then dropped: once this returns, the scheme's stamp is true
    // of every flow in it and a second opinion in the file could only go stale.
    const at = def.responses ?? from;
    const crossing = ERAS.filter((era) => at < era.upTo);
    const stamped = def.responses !== undefined;

    if (crossing.length === 0 && !stamped) {
      out[id] = def;
      continue;
    }

    let touched = false;
    const nodes = def.circuit.nodes.map((node) => {
      const next = crossing.length === 0 ? node : migrateNode(node, crossing, id, changes);
      if (next !== node) touched = true;
      return next;
    });

    if (!touched && !stamped) {
      out[id] = def;
      continue;
    }

    const carried: FlowDef = { ...def, ...(touched ? { circuit: { ...def.circuit, nodes } } : {}) };
    delete carried.responses;
    out[id] = carried;
    moved = true;
  }

  return { flows: moved ? out : flows, changes };
}

function migrateNode(
  node: CircuitNode,
  crossing: readonly { delivered: Readonly<Record<string, (stored: number) => number>> }[],
  flow: string,
  changes: ResponseChange[],
): CircuitNode {
  if (!node.values) return node;
  let values: Record<string, number> | null = null;

  for (const [inlet, stored] of Object.entries(node.values)) {
    if (typeof stored !== 'number' || !Number.isFinite(stored)) continue;
    const key = responseKey({ kind: node.kind, mode: node.op ?? '', inlet });
    const response = PRODUCTION_RESPONSES[key];
    if (!response) continue;

    // Through every era between the file's version and this one, oldest first,
    // so a value two versions behind is carried rather than skipped.
    let delivers = stored;
    for (const era of crossing) delivers = (era.delivered[key] ?? ((v: number) => v))(delivers);

    const { value, exact } = invertResponse(response, delivers);
    // Below what a 0-1 control can express. Some of these round-trip through a
    // constant the shader wrote to seven figures rather than to TAU, so an exact
    // comparison would rewrite every swirl in the file to move a picture by
    // nothing — and a migration that dirties a flow it did not change is a
    // migration nobody can review.
    if (Math.abs(value - stored) < 1e-6) continue;

    values ??= { ...node.values };
    values[inlet] = value;
    changes.push({
      flow,
      node: node.id,
      inlet,
      key,
      was: stored,
      now: value,
      delivers,
      unit: response.unit,
      exact,
    });
  }

  return values ? { ...node, values } : node;
}

/** Whether a scheme at `version` has numbers this build would read differently. */
export function needsResponseMigration(version: number | undefined): boolean {
  return (version ?? OLDEST_RESPONSE_SET_VERSION) < RESPONSE_SET_VERSION;
}
