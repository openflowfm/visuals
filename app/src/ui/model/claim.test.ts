import { describe, expect, it } from 'vitest';
import { CLAIM_MS, claimHolds, claimOf, claimSettled } from './claim';

describe('a claim, unsettled (spec 1)', () => {
  const picked = claimOf('b.milk', 1000);

  it('holds for CLAIM_MS from the pick', () => {
    expect(picked).toEqual({ path: 'b.milk', until: 1000 + CLAIM_MS });
  });

  it('holds while what played when picked still plays', () => {
    expect(claimHolds(picked, 'a.milk', 1000)).toBe(true);
    expect(claimHolds(picked, null, 1500)).toBe(true);
  });

  it('holds when the deck moves to a third preset before the pick plays', () => {
    expect(claimHolds(picked, 'c.milk', 1200)).toBe(true);
  });

  it('ends when the picked preset plays', () => {
    expect(claimHolds(picked, 'b.milk', 1200)).toBe(false);
  });

  it('ends when its time is up', () => {
    expect(claimHolds(picked, 'a.milk', 1000 + CLAIM_MS - 1)).toBe(true);
    expect(claimHolds(picked, 'a.milk', 1000 + CLAIM_MS)).toBe(false);
    expect(claimHolds(picked, 'c.milk', 1000 + CLAIM_MS + 500)).toBe(false);
  });
});

describe('a settled claim', () => {
  const picked = claimOf('b.milk', 1000);
  const settled = claimSettled(picked, 'a.milk');
  const settledNull = claimSettled(picked, null);

  it('spec 2: records the preset it was settled on and keeps the rest', () => {
    expect(settled).toEqual({ path: 'b.milk', until: 1000 + CLAIM_MS, from: 'a.milk' });
    expect(settledNull).toEqual({ path: 'b.milk', until: 1000 + CLAIM_MS, from: null });
    expect(settledNull.from).toBeNull();
  });

  it('spec 3: holds while the deck stays on from, up to its time', () => {
    expect(claimHolds(settled, 'a.milk', 1000)).toBe(true);
    expect(claimHolds(settled, 'a.milk', 1000 + CLAIM_MS - 1)).toBe(true);
  });

  it('spec 4: ends once the deck reports a third preset or nothing', () => {
    expect(claimHolds(settled, 'c.milk', 1200)).toBe(false);
    expect(claimHolds(settled, null, 1200)).toBe(false);
  });

  it('spec 4: ends once the deck reports the picked preset', () => {
    expect(claimHolds(settled, 'b.milk', 1200)).toBe(false);
  });

  it('spec 5: from null holds while the deck is null and ends on any preset', () => {
    expect(claimHolds(settledNull, null, 1200)).toBe(true);
    expect(claimHolds(settledNull, 'a.milk', 1200)).toBe(false);
    expect(claimHolds(settledNull, 'b.milk', 1200)).toBe(false);
  });

  it('spec 6: ends when its time is up, even while the deck is on from', () => {
    expect(claimHolds(settled, 'a.milk', 1000 + CLAIM_MS)).toBe(false);
    expect(claimHolds(settledNull, null, 1000 + CLAIM_MS)).toBe(false);
  });
});
