import { describe, expect, it } from 'vitest';
import { seeded, type EvidenceCandidate, type FinalsComparisonEvidence, type SearchEvidence } from '../lab.ts';
import { randomCircuit } from './lineage.ts';
import { nextFinalsPair, nominateFinalists, rankFinalists } from './finals.ts';

const candidate = (at: number, cohort = `family-${at}`): EvidenceCandidate => ({
  id: `candidate-${at}`,
  flow: { name: `Candidate ${at}`, circuit: randomCircuit(seeded(`finalist-${at}`)) },
  bundle: {},
  parentId: null,
  operation: 'random',
  generation: 0,
  cohort,
  verdict: null,
  selectedAt: null,
});

describe('Finals nomination', () => {
  it('selects a deterministic, even field from historical winners', () => {
    const candidates = Array.from({ length: 32 }, (_, at) => candidate(at));
    // A weaker cousin from each of the first four families must not buy that
    // family another seat merely by existing.
    candidates.push(...Array.from({ length: 4 }, (_, at) => candidate(at + 32, `family-${at}`)));
    const comparisons: SearchEvidence['comparisons'] = [];
    for (let at = 0; at < 32; at += 2) {
      comparisons.push({
        id: comparisons.length + 1,
        phase: 'explore',
        anchorId: null,
        leftId: candidates[at].id,
        rightId: candidates[at + 1].id,
        depth: 0,
        disposition: 'compared',
        choice: 'both',
        decidedAt: comparisons.length + 1,
      });
    }
    const evidence: SearchEvidence = {
      reviewed: 0,
      skipped: 0,
      liked: 0,
      rejected: 0,
      candidates,
      comparisons,
    };
    const first = nominateFinalists(evidence);
    const again = nominateFinalists(evidence);
    expect(first.map((nominee) => nominee.candidate.id)).toEqual(
      again.map((nominee) => nominee.candidate.id),
    );
    expect(first).toHaveLength(24);
    expect(new Set(first.map((nominee) => nominee.candidate.cohort)).size).toBe(24);
  });

  it('admits every explicitly kept work even when two share one lineage', () => {
    const candidates = Array.from({ length: 26 }, (_, at) =>
      candidate(at, at < 2 ? 'one-prolific-family' : `family-${at}`),
    );
    const comparisons: SearchEvidence['comparisons'] = [];
    for (let at = 0; at < candidates.length; at += 2) {
      comparisons.push({
        id: comparisons.length + 1,
        phase: 'explore',
        anchorId: null,
        leftId: candidates[at].id,
        rightId: candidates[at + 1].id,
        depth: 0,
        disposition: 'compared',
        choice: 'both',
        decidedAt: comparisons.length + 1,
      });
    }
    const evidence: SearchEvidence = {
      reviewed: 0,
      skipped: 0,
      liked: 0,
      rejected: 0,
      candidates,
      comparisons,
    };
    const nominees = nominateFinalists(evidence, 24, ['candidate-0', 'candidate-1']);
    expect(nominees.slice(0, 2).map((nominee) => nominee.candidate.id)).toEqual([
      'candidate-0',
      'candidate-1',
    ]);
  });

  it('never drops an odd protected work merely to make a bracket', () => {
    const candidates = Array.from({ length: 25 }, (_, at) => candidate(at));
    const comparisons: SearchEvidence['comparisons'] = candidates.slice(1).map((right, at) => ({
      id: at + 1,
      phase: 'explore' as const,
      anchorId: null,
      leftId: candidates[0].id,
      rightId: right.id,
      depth: 0,
      disposition: 'compared' as const,
      choice: 'both' as const,
      decidedAt: at + 1,
    }));
    const evidence: SearchEvidence = {
      reviewed: 0,
      skipped: 0,
      liked: 0,
      rejected: 0,
      candidates,
      comparisons,
    };
    const protectedIds = candidates.map((held) => held.id);
    expect(nominateFinalists(evidence, 24, protectedIds)).toHaveLength(25);
  });
});

describe('Finals pairing and standing', () => {
  it('shows every nominee once in every room and derives rather than stores rank', () => {
    const nominees = Array.from({ length: 4 }, (_, at) => ({
      candidate: candidate(at),
      seedScore: 0.5 - at * 0.01,
      selectedOrder: at,
    }));
    const evidence: FinalsComparisonEvidence[] = [];
    for (let at = 0; ; at++) {
      const pair = nextFinalsPair(nominees, evidence, 2, seeded(`pair-${at}`));
      if (!pair) break;
      evidence.push({
        id: at + 1,
        ...pair,
        disposition: 'compared',
        choice: 'left',
        leftShowReady: true,
        rightShowReady: false,
      });
    }
    expect(evidence).toHaveLength(4);
    for (const nominee of nominees) {
      const held = evidence.filter(
        (comparison) =>
          comparison.leftId === nominee.candidate.id ||
          comparison.rightId === nominee.candidate.id,
      );
      expect(held).toHaveLength(2);
      expect(new Set(held.map((comparison) => comparison.roomIndex))).toEqual(new Set([0, 1]));
    }
    const ranking = rankFinalists(nominees, evidence);
    expect(ranking).toHaveLength(4);
    expect(ranking[0].score).toBeGreaterThanOrEqual(ranking[3].score);
    expect(ranking.every((row) => row.matches === 2)).toBe(true);
  });
});
