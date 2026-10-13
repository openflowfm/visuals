import { describe, expect, it } from 'vitest';
import { CLAIM_MS, claimHolds, claimOf } from './claim';

describe('a claim', () => {
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
