import type {
  CalibrationOption,
  CalibrationSubmission,
  CalibrationTrial,
  Circuit,
  CircuitNode,
  FlowDef,
  LabRoom,
  NodeKind,
  Scheme,
} from './protocol.ts';
import {
  NODE_SPECS,
  inletsOf,
  modesOf,
  type PortSpec,
} from './src/render/circuit.ts';
import {
  type ParameterResponse,
  type ResponseTarget,
} from './response.ts';

/** Bumped when the same frozen trial would render differently. */
export const CALIBRATION_RENDERER_VERSION = 1;

/** Bump this once when the generated fixture or candidate recipe changes. */
export const AUTOMATIC_TRIAL_VERSION = 1;

/** The id under which the calibration bench parks its one fixture. */
export const CALIBRATION_FLOW = '~calibration';

const ROOM: LabRoom = {
  tempo: 112,
  quantum: 4,
  energy: 0.32,
  section: 'motion',
  sections: ['motion'],
  key: null,
  colors: ['#ffb347', '#45d6c8', '#6257ff'],
  seed: 'parameter-response@1',
};

const TAU = Math.PI * 2;

/**
 * These are the definitions that were actually offered in the first export.
 * They deliberately do not read PRODUCTION_RESPONSES: accepting a result must
 * never rewrite the historical question for a fresh calibration database.
 */
const ROTATION_V1: Readonly<Record<'spin' | 'swirl' | 'twist', ParameterResponse>> = {
  spin: {
    kind: 'centered-power',
    center: 0.5,
    min: -0.3 / TAU,
    neutral: 0,
    max: 0.3 / TAU,
    exponent: 1,
    unit: 'turn/beat',
  },
  swirl: {
    kind: 'centered-power',
    center: 0.5,
    min: -1,
    neutral: 0,
    max: 1,
    exponent: 1,
    unit: 'turn/radius',
  },
  twist: {
    kind: 'centered-power',
    center: 0.5,
    min: -4.5 / TAU,
    neutral: 0,
    max: 4.5 / TAU,
    exponent: 1,
    unit: 'turn/radius',
  },
};

function powered(base: ParameterResponse, exponent: number): ParameterResponse {
  if (base.kind !== 'centered-power') throw new Error('a power comparison needs a centred response');
  return { ...base, exponent };
}

function powerOptions(
  base: ParameterResponse,
  order: readonly number[],
  exponents: readonly number[] = [1, 2, 3],
): CalibrationOption[] {
  const ids: Readonly<Record<string, string>> = {
    '0.5': 'root',
    '1': 'linear',
    '2': 'square',
    '3': 'cube',
  };
  const profiles = exponents.map((exponent, at): CalibrationOption => ({
    id: ids[String(exponent)] ?? `power-${at}-${exponent}`,
    response: powered(base, exponent),
  }));
  return order.map((at) => profiles[at]!).filter(Boolean);
}

function output(nodes: CircuitNode[], cords: Circuit['cords'], name: string): FlowDef {
  return {
    name,
    circuit: {
      nodes: [...nodes, { id: 'out', kind: 'out', x: 700, y: 100 }],
      cords: [...cords, { from: `${nodes[nodes.length - 1]!.id}/c`, to: 'out/c' }],
    },
  };
}

function rotationFixture(mode: 'swirl' | 'kaleido' | 'twist'): FlowDef {
  const values: Record<string, number> =
    mode === 'kaleido'
      ? { segments: 0.22, spin: 0.5 }
      : mode === 'twist'
        ? { turn: 0.5, sway: 0 }
        : { turn: 0.5 };
  return output(
    [
      { id: 'grid', kind: 'source', op: 'grid', x: 40, y: 80 },
      { id: 'subject', kind: 'lens', op: mode, x: 340, y: 80, values },
    ],
    [{ from: 'grid/c', to: 'subject/c' }],
    `${mode} response`,
  );
}

const swirl: ResponseTarget = { kind: 'lens', mode: 'swirl', inlet: 'turn' };
const spin: ResponseTarget = { kind: 'lens', mode: 'kaleido', inlet: 'spin' };
const twist: ResponseTarget = { kind: 'lens', mode: 'twist', inlet: 'turn' };

const ROTATION_TRIALS: readonly CalibrationTrial[] = [
  {
    id: 'rotation-kaleido-spin',
    version: 1,
    batch: 'rotation-1',
    name: 'kaleidoscope spin',
    question: 'Which response makes slow beat-driven rotation easiest to find without losing a useful fast edge?',
    target: { ...spin, nodeId: 'subject' },
    flow: rotationFixture('kaleido'),
    room: ROOM,
    initialValue: 0.62,
    options: powerOptions(ROTATION_V1.spin, [1, 0, 2]),
  },
  {
    id: 'rotation-swirl-turn',
    version: 1,
    batch: 'rotation-1',
    name: 'swirl turn',
    question: 'Which response gives the spatial turn a broad, calm middle while keeping the outer range available?',
    target: { ...swirl, nodeId: 'subject' },
    flow: rotationFixture('swirl'),
    room: ROOM,
    initialValue: 0.62,
    options: powerOptions(ROTATION_V1.swirl, [2, 1, 0]),
  },
  {
    id: 'rotation-twist-turn',
    version: 1,
    batch: 'rotation-1',
    name: 'twist turn',
    question: 'Which response makes a restrained twist easy to dial before the picture becomes disorienting?',
    target: { ...twist, nodeId: 'subject' },
    flow: rotationFixture('twist'),
    room: ROOM,
    initialValue: 0.62,
    options: powerOptions(ROTATION_V1.twist, [0, 2, 1]),
  },
];

/**
 * Number routers are linear by contract, toggles are categorical, and media
 * controls need a known development asset before their result would be useful.
 * Everything else here changes a picture and has a subjective useful range.
 */
const CALIBRATABLE_KINDS: ReadonlySet<NodeKind> = new Set([
  'source',
  'field',
  'fractal',
  'light',
  'last',
  'colorway',
  'lens',
  'displace',
  'grade',
  'spread',
  'halftone',
  'blend',
  'lfo',
]);

function targetKey(target: Pick<ResponseTarget, 'kind' | 'mode' | 'inlet'>): string {
  return `${target.kind}/${target.mode}/${target.inlet}`;
}

const HISTORIC_TARGETS = new Set(ROTATION_TRIALS.map((trial) => targetKey(trial.target)));

/** Controls whose useful resting area is the middle of their current range. */
const CENTERED_TARGETS = new Set([
  'lens/zoom/by',
  'lens/mirror/line',
  'lens/mirror/angle',
  'lens/creep/grow',
  'fractal/mandelbrot/turn',
  'fractal/julia/turn',
  'grade/levels/gain',
  'grade/levels/lift',
  'grade/saturate/amount',
  'grade/hue/shift',
  'grade/tint/bias',
  'halftone/dots/tilt',
  'halftone/lines/tilt',
  'light/beam/aim',
]);

function blindOrder(key: string): readonly number[] {
  let hash = 2166136261;
  for (const char of key) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const orders = [
    [0, 1, 2],
    [1, 2, 0],
    [2, 0, 1],
  ] as const;
  return orders[Math.abs(hash) % orders.length]!;
}

function normalizedBase(target: ResponseTarget): ParameterResponse {
  const centered = CENTERED_TARGETS.has(targetKey(target));
  return {
    kind: 'centered-power',
    center: centered ? 0.5 : 0,
    min: 0,
    neutral: centered ? 0.5 : 0,
    max: 1,
    exponent: 1,
    unit: 'current range',
  };
}

function calibratable(kind: NodeKind, inlet: PortSpec): boolean {
  if (!CALIBRATABLE_KINDS.has(kind) || inlet.kind !== 'n' || inlet.control === 'toggle') return false;
  // Phase is an exact normalized offset. Rate is the LFO's subjective control.
  if (kind === 'lfo' && inlet.name !== 'rate') return false;
  return true;
}

function picture(id: string, op: 'grid' | 'plasma' | 'rings', x: number, y: number): CircuitNode {
  return { id, kind: 'source', op, x, y };
}

function fixture(kind: NodeKind, mode: string): FlowDef {
  const subject: CircuitNode = { id: 'subject', kind, ...(mode ? { op: mode } : {}), x: 340, y: 100 };
  const out: CircuitNode = { id: 'out', kind: 'out', x: 720, y: 110 };
  const direct = new Set<NodeKind>(['source', 'field', 'fractal', 'light', 'colorway']);

  if (direct.has(kind)) {
    return {
      name: `${kind} ${mode}`.trim(),
      circuit: { nodes: [subject, out], cords: [{ from: 'subject/c', to: 'out/c' }] },
    };
  }

  if (kind === 'lens') {
    return {
      name: `lens ${mode}`,
      circuit: {
        nodes: [picture('picture', 'grid', 40, 80), subject, out],
        cords: [
          { from: 'picture/c', to: 'subject/c' },
          { from: 'subject/c', to: 'out/c' },
        ],
      },
    };
  }

  if (kind === 'grade' || kind === 'spread' || kind === 'halftone') {
    return {
      name: `${kind} ${mode}`,
      circuit: {
        nodes: [picture('picture', 'plasma', 40, 80), subject, out],
        cords: [
          { from: 'picture/c', to: 'subject/c' },
          { from: 'subject/c', to: 'out/c' },
        ],
      },
    };
  }

  if (kind === 'displace') {
    return {
      name: `displace ${mode}`,
      circuit: {
        nodes: [
          picture('picture', 'grid', 40, 40),
          picture('field', 'plasma', 40, 260),
          subject,
          out,
        ],
        cords: [
          { from: 'field/c', to: 'subject/field' },
          { from: 'subject/p', to: 'picture/p' },
          { from: 'picture/c', to: 'out/c' },
        ],
      },
    };
  }

  if (kind === 'blend') {
    return {
      name: `blend ${mode}`,
      circuit: {
        nodes: [
          picture('base', 'plasma', 40, 40),
          picture('top', 'grid', 40, 260),
          subject,
          out,
        ],
        cords: [
          { from: 'base/c', to: 'subject/base' },
          { from: 'top/c', to: 'subject/top' },
          { from: 'subject/c', to: 'out/c' },
        ],
      },
    };
  }

  if (kind === 'last') {
    const mix: CircuitNode = {
      id: 'mix',
      kind: 'blend',
      op: 'screen',
      values: { amount: 0.72 },
      x: 520,
      y: 120,
    };
    return {
      name: 'last fade',
      circuit: {
        nodes: [picture('picture', 'rings', 40, 80), subject, mix, out],
        cords: [
          { from: 'picture/c', to: 'mix/base' },
          { from: 'subject/c', to: 'mix/top' },
          { from: 'mix/c', to: 'out/c' },
        ],
      },
    };
  }

  if (kind === 'lfo') {
    const colour: CircuitNode = { id: 'colour', kind: 'grade', op: 'hue', x: 520, y: 100 };
    return {
      name: `lfo ${mode}`,
      circuit: {
        nodes: [picture('picture', 'plasma', 40, 80), subject, colour, out],
        cords: [
          { from: 'picture/c', to: 'colour/c' },
          { from: 'subject/n', to: 'colour/shift' },
          { from: 'colour/c', to: 'out/c' },
        ],
      },
    };
  }

  throw new Error(`there is no calibration fixture for ${kind}/${mode}`);
}

function automaticTrials(): CalibrationTrial[] {
  const trials: CalibrationTrial[] = [];
  for (const kind of Object.keys(NODE_SPECS) as NodeKind[]) {
    if (!CALIBRATABLE_KINDS.has(kind)) continue;
    const modes = modesOf(kind);
    for (const mode of modes.length > 0 ? modes : ['']) {
      const node: CircuitNode = { id: 'subject', kind, ...(mode ? { op: mode } : {}), x: 0, y: 0 };
      for (const inlet of inletsOf(node)) {
        if (!calibratable(kind, inlet)) continue;
        const target: ResponseTarget = { kind, mode, inlet: inlet.name };
        const key = targetKey(target);
        if (HISTORIC_TARGETS.has(key)) continue;
        const device = mode ? `${kind} · ${mode}` : kind;
        trials.push({
          id: `parameter-${[kind, mode || 'default', inlet.name].join('-')}`,
          version: AUTOMATIC_TRIAL_VERSION,
          batch: 'visual-parameters-1',
          name: `${device} · ${inlet.name}`,
          question: `Which response makes this control easy to place and animate? ${inlet.description}`,
          target: { ...target, nodeId: 'subject' },
          flow: fixture(kind, mode),
          room: ROOM,
          initialValue: 0.62,
          options: powerOptions(
            normalizedBase(target),
            blindOrder(key),
            CENTERED_TARGETS.has(key) ? [1, 2, 3] : [0.5, 1, 2],
          ),
        });
      }
    }
  }
  return trials;
}

/**
 * Source-controlled questions. SQLite freezes the exact flow, room, and
 * options on first sight, so changing the generated recipe means incrementing
 * AUTOMATIC_TRIAL_VERSION rather than rewriting evidence in place.
 */
export const CALIBRATION_TRIALS: readonly CalibrationTrial[] = [
  ...ROTATION_TRIALS,
  ...automaticTrials(),
];

/** A fixture with only its target value changed; response candidates stay outside the scheme. */
export function calibrationScheme(trial: CalibrationTrial, value: number): Scheme {
  const flow: FlowDef = {
    ...trial.flow,
    circuit: {
      ...trial.flow.circuit,
      nodes: trial.flow.circuit.nodes.map((node) =>
        node.id === trial.target.nodeId
          ? {
              ...node,
              values: { ...node.values, [trial.target.inlet]: Math.max(0, Math.min(1, value)) },
            }
          : node,
      ),
    },
  };
  return {
    flows: { [CALIBRATION_FLOW]: flow },
    colorways: {},
    rotation: { flows: [], colorways: [], bars: 0, onClip: false, colorEvery: 0 },
    songs: {},
    defaults: { colorway: '', flow: CALIBRATION_FLOW, pace: 0, draws: 'by name' },
  };
}

export function calibrationProblems(submission: CalibrationSubmission): string[] {
  const problems: string[] = [];
  if (submission.selectedOptionId === null && !submission.note?.trim()) {
    problems.push('say why none of the responses works');
  }
  if (submission.selectedOptionId === null && submission.response !== null) {
    problems.push('a reject-all decision cannot carry a chosen response');
  }
  if (submission.selectedOptionId !== null && submission.response === null) {
    problems.push('the chosen response is missing');
  }
  if (!Number.isFinite(submission.extent) || submission.extent < 0.01 || submission.extent > 2) {
    problems.push('the maximum reach is outside the calibration range');
  }
  return problems;
}
