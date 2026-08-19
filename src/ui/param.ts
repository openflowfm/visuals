import type { Param } from '../../../widgets/src/param/param.ts';

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
