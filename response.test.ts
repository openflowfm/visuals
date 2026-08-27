import { describe, expect, it } from 'vitest';
import {
  CALIBRATION_BASELINE_RESPONSES,
  NORMALIZED_CALIBRATIONS,
  PRODUCTION_RESPONSES,
  evaluateResponse,
  formatResponse,
  responseGlsl,
  scaleResponse,
  type ParameterResponse,
} from './response.ts';

const centred = (exponent: number): ParameterResponse => ({
  kind: 'centered-power',
  center: 0.5,
  min: -2,
  neutral: 0,
  max: 2,
  exponent,
  unit: 'turn/beat',
});

describe('parameter responses', () => {
  it('gives a signed power response a real neutral and more room around it', () => {
    expect(evaluateResponse(centred(1), 0.75)).toBe(1);
    expect(evaluateResponse(centred(2), 0.75)).toBe(0.5);
    expect(evaluateResponse(centred(3), 0.75)).toBe(0.25);
    expect(evaluateResponse(centred(2), 0.5)).toBe(0);
    expect(evaluateResponse(centred(2), 0.25)).toBe(-0.5);
  });

  it('supports linear, exponential, and quantized domains', () => {
    expect(evaluateResponse({ kind: 'linear', min: 2, max: 10, unit: 'px' }, 0.25)).toBe(4);
    expect(
      evaluateResponse({ kind: 'exponential', min: 0.5, max: 2, unit: '×' }, 0.5),
    ).toBeCloseTo(1);
    expect(evaluateResponse({ kind: 'steps', values: [2, 4, 8], unit: 'sides' }, 0.66)).toBe(4);
  });

  it('scales extent around the semantic neutral without changing the curve', () => {
    expect(scaleResponse(centred(2), 0.25)).toEqual({
      ...centred(2),
      min: -0.5,
      max: 0.5,
    });
  });

  it('emits GLSL and a domain-aware readout', () => {
    const source = responseGlsl(centred(2), 'uParams[0]');
    expect(source).toContain('(uParams[0])');
    expect(source).toContain('pow(');
    expect(formatResponse(centred(2), 0.75)).toBe('0.5 turn/beat');
  });

  it('holds the accepted first rotation calibration in production metadata', () => {
    const swirl = PRODUCTION_RESPONSES['lens/swirl/turn']!;
    const spin = PRODUCTION_RESPONSES['lens/kaleido/spin']!;
    const twist = PRODUCTION_RESPONSES['lens/twist/turn']!;
    for (const input of [0, 0.2, 0.5, 0.73, 1]) {
      expect(evaluateResponse(swirl, input) * Math.PI * 2).toBeCloseTo(
        (input - 0.5) * 12.56637061436,
      );
      const signed = (input - 0.5) / 0.5;
      expect(evaluateResponse(spin, input) * Math.PI * 2).toBeCloseTo(
        Math.sign(signed) * signed ** 2 * 0.45,
      );
      expect(evaluateResponse(twist, input) * Math.PI * 2).toBeCloseTo(signed * 6.75);
    }
  });

  it('holds every accepted second-batch answer, including roots and reach changes', () => {
    expect(Object.keys(NORMALIZED_CALIBRATIONS)).toHaveLength(82);
    expect(PRODUCTION_RESPONSES['light/lamp/soft']).toMatchObject({
      kind: 'centered-power',
      exponent: 0.5,
      max: 1,
    });
    expect(PRODUCTION_RESPONSES['source/rings/energy']).toMatchObject({
      exponent: 2,
      max: 0.8,
    });
    expect(PRODUCTION_RESPONSES['fractal/mandelbrot/turn']).toMatchObject({
      center: 0.5,
      neutral: 0.5,
      exponent: 1,
    });
  });

  it('keeps automatic trial fixtures on their response-set-two baseline', () => {
    const production = PRODUCTION_RESPONSES['lens/wobble/amount']!;
    const baseline = CALIBRATION_BASELINE_RESPONSES['lens/wobble/amount']!;
    expect(evaluateResponse(production, 0.5)).toBe(0.25);
    expect(evaluateResponse(baseline, 0.5)).toBe(0.5);
    expect(responseGlsl(baseline, 'raw')).toBe('raw');
  });
});
