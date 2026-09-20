import { describe, expect, it } from 'vitest';
import { compileCircuit, inletsOf, NODE_SPECS } from '../../client/render/circuit.ts';
import { HARNESS_KINDS, harnessFixture } from './fixture.ts';

describe('node harness fixtures', () => {
  for (const kind of HARNESS_KINDS) {
    for (const mode of NODE_SPECS[kind].modes?.map((mode) => mode.name) ?? [undefined]) {
      for (const outlet of NODE_SPECS[kind].outlets) {
        it(`compiles ${kind}/${mode ?? 'default'}/${outlet.name} without external resources`, () => {
          const fixture = harnessFixture(kind, mode, {}, outlet.name)!;
          const compiled = compileCircuit(fixture.circuit);
          expect(compiled.error).toBeNull();
          expect(compiled.source).toBeTruthy();
          expect(compiled.images).toEqual([]);
          expect(compiled.videos).toEqual([]);
          expect(compiled.models).toEqual([]);
          expect(compiled.tracks).toEqual([]);
          expect(fixture.node.previewOutlet).toBe(outlet.name);
          for (const port of inletsOf(fixture.node).filter((port) => port.kind === 'c')) {
            expect(fixture.circuit.cords.some((cord) => cord.to === `subject/${port.name}`)).toBe(true);
          }
        });
      }
    }
  }
  it('preserves live numeric defaults and applies held values', () => {
    expect(harnessFixture('lfo')!.node.values).toEqual({});
    const held = compileCircuit(harnessFixture('lfo', 'sine', { rate: 0.17 })!.circuit);
    expect(held.values.find((value) => value.id === 'subject/rate' && value.label === 'rate')?.value).toBe(0.17);
  });
  it('declines nodes requiring another fixture', () => {
    for (const kind of ['model', 'image', 'video', 'flow', 'track', 'last'] as const) {
      expect(harnessFixture(kind)).toBeNull();
    }
  });
});
