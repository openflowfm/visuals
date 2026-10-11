import { describe, expect, it } from 'vitest';
import { mark, SYSTEM_QUERY } from './access.ts';

describe('mark', () => {
  it('marks the document while motion is reduced, and unmarks it after', () => {
    const root = { dataset: {} as DOMStringMap };
    mark({ reduced: true, system: true }, root);
    expect(root.dataset.reducedMotion).toBe('');
    mark({ reduced: false, system: false }, root);
    expect('reducedMotion' in root.dataset).toBe(false);
  });

  it("marks the document while macOS's Reduce transparency is on, and keeps the mark when the answer doesn't say", () => {
    const root = { dataset: {} as DOMStringMap };
    mark({ reduced: false, system: true, transparency: true }, root);
    expect(root.dataset.transparency).toBe('reduced');
    // reduced_motion_set answers the motion alone: the mark stays.
    mark({ reduced: true, system: false }, root);
    expect(root.dataset.transparency).toBe('reduced');
    mark({ reduced: true, system: false, transparency: false }, root);
    expect('transparency' in root.dataset).toBe(false);
  });

  it('does nothing without a document', () => {
    expect(() => mark({ reduced: true, system: true }, undefined)).not.toThrow();
  });
});

describe('following macOS', () => {
  it("asks WebKit for macOS's Reduce motion", () => {
    expect(SYSTEM_QUERY).toBe('(prefers-reduced-motion: reduce)');
  });
});
