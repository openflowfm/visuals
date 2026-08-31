import { describe, expect, it } from 'vitest';
import { FIGURE_LIB, FIGURE_SAMPLES } from './figure.ts';
import { FIGURE_MODES } from '../../../protocol.ts';

const clamp = (value: number, lower = 0, upper = 1): number =>
  Math.max(lower, Math.min(upper, value));
const mix = (a: number, b: number, amount: number): number => a + (b - a) * amount;
const radius = (size: number): number => mix(0.05, 0.6, clamp(size));

/** The exact ones, mirrored: what is on the shape must measure zero. */
const circle = (x: number, y: number, size: number): number =>
  Math.abs(Math.hypot(x, y) - radius(size));
const box = (x: number, y: number, size: number, corner: number): number => {
  const r = radius(size);
  const k = mix(0, 0.9, clamp(corner)) * r;
  const qx = Math.abs(x) - (r - k);
  const qy = Math.abs(y) - (r - k);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return Math.abs(outside + Math.min(Math.max(qx, qy), 0) - k);
};
const polygon = (x: number, y: number, size: number, sides: number): number => {
  const n = 3 + Math.floor(clamp(sides) * 9);
  const r = radius(size);
  const wedge = Math.PI / n;
  const angle = Math.atan2(y, x);
  const folded = ((angle + wedge) % (wedge * 2)) - wedge;
  return Math.abs(Math.cos(folded) * Math.hypot(x, y) - r * Math.cos(wedge));
};

describe('a shape you measure rather than draw', () => {
  it('reads zero on the circle and grows either side of it', () => {
    const r = radius(0.45);
    expect(circle(r, 0, 0.45)).toBeCloseTo(0, 12);
    expect(circle(0, r, 0.45)).toBeCloseTo(0, 12);
    // Inside and outside both measure distance, so a glow strokes the curve
    // rather than filling the disc.
    expect(circle(r * 0.5, 0, 0.45)).toBeCloseTo(r * 0.5, 12);
    expect(circle(r * 1.5, 0, 0.45)).toBeCloseTo(r * 0.5, 12);
  });

  it('reads zero along the flat of a square edge, corners rounded or not', () => {
    const r = radius(0.45);
    expect(box(r, 0, 0.45, 0)).toBeCloseTo(0, 12);
    expect(box(r, r * 0.4, 0.45, 0)).toBeCloseTo(0, 12);
    // A rounded corner pulls the outline in, so the old sharp corner is now
    // measurably outside it.
    expect(box(r, r, 0.45, 0.6)).toBeGreaterThan(0.01);
  });

  it('puts a polygon vertex on the circumradius and its flat on the apothem', () => {
    const n = 3 + Math.floor(clamp(0.2) * 9);
    const r = radius(0.45);
    const apothem = r * Math.cos(Math.PI / n);
    // The fold puts the middle of a flat on the +x axis and a vertex at the
    // edge of the wedge, so the outline is the apothem away in one direction
    // and the circumradius away in the other.
    expect(polygon(apothem, 0, 0.45, 0.2)).toBeCloseTo(0, 12);
    expect(polygon(r * Math.cos(Math.PI / n), r * Math.sin(Math.PI / n), 0.45, 0.2)).toBeCloseTo(
      0,
      10,
    );
    // Which is what makes a polygon a polygon rather than a circle: a point at
    // the circumradius, straight out through a flat, is outside the shape.
    expect(polygon(r, 0, 0.45, 0.2)).toBeCloseTo(r - apothem, 12);
    expect(r - apothem).toBeGreaterThan(0.01);
  });
});

describe('the figure library charges what it loops', () => {
  it('offers one measurement per mode', () => {
    for (const mode of FIGURE_MODES) {
      expect(FIGURE_LIB).toContain(`vec2 figure_${mode}(`);
    }
  });

  it('walks exactly one curve, and that is the one the budget knows about', () => {
    // Every other mode is closed-form and free. If a second `for` appears here
    // without a second entry in the node's work function, a flow could be
    // accepted that the GPU cannot afford.
    expect((FIGURE_LIB.match(/for \(/g) ?? []).length).toBe(1);
    expect(FIGURE_LIB).toContain(`const int FIGURE_SAMPLES = ${FIGURE_SAMPLES};`);
  });

  it('gives both a distance and a position along the shape', () => {
    // Everything returns a vec2, because the position along a curve is what
    // lets a stroke be coloured by where it is rather than uniformly.
    expect((FIGURE_LIB.match(/^vec2 figure_/gm) ?? []).length).toBe(FIGURE_MODES.length);
  });
});
