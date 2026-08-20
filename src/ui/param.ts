import type { Param } from '../../../widgets/src/param/param.ts';
import type { EffectParam } from '../render/shaders.ts';

/**
 * The one adapter between `widgets/` and this app.
 *
 * `widgets/` knows nothing about Live and nothing about a show — it takes a
 * `Param` and a number, and that boundary is what makes the same knob usable in
 * a device chain and in a visuals editor. `ui/` has exactly one file doing this
 * job (`lib/liveParam.ts`); this is its opposite number, and it should stay the
 * only place in `visuals/` that mentions the widget parameter model.
 *
 * Nothing here is Live's vocabulary either. A scheme field is a range and a
 * spelling, which is all a control ever needed to know.
 */

/**
 * The scheme stores its 0–1 fields as 0–1; the controls run 0–100.
 *
 * Two reasons, and the second is the one that bit. Energy is *talked* about in
 * percent — "the chorus is at ninety" — and two decimal places on a 0–1 float
 * is a reading nobody parses at a glance. And `widgets`' `percent` style
 * formats the **raw value**, so a 0–1 parameter labelled percent reads `1 %` at
 * full. The scaling therefore belongs to the caller, and this is the only place
 * it happens.
 */
export const PERCENT = {
  to: (unit: number) => unit * 100,
  from: (percent: number) => percent / 100,
};

/** A section's energy, and the layer floor that shares its range. */
export const ENERGY: Param = {
  kind: 'float',
  min: 0,
  max: 100,
  defaultValue: 50,
  unit: 'percent',
  name: 'Energy',
  shortName: 'Energy',
};

/**
 * A bias, which is bipolar and therefore fills from the middle.
 *
 * That is not a styling choice — `fill.ts` decides it from where zero lands in
 * the travel, and a bias of zero genuinely is the middle rather than the
 * bottom. Same reasoning that makes a pan knob different from a volume fader.
 */
export const BIAS: Param = {
  kind: 'float',
  min: -50,
  max: 50,
  defaultValue: 0,
  unit: 'percent',
  name: 'Bias',
  shortName: 'Bias',
};

/** The energy at which a layer joins the picture. */
export const FLOOR: Param = {
  kind: 'float',
  min: 0,
  max: 100,
  defaultValue: 0,
  unit: 'percent',
  name: 'Floor',
  shortName: 'Floor',
};

/** How many effects a layer may carry, whatever the cascade offers it. */
export const MAX_EFFECTS: Param = {
  kind: 'int',
  min: 0,
  max: 3,
  defaultValue: 2,
  unit: 'int',
  name: 'Max effects',
  shortName: 'Max fx',
};

/**
 * A shift along the ladder of divisions a layer reacts on.
 *
 * Whole rungs, which is why it is an `int` — every rung is a musical division
 * and a rate between two of them is in time with nothing, so a control that
 * could land at 0.4 would be a control that could take the show off the grid.
 */
export const PACE: Param = {
  kind: 'int',
  min: -2,
  max: 2,
  defaultValue: 0,
  unit: 'int',
  name: 'Pace',
  shortName: 'Pace',
};

/** How hard the bench drives the effect it is showing. */
export const AMOUNT: Param = {
  kind: 'float',
  min: 0,
  max: 100,
  defaultValue: 100,
  unit: 'percent',
  name: 'Amount',
  shortName: 'Amount',
};

/**
 * A circuit's own knob.
 *
 * Every number inside a circuit is 0–1 by construction, so every `value` node
 * gets the same control and nothing has to declare a range. That uniformity is
 * what makes the vocabulary composable — see `render/circuit.ts`.
 */
export const KNOB: Param = {
  kind: 'float',
  min: 0,
  max: 100,
  defaultValue: 50,
  unit: 'percent',
  name: 'Knob',
  shortName: 'Knob',
};

/**
 * A built-in effect's declared parameter, as something a knob can turn.
 *
 * A range whose ends and resting point are all whole numbers, and which is wide
 * enough for the distinction to matter, is a count of something — segments,
 * blocks, waves — so it reads as one. Everything else is a proportion and reads
 * with a decimal. Guessing this from the numbers rather than declaring it keeps
 * `BUILTIN_PARAMS` a table of ranges instead of a table of ranges and spellings.
 */
export function effectParam(spec: EffectParam): Param {
  const counted =
    Number.isInteger(spec.min) &&
    Number.isInteger(spec.max) &&
    Number.isInteger(spec.value) &&
    spec.max - spec.min >= 4;
  return {
    kind: counted ? 'int' : 'float',
    min: spec.min,
    max: spec.max,
    defaultValue: spec.value,
    unit: counted ? 'int' : 'float',
    name: spec.name,
    shortName: spec.name,
  };
}
