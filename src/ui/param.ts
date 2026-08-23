import type { Param } from '../../../widgets/src/param/param.ts';

/**
 * The one adapter between `widgets/` and this app.
 *
 * `widgets/` knows nothing about Live and nothing about a show — it takes a
 * `Param` and a number, and that boundary is what makes the same control
 * usable in a device chain and in a visuals editor. `ui/` has exactly one file doing this
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

/** How long a layer's stack may get, whatever the cascade offers it. */
export const MAX_LOOKS: Param = {
  kind: 'int',
  min: 1,
  max: 4,
  defaultValue: 2,
  unit: 'int',
  name: 'Max flows',
  shortName: 'Max flows',
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

/**
 * The designer's own tempo, when it is not following a room.
 *
 * A float rather than an int because Live's tempo is one, and a flow built at
 * 128.5 should be judged at 128.5. Live's own range, so nothing here refuses a
 * number Ableton would accept.
 */
export const BPM: Param = {
  kind: 'float',
  min: 20,
  max: 999,
  defaultValue: 120,
  unit: 'float',
  name: 'Tempo',
  shortName: 'BPM',
};

/**
 * A number inside a circuit: a `value` node's own, or one set on an inlet.
 *
 * Every number inside a circuit is 0–1 by construction, so all of them get the
 * same control and nothing has to declare a range. That uniformity is what
 * makes the vocabulary composable — see `render/circuit.ts`.
 */
export const VALUE: Param = {
  kind: 'float',
  min: 0,
  max: 100,
  defaultValue: 50,
  unit: 'percent',
  name: 'Value',
  shortName: 'Value',
};


/**
 * How often the wheel turns, in bars.
 *
 * Bars rather than seconds because everything here is musical, and a picture
 * that changes 11.4 seconds in changes in the middle of a phrase. Zero holds
 * whatever is up, which is how you stop it turning without emptying the pool.
 */
export const BARS: Param = {
  kind: 'int',
  min: 0,
  max: 64,
  defaultValue: 8,
  unit: 'int',
  name: 'Bars',
  shortName: 'Bars',
};
