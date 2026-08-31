import { describe, expect, it } from 'vitest';
import { CALIBRATION_FLOW, CALIBRATION_TRIALS, calibrationProblems, calibrationScheme } from './calibration.ts';
import { compileFlow } from './src/render/circuit.ts';
import { CALIBRATION_BASELINE_RESPONSES, responseKey } from './response.ts';

describe('response calibration manifest', () => {
  it('covers the complete subjective visual-control matrix', () => {
    expect(CALIBRATION_TRIALS).toHaveLength(125);
    expect(new Set(CALIBRATION_TRIALS.map((trial) => trial.target.kind))).toEqual(
      new Set([
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
      ]),
    );
    expect(
      CALIBRATION_TRIALS.find((trial) => trial.id === 'parameter-source-bars-energy')?.options
        .map((option) => option.id),
    ).toContain('root');
    expect(
      CALIBRATION_TRIALS.find((trial) => trial.id === 'parameter-lens-zoom-by')?.options
        .map((option) => option.id),
    ).toContain('cube');
  });

  it('keeps stable unique trial identities and three distinct options', () => {
    expect(new Set(CALIBRATION_TRIALS.map((trial) => `${trial.id}@${trial.version}`)).size).toBe(
      CALIBRATION_TRIALS.length,
    );
    for (const trial of CALIBRATION_TRIALS) {
      expect(trial.options).toHaveLength(3);
      expect(new Set(trial.options.map((option) => option.id)).size).toBe(3);
    }
  });

  it('freezes the first rotation questions independently of accepted production responses', () => {
    const trial = CALIBRATION_TRIALS.find((candidate) => candidate.id === 'rotation-kaleido-spin')!;
    const linear = trial.options.find((option) => option.id === 'linear')!;
    expect(linear.response).toMatchObject({ exponent: 1, max: 0.3 / (Math.PI * 2) });
  });

  it('builds every fixture and keeps the tested value in a uniform slot', () => {
    for (const trial of CALIBRATION_TRIALS) {
      const scheme = calibrationScheme(trial, 0.61);
      const built = compileFlow(scheme.flows, CALIBRATION_FLOW);
      expect(built.error, trial.id).toBeNull();
      expect(
        scheme.flows[CALIBRATION_FLOW]?.circuit.nodes.find(
          (node) => node.id === trial.target.nodeId,
        )?.values?.[trial.target.inlet],
      ).toBe(0.61);
    }
  });

  it('compiles a candidate override into the same fixture without changing its graph', () => {
    const trial = CALIBRATION_TRIALS[0]!;
    const scheme = calibrationScheme(trial, trial.initialValue);
    const current = compileFlow(scheme.flows, CALIBRATION_FLOW);
    const candidate = compileFlow(scheme.flows, CALIBRATION_FLOW, {
      responses: {
        ...CALIBRATION_BASELINE_RESPONSES,
        [responseKey(trial.target)]: trial.options[0]!.response,
      },
    });
    expect(candidate.error).toBeNull();
    expect(candidate.source).not.toBe(current.source);
    expect(candidate.source).toContain(`pow(`);
    expect(scheme.flows[CALIBRATION_FLOW]?.circuit).toEqual(
      calibrationScheme(trial, trial.initialValue).flows[CALIBRATION_FLOW]?.circuit,
    );
  });

  it('requires a reason when every option is rejected', () => {
    expect(
      calibrationProblems({
        trialId: 'one',
        trialVersion: 1,
        room: CALIBRATION_TRIALS[0]!.room,
        selectedOptionId: null,
        response: null,
        extent: 1,
      }),
    ).toEqual(['say why none of the responses works']);
  });
});
