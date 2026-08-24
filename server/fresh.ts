import type { CandidateDraft, LabMethod } from '../lab.ts';
import { WORDS, rollCircuit } from '../roll.ts';

/**
 * The first methodology, deliberately plain: deal a candidate from the
 * constrained grammar in `rollCircuit` and propose it. No evidence is read, no
 * parent is mutated, and that is the point — `fresh` exists to prove the
 * `LabMethod` boundary before any method worth arguing about arrives behind it.
 *
 * Version 1 names the grammar this method dealt from. Widening `rollCircuit`
 * changes what the same seed deals, so a widened grammar is a version bump —
 * old candidates keep saying which deck they came from.
 */
export function freshMethod(): LabMethod<null> {
  return {
    id: 'fresh',
    version: 1,
    start: () => null,
    next(_state, _evidence, budget, rng) {
      const drafts: CandidateDraft[] = [];
      for (let i = 0; i < budget; i++) {
        const a = WORDS[Math.floor(rng() * WORDS.length)];
        const b = WORDS[Math.floor(rng() * WORDS.length)];
        drafts.push({
          flow: {
            name: `${a[0].toUpperCase()}${a.slice(1)} ${b}`,
            circuit: rollCircuit(rng),
          },
          bundle: {},
          parents: [],
          operation: 'fresh',
        });
      }
      return drafts;
    },
    observe: (state) => state,
  };
}
