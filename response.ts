import type { NodeKind } from './protocol.ts';

/**
 * The executable meaning of one normalized number inlet.
 *
 * Flows keep storing and carrying 0–1. A response is applied only at the
 * consuming inlet, after its base and modulation depth have been combined, so
 * the graph remains freely composable while a node can spend that range where
 * the eye can actually use it.
 */
export type ParameterResponse =
  | {
      kind: 'linear';
      min: number;
      max: number;
      unit: string;
    }
  | {
      kind: 'exponential';
      /** Strictly positive: this is min * (max / min) ^ value. */
      min: number;
      max: number;
      unit: string;
    }
  | {
      kind: 'centered-power';
      /** The normalized position whose answer is `neutral`. */
      center: number;
      min: number;
      neutral: number;
      max: number;
      /** One is linear; larger values devote more travel to the neutral area. */
      exponent: number;
      unit: string;
    }
  | {
      kind: 'steps';
      values: readonly number[];
      unit: string;
    };

export interface ResponseTarget {
  kind: NodeKind;
  mode: string;
  inlet: string;
}

/** Candidate responses are keyed by meaning, never by a fixture node id. */
export type ResponseOverrides = Readonly<Record<string, ParameterResponse>>;

export const RESPONSE_SET_VERSION = 3;

const TAU = Math.PI * 2;

/** A stable address shared by the vocabulary, compiler, bench, and evidence. */
export function responseKey(target: ResponseTarget): string {
  return `${target.kind}/${target.mode}/${target.inlet}`;
}

type NormalizedCalibration = readonly [
  exponent: number,
  maximumReach?: number,
  center?: number,
];

/**
 * Accepted visual-parameter decisions from calibration export version 2.
 *
 * These parameters still have their historic domain arithmetic in the shader,
 * so the calibrated response shapes that normalized input. The tuple is
 * exponent, optional maximum reach, and optional neutral centre. Keeping the
 * evidence compact makes the exceptional root/square choices visible rather
 * than burying them in eighty copies of the same response object.
 */
export const NORMALIZED_CALIBRATIONS = {
  'blend/add/amount': [2],
  'blend/screen/amount': [1],
  'blend/multiply/amount': [1],
  'blend/stencil/amount': [2],
  'blend/cut/amount': [2],
  'lfo/sine/rate': [2],
  'lfo/triangle/rate': [2],
  'lfo/saw/rate': [2],
  'lfo/square/rate': [1],
  'lfo/sample-hold/rate': [0.5, 1.5],
  'source/solid/energy': [1],
  'source/bars/energy': [2],
  'source/bars/columns': [1],
  'source/rings/energy': [2, 0.8],
  'source/rings/flight': [1],
  'source/noise/energy': [2],
  'source/noise/weave': [1, 1.5],
  'source/noise/cover': [1, 1.5],
  'source/strobe/energy': [1],
  'source/strobe/pulse': [1],
  'source/grid/energy': [1],
  'source/grid/tiles': [1],
  'source/tunnel/energy': [0.5],
  'source/tunnel/spokes': [1],
  'source/plasma/energy': [2],
  'source/plasma/weave': [1],
  'source/spiral/energy': [2],
  'source/spiral/arms': [1],
  'source/spiral/coil': [2],
  'source/scan/energy': [0.5],
  'source/scan/lines': [2],
  'source/sparks/energy': [0.5],
  'source/sparks/shower': [2],
  'source/checker/energy': [2],
  'source/checker/tiles': [1],
  'source/rays/energy': [2],
  'source/rays/spokes': [0.5],
  'field/cells/energy': [0.5],
  'field/cells/weave': [1],
  'field/clouds/energy': [1],
  'field/clouds/weave': [2],
  'field/metaballs/energy': [1],
  'field/metaballs/balls': [1],
  'field/metaballs/apart': [0.5, 0.78],
  'fractal/mandelbrot/energy': [0.5],
  'fractal/mandelbrot/zoom': [2],
  'fractal/mandelbrot/turn': [1, 1, 0.5],
  'fractal/mandelbrot/detail': [1],
  'fractal/julia/energy': [0.5],
  'fractal/julia/zoom': [1],
  'fractal/julia/turn': [1, 1, 0.5],
  'fractal/julia/detail': [1],
  'fractal/julia/shape': [1],
  'light/lamp/energy': [1],
  'light/lamp/carry': [2],
  'light/lamp/soft': [0.5],
  'light/beam/energy': [1],
  'light/beam/aim': [1, 1, 0.5],
  'light/beam/spread': [1],
  'light/shafts/energy': [1],
  'light/shafts/blades': [1],
  'light/shafts/haze': [2],
  'light/caustics/energy': [0.5],
  'light/caustics/weave': [2],
  'light/caustics/glint': [1],
  'last//fade': [1],
  'colorway//amount': [1],
  'colorway//energy': [1],
  'lens/zoom/by': [1, 1, 0.5],
  'lens/fold/sides': [1],
  'lens/wobble/amount': [2],
  'lens/tile/count': [1],
  'lens/mirror/line': [1, 1, 0.5],
  'lens/mirror/angle': [1, 1, 0.5],
  'lens/kaleido/energy': [1],
  'lens/kaleido/segments': [1],
  'lens/twist/energy': [0.5],
  'lens/twist/sway': [2],
  'lens/ripple/energy': [0.5],
  'lens/ripple/waves': [1],
  'lens/ripple/depth': [0.5],
  'lens/ripple/speed': [2],
} as const satisfies Readonly<Record<string, NormalizedCalibration>>;

function normalizedResponse(
  [exponent, maximumReach = 1, center = 0]: NormalizedCalibration,
): ParameterResponse {
  return {
    kind: 'centered-power',
    center,
    min: center + (0 - center) * maximumReach,
    neutral: center,
    max: center + (1 - center) * maximumReach,
    exponent,
    unit: 'current range',
  };
}

const ROTATION_RESPONSES: Readonly<Record<string, ParameterResponse>> = {
  [responseKey({ kind: 'lens', mode: 'swirl', inlet: 'turn' })]: {
    kind: 'centered-power',
    center: 0.5,
    min: -1,
    neutral: 0,
    max: 1,
    exponent: 1,
    unit: 'turn/radius',
  },
  [responseKey({ kind: 'lens', mode: 'kaleido', inlet: 'spin' })]: {
    kind: 'centered-power',
    center: 0.5,
    min: -0.45 / TAU,
    neutral: 0,
    max: 0.45 / TAU,
    exponent: 2,
    unit: 'turn/beat',
  },
  [responseKey({ kind: 'lens', mode: 'twist', inlet: 'turn' })]: {
    kind: 'centered-power',
    center: 0.5,
    min: -6.75 / TAU,
    neutral: 0,
    max: 6.75 / TAU,
    exponent: 1,
    unit: 'turn/radius',
  },
};

/** Every accepted response in source; the SQLite database remains evidence only. */
export const PRODUCTION_RESPONSES: Readonly<Record<string, ParameterResponse>> = {
  ...ROTATION_RESPONSES,
  ...Object.fromEntries(
    Object.entries(NORMALIZED_CALIBRATIONS).map(([key, calibration]) => [
      key,
      normalizedResponse(calibration),
    ]),
  ),
};

/**
 * Automatic trial version one was judged against response-set version two.
 * Supplying these identities beside a candidate keeps accepted results on
 * helper nodes from changing the remaining forty fixtures underneath it.
 */
export const CALIBRATION_BASELINE_RESPONSES: ResponseOverrides = Object.fromEntries(
  Object.entries(NORMALIZED_CALIBRATIONS).map(([key, calibration]) => [
    key,
    normalizedResponse([1, 1, calibration[2] ?? 0]),
  ]),
);

export function productionResponse(target: ResponseTarget): ParameterResponse | undefined {
  return PRODUCTION_RESPONSES[responseKey(target)];
}

/** The TypeScript half of the response contract, used by readouts and tests. */
export function evaluateResponse(response: ParameterResponse, input: number): number {
  const value = Math.max(0, Math.min(1, input));
  if (isIdentityResponse(response)) return value;
  switch (response.kind) {
    case 'linear':
      return response.min + (response.max - response.min) * value;
    case 'exponential':
      return response.min * Math.pow(response.max / response.min, value);
    case 'centered-power': {
      if (value === response.center) return response.neutral;
      if (value < response.center) {
        const distance = (response.center - value) / Math.max(response.center, 1e-9);
        return response.neutral + (response.min - response.neutral) * Math.pow(distance, response.exponent);
      }
      const distance = (value - response.center) / Math.max(1 - response.center, 1e-9);
      return response.neutral + (response.max - response.neutral) * Math.pow(distance, response.exponent);
    }
    case 'steps': {
      if (response.values.length === 0) return 0;
      const at = Math.min(response.values.length - 1, Math.floor(value * response.values.length));
      return response.values[at] ?? 0;
    }
  }
}

/** A normalized response that changes neither held nor modulated values. */
export function isIdentityResponse(response: ParameterResponse): boolean {
  return (
    response.kind === 'centered-power' &&
    response.exponent === 1 &&
    response.min === 0 &&
    response.neutral === response.center &&
    response.max === 1
  );
}

const glslFloat = (value: number): string => {
  if (!Number.isFinite(value)) throw new Error('a parameter response contains a non-finite number');
  if (Number.isInteger(value)) return value.toFixed(1);
  return Number(value.toPrecision(12)).toString();
};

/** The GLSL half of the same contract. Its caller supplies the normalized inlet expression. */
export function responseGlsl(response: ParameterResponse, input: string): string {
  if (isIdentityResponse(response)) return input;
  const x = `(${input})`;
  switch (response.kind) {
    case 'linear':
      return `mix(${glslFloat(response.min)}, ${glslFloat(response.max)}, ${x})`;
    case 'exponential':
      if (response.min <= 0 || response.max <= 0) {
        throw new Error('an exponential parameter response must stay above zero');
      }
      return `(${glslFloat(response.min)} * pow(${glslFloat(response.max / response.min)}, ${x}))`;
    case 'centered-power': {
      const centre = glslFloat(response.center);
      const low = glslFloat(Math.max(response.center, 1e-9));
      const high = glslFloat(Math.max(1 - response.center, 1e-9));
      const exponent = glslFloat(response.exponent);
      const down = `pow(max((${centre} - ${x}) / ${low}, 0.0), ${exponent})`;
      const up = `pow(max((${x} - ${centre}) / ${high}, 0.0), ${exponent})`;
      return `mix(${glslFloat(response.neutral)} + (${glslFloat(response.min - response.neutral)}) * ${down}, ${glslFloat(response.neutral)} + (${glslFloat(response.max - response.neutral)}) * ${up}, step(${centre}, ${x}))`;
    }
    case 'steps': {
      if (response.values.length === 0) return '0.0';
      let expression = glslFloat(response.values[response.values.length - 1] ?? 0);
      for (let at = response.values.length - 2; at >= 0; at -= 1) {
        expression = `mix(${glslFloat(response.values[at] ?? 0)}, ${expression}, step(${glslFloat((at + 1) / response.values.length)}, ${x}))`;
      }
      return expression;
    }
  }
}

/** Scale a candidate's reach without changing its curve family. */
export function scaleResponse(response: ParameterResponse, extent: number): ParameterResponse {
  const scale = Math.max(0.01, Math.min(2, extent));
  if (response.kind === 'centered-power') {
    return {
      ...response,
      min: response.neutral + (response.min - response.neutral) * scale,
      max: response.neutral + (response.max - response.neutral) * scale,
    };
  }
  if (response.kind === 'linear') {
    const middle = (response.min + response.max) * 0.5;
    return {
      ...response,
      min: middle + (response.min - middle) * scale,
      max: middle + (response.max - middle) * scale,
    };
  }
  return response;
}

export function formatResponse(response: ParameterResponse, input: number): string {
  const value = evaluateResponse(response, input);
  const magnitude = Math.abs(value);
  const digits = magnitude >= 10 ? 1 : magnitude >= 1 ? 2 : magnitude >= 0.1 ? 3 : 4;
  const shown = value
    .toFixed(digits)
    .replace(/(\.\d*?[1-9])0+$/u, '$1')
    .replace(/\.0+$/u, '');
  return `${shown} ${response.unit}`;
}

/** Stable enough for compiler caches and persisted option identity. */
export function responseOverridesSignature(overrides?: ResponseOverrides): string {
  if (!overrides) return '';
  return Object.entries(overrides)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, response]) => `${key}:${JSON.stringify(response)}`)
    .join('|');
}
