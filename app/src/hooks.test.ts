import { describe, expect, it } from 'vitest';
import { sendOnChange } from './hooks.ts';

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
});
