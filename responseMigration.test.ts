import { describe, expect, it } from 'vitest';
import type { FlowDef } from './protocol.ts';
import {
  NORMALIZED_CALIBRATIONS,
  PRODUCTION_RESPONSES,
  RESPONSE_SET_VERSION,
  evaluateResponse,
  responseKey,
  type ParameterResponse,
} from './response.ts';
import {
  OLDEST_RESPONSE_SET_VERSION,
  invertResponse,
  migrateFlowResponses,
  needsResponseMigration,
} from './responseMigration.ts';

const TAU = Math.PI * 2;

const flow = (nodes: FlowDef['circuit']['nodes']): Record<string, FlowDef> => ({
  one: { name: 'One', circuit: { nodes, cords: [] } },
});

describe('inverting a response', () => {
  it('round-trips every production response it can answer', () => {
    for (const [key, response] of Object.entries(PRODUCTION_RESPONSES)) {
      for (const stored of [0, 0.13, 0.25, 0.5, 0.62, 0.75, 0.9, 1]) {
        const delivered = evaluateResponse(response, stored);
        const { value, exact } = invertResponse(response, delivered);
        expect(exact, `${key} at ${stored}`).toBe(true);
        expect(evaluateResponse(response, value), `${key} at ${stored}`).toBeCloseTo(delivered, 9);
      }
    }
  });

  it('lands on the right side of neutral, which a rotation reads as direction', () => {
    const spin = PRODUCTION_RESPONSES[responseKey({ kind: 'lens', mode: 'kaleido', inlet: 'spin' })]!;
    // Below centre must come back below centre. Inverting the wrong half here
    // spins the kaleidoscope the other way and nothing in the picture says so.
    expect(invertResponse(spin, evaluateResponse(spin, 0.2)).value).toBeLessThan(0.5);
    expect(invertResponse(spin, evaluateResponse(spin, 0.8)).value).toBeGreaterThan(0.5);
    expect(invertResponse(spin, 0).value).toBeCloseTo(0.5, 12);
  });

  it('reports a target the new range cannot reach rather than clamping quietly', () => {
    // `source/rings/energy` is a deliberate 80% maximum reach, so what a stored
    // 1.0 used to deliver is outside what any stored value can deliver now.
    const rings = PRODUCTION_RESPONSES[responseKey({ kind: 'source', mode: 'rings', inlet: 'energy' })]!;
    const beyond = invertResponse(rings, 1);
    expect(beyond.exact).toBe(false);
    expect(beyond.value).toBe(1);
  });

  it('inverts a linear and an exponential response', () => {
    const linear: ParameterResponse = { kind: 'linear', min: -2, max: 6, unit: 'px' };
    expect(invertResponse(linear, 2)).toEqual({ value: 0.5, exact: true });
    const exponential: ParameterResponse = { kind: 'exponential', min: 0.25, max: 4, unit: 'Hz' };
    expect(invertResponse(exponential, 1).value).toBeCloseTo(0.5, 12);
  });

  it('answers a steps response with the middle of the bucket', () => {
    const steps: ParameterResponse = { kind: 'steps', values: [0.25, 0.5, 1, 2], unit: 'beats' };
    expect(invertResponse(steps, 1)).toEqual({ value: 0.625, exact: true });
    expect(evaluateResponse(steps, 0.625)).toBe(1);
  });
});

describe('carrying a scheme across a response set', () => {
  it('keeps what an unchanged inlet delivers, and rewrites the number to do it', () => {
    // `blend/add/amount` became square, so 0.6 started delivering 0.36. The
    // migration asks for a number that still delivers 0.6.
    const { flows, changes } = migrateFlowResponses(
      flow([{ id: 'mix', kind: 'blend', op: 'add', x: 0, y: 0, values: { amount: 0.6 } }]),
      OLDEST_RESPONSE_SET_VERSION,
    );
    const response = PRODUCTION_RESPONSES[responseKey({ kind: 'blend', mode: 'add', inlet: 'amount' })]!;
    const now = flows.one.circuit.nodes[0].values!.amount;
    expect(evaluateResponse(response, now)).toBeCloseTo(0.6, 9);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ flow: 'one', node: 'mix', inlet: 'amount', was: 0.6, exact: true });
  });

  it('reproduces the shader term for the three inlets whose GLSL moved with them', () => {
    // fxKaleido used to add `uBeat * (spin - 0.5) * 0.6` and now adds
    // `uBeat * spin * TAU`, so the number has to change for the picture not to.
    const { flows } = migrateFlowResponses(
      flow([{ id: 'fold', kind: 'lens', op: 'kaleido', x: 0, y: 0, values: { spin: 0.62 } }]),
      OLDEST_RESPONSE_SET_VERSION,
    );
    const spin = PRODUCTION_RESPONSES[responseKey({ kind: 'lens', mode: 'kaleido', inlet: 'spin' })]!;
    const now = flows.one.circuit.nodes[0].values!.spin;
    expect(evaluateResponse(spin, now) * TAU).toBeCloseTo((0.62 - 0.5) * 0.6, 9);
  });

  it('leaves a swirl alone, because its endpoints already agreed', () => {
    const { flows, changes } = migrateFlowResponses(
      flow([{ id: 'sw', kind: 'lens', op: 'swirl', x: 0, y: 0, values: { turn: 0.8 } }]),
      OLDEST_RESPONSE_SET_VERSION,
    );
    expect(flows.one.circuit.nodes[0].values!.turn).toBeCloseTo(0.8, 9);
    expect(changes).toHaveLength(0);
  });

  it('touches nothing on a scheme already at this version', () => {
    const before = flow([{ id: 'mix', kind: 'blend', op: 'add', x: 0, y: 0, values: { amount: 0.6 } }]);
    const { flows, changes } = migrateFlowResponses(before, RESPONSE_SET_VERSION);
    expect(flows).toBe(before);
    expect(changes).toEqual([]);
  });

  it('does not carry a value twice', () => {
    // The hazard the stamp exists for: solving is not idempotent, so a second
    // pass over an already-carried file has to be refused by version, and the
    // only thing that refuses it is the number in `Scheme.responses`.
    const once = migrateFlowResponses(
      flow([{ id: 'mix', kind: 'blend', op: 'add', x: 0, y: 0, values: { amount: 0.6 } }]),
      OLDEST_RESPONSE_SET_VERSION,
    );
    const twice = migrateFlowResponses(once.flows, RESPONSE_SET_VERSION);
    expect(twice.flows.one.circuit.nodes[0].values!.amount).toBe(
      once.flows.one.circuit.nodes[0].values!.amount,
    );
  });

  it('ignores an inlet nothing has dialled and a kind with no response', () => {
    const { flows, changes } = migrateFlowResponses(
      flow([
        { id: 'mix', kind: 'blend', op: 'add', x: 0, y: 0 },
        { id: 'n', kind: 'math', op: 'add', x: 0, y: 0, values: { b: 0.6 } },
      ]),
      OLDEST_RESPONSE_SET_VERSION,
    );
    expect(changes).toEqual([]);
    expect(flows.one.circuit.nodes[1].values!.b).toBe(0.6);
  });

  it('leaves the flows it did not touch identical, so a save rewrites nothing extra', () => {
    const before = flow([{ id: 'sw', kind: 'lens', op: 'swirl', x: 0, y: 0, values: { turn: 0.8 } }]);
    const { flows } = migrateFlowResponses(before, OLDEST_RESPONSE_SET_VERSION);
    expect(flows.one).toBe(before.one);
  });

  it('leaves a flow that says it is already current, inside a scheme that is not', () => {
    // The mixed library: named flows dialled before the change sitting beside
    // lab flows generated after it, in one file with one save date.
    const mixed: Record<string, FlowDef> = {
      old: { name: 'Old', circuit: { nodes: [{ id: 'a', kind: 'blend', op: 'add', x: 0, y: 0, values: { amount: 0.6 } }], cords: [] } },
      made: {
        name: 'Made',
        responses: RESPONSE_SET_VERSION,
        circuit: { nodes: [{ id: 'a', kind: 'blend', op: 'add', x: 0, y: 0, values: { amount: 0.6 } }], cords: [] },
      },
    };
    const { flows, changes } = migrateFlowResponses(mixed, OLDEST_RESPONSE_SET_VERSION);
    expect(changes.map((c) => c.flow)).toEqual(['old']);
    expect(flows.made.circuit.nodes[0].values!.amount).toBe(0.6);
    expect(flows.old.circuit.nodes[0].values!.amount).not.toBe(0.6);
  });

  it('drops a per-flow stamp once it has been read, so the file keeps one', () => {
    const { flows } = migrateFlowResponses(
      {
        made: {
          name: 'Made',
          responses: RESPONSE_SET_VERSION,
          circuit: { nodes: [{ id: 'a', kind: 'lens', op: 'kaleido', x: 0, y: 0, values: { spin: 0.62 } }], cords: [] },
        },
      },
      OLDEST_RESPONSE_SET_VERSION,
    );
    expect(flows.made).not.toHaveProperty('responses');
    expect(flows.made.circuit.nodes[0].values!.spin).toBe(0.62);
  });

  it('knows which versions are behind', () => {
    expect(needsResponseMigration(undefined)).toBe(true);
    expect(needsResponseMigration(OLDEST_RESPONSE_SET_VERSION)).toBe(true);
    expect(needsResponseMigration(RESPONSE_SET_VERSION)).toBe(false);
  });

  it('has an era entry for every key whose meaning moved, and only those', () => {
    // A guard on the table above: anything in the normalized set delivered its
    // own number before version 3, so an entry there would be a double shift.
    const { changes } = migrateFlowResponses(
      flow(
        Object.keys(NORMALIZED_CALIBRATIONS).map((key, i) => {
          const [kind, mode, inlet] = key.split('/');
          return { id: `n${i}`, kind: kind as never, op: mode, x: 0, y: 0, values: { [inlet]: 0.5 } };
        }),
      ),
      OLDEST_RESPONSE_SET_VERSION,
    );
    for (const change of changes) {
      const response = PRODUCTION_RESPONSES[change.key]!;
      expect(evaluateResponse(response, change.now), change.key).toBeCloseTo(0.5, 9);
    }
  });
});
