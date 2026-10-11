import { describe, expect, it } from 'vitest';
import { holeRadius, sendOnChange } from './hooks.ts';

describe('sendOnChange', () => {
  const rect = (left: number, top: number, width = 320, height = 180) => ({ left, top, width, height });

  it('sends the first rect, then only the ones that differ', () => {
    const sent: unknown[] = [];
    const check = sendOnChange((p) => sent.push(p));
    check(rect(10, 40));
    check(rect(10, 40));
    check(rect(10, 40));
    expect(sent).toEqual([{ x: 10, y: 40, width: 320, height: 180 }]);
  });

  it('sends a move that keeps the size, as when a banner opens above the hole', () => {
    const sent: unknown[] = [];
    const check = sendOnChange((p) => sent.push(p));
    check(rect(10, 40));
    check(rect(10, 76));
    expect(sent).toEqual([
      { x: 10, y: 40, width: 320, height: 180 },
      { x: 10, y: 76, width: 320, height: 180 },
    ]);
  });

  it('sends a resize', () => {
    const sent: unknown[] = [];
    const check = sendOnChange((p) => sent.push(p));
    check(rect(10, 40));
    check(rect(10, 40, 400));
    expect(sent).toHaveLength(2);
  });

  it('sends the hole’s corners with it, and a square hole none', () => {
    const sent: unknown[] = [];
    const check = sendOnChange((p) => sent.push(p));
    // Home's hero: rounded to --lay-hero-radius.
    check(rect(10, 40), 18);
    check(rect(10, 40), 18);
    // The same rect squared (onboarding's or the editor's hole): sent again, with no radius.
    check(rect(10, 40), 0);
    expect(sent).toEqual([
      { x: 10, y: 40, width: 320, height: 180, radius: 18 },
      { x: 10, y: 40, width: 320, height: 180 },
    ]);
  });
});

describe('holeRadius', () => {
  it('reads a computed border-radius in pixels, and anything else as square', () => {
    expect(holeRadius('18px')).toBe(18);
    expect(holeRadius('18px 12px')).toBe(18);
    expect(holeRadius('0px')).toBe(0);
    expect(holeRadius('')).toBe(0);
    expect(holeRadius('50%')).toBe(0);
  });
});
