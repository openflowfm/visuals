import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BRIGHTNESS_STEP, Hit, hitLabel, MIRROR_NAMES, MIRRORS, nearest, stepBrightness, stepSensitivity } from './Effects.tsx';

describe('the hits, to VoiceOver', () => {
  it('names a hit as a word with its key, and says whether it is on', () => {
    expect(hitLabel('BLACKOUT', 'B')).toBe('Blackout (B)');
    const html = renderToStaticMarkup(createElement(Hit, { kind: 'strobe', on: true, hold: true, label: 'STROBE', keyName: 'S', send: () => {} }));
    expect(html).toContain('aria-label="Strobe (S)"');
    expect(html).toContain('aria-pressed="true"');
  });
});

describe('stepBrightness', () => {
  it('moves by 0.02 a step', () => {
    expect(BRIGHTNESS_STEP).toBe(0.02);
    expect(stepBrightness(1, 1)).toBe(1.02);
    expect(stepBrightness(1, -1)).toBe(0.98);
    expect(stepBrightness(0.5, 5)).toBe(0.6);
  });

  it('lands on whole hundredths, with no float drift', () => {
    let v = 1;
    for (let i = 0; i < 7; i++) v = stepBrightness(v, 1);
    expect(v).toBe(1.14);
  });

  it('stays within 0 to 2', () => {
    expect(stepBrightness(0, -1)).toBe(0);
    expect(stepBrightness(2, 1)).toBe(2);
    expect(stepBrightness(1.99, 1)).toBe(2);
  });
});

describe('stepSensitivity', () => {
  it('moves by a twelfth of a doubling', () => {
    expect(stepSensitivity(1, 12)).toBeCloseTo(2, 10);
    expect(stepSensitivity(1, -12)).toBeCloseTo(0.5, 10);
    expect(stepSensitivity(1, 1)).toBeCloseTo(2 ** (1 / 12), 10);
  });

  it('snaps a value between steps onto the grid', () => {
    expect(stepSensitivity(1.01, 0)).toBeCloseTo(1, 10);
  });

  it('stays within ¼× to 4×', () => {
    expect(stepSensitivity(4, 1)).toBe(4);
    expect(stepSensitivity(0.25, -1)).toBe(0.25);
    expect(stepSensitivity(0, -1)).toBe(0.25);
  });
});

describe('the mirror picker', () => {
  it('names every mode', () => {
    expect(MIRROR_NAMES).toHaveLength(MIRRORS.length);
  });

  it('finds the nearest of a list', () => {
    expect(nearest([0.25, 0.5, 1, 2, 4], 1.4)).toBe(2);
    expect(nearest([0.25, 0.5, 1, 2, 4], 3.5)).toBe(4);
  });
});
