import type { Circuit } from '../protocol.ts';
import { circuitDistance } from './lineage.ts';

/**
 * A batch: one parent's children, generated together and judged together.
 *
 * This is the convergent half of the lab, and the thing it is *not* is a
 * scheduler. A batch happens because somebody opened a node and asked for one.
 * That is the whole difference from what came before, where an automatic
 * frontier decided which branch deserved the next comparison and therefore
 * decided — invisibly, and on evidence far too thin — which ideas were ever
 * developed at all. Attention is the scarcest thing in this system; a
 * tournament is the most expensive way to spend it; so the person spends it.
 *
 * `finals.ts` runs the same shape over a different field, and the two are
 * deliberately separate modules rather than one parameterized one. A Finals
 * match asks two questions at once — which is stronger, and is either usable
 * now — because a nominee is a finished work being cast for a show. A batch
 * match asks one, because a child is a direction and "show-ready" is not what
 * anybody is deciding when they are choosing between nine variations on a
 * theme. Merging them would mean carrying a show-readiness column that a batch
 * never fills and a room deck that a batch does not have.
 */

/**
 * Rounds per batch. Every entrant appears once per round, so a field of ten
 * costs fifteen comparisons — an amount of looking somebody actually finishes.
 *
 * Three rather than one, because a single elimination round throws away a good
 * child that happened to draw the best one first, which is the same mistake at
 * a smaller scale as the frontier that made this rewrite necessary.
 */
export const BATCH_ROUNDS = 3;

/** Field sizes offered, the parent included. Even, so a round pairs everyone. */
export const BATCH_SIZES: readonly number[] = [6, 10, 16];

export const DEFAULT_BATCH_SIZE = 10;

/**
 * What ranking a field needs, which is less than staging one does.
 *
 * Separated so the forest can derive who led every settled batch without
 * parsing a circuit per entrant to do it: standings come from the answers
 * alone, and the graphs are only wanted when a batch is being *dealt*.
 */
export interface BatchStandingEvidence {
  candidateId: string;
  /** The parent rides in its own batch, so "did this family improve" has an answer. */
  isParent: boolean;
  order: number;
}

export interface BatchEntrantEvidence extends BatchStandingEvidence {
  circuit: Circuit;
}

export interface BatchComparisonEvidence {
  id: number;
  leftId: string;
  rightId: string;
  round: number;
  disposition: 'pending' | 'compared' | 'skipped';
  choice: 'left' | 'right' | 'both' | 'neither' | null;
}

export interface BatchStanding {
  candidateId: string;
  isParent: boolean;
  matches: number;
  points: number;
  preference: number;
  score: number;
  uncertainty: number;
  order: number;
}

/**
 * Derived from raw comparisons every time, never stored.
 *
 * Smoothed, because a child that won its only match is not better evidenced
 * than one that won four of five, and an unsmoothed ratio says they are tied at
 * the top. `both` is worth less than a clean win and `neither` is worth
 * nothing to either side: they are answers about the pair, and flattening them
 * into half a win each would invent a preference nobody expressed.
 */
export function rankBatch(
  entrants: readonly BatchStandingEvidence[],
  evidence: readonly BatchComparisonEvidence[],
): BatchStanding[] {
  const compared = evidence.filter(
    (comparison) => comparison.disposition === 'compared' && comparison.choice !== null,
  );
  const rows = entrants.map((entrant) => {
    let matches = 0;
    let points = 0;
    for (const comparison of compared) {
      const left = comparison.leftId === entrant.candidateId;
      const right = comparison.rightId === entrant.candidateId;
      if (!left && !right) continue;
      matches += 1;
      if (comparison.choice === 'both') points += 0.75;
      else if ((left && comparison.choice === 'left') || (right && comparison.choice === 'right')) {
        points += 1;
      }
    }
    const preference = (1 + points) / (2 + matches);
    return {
      candidateId: entrant.candidateId,
      isParent: entrant.isParent,
      matches,
      points,
      preference,
      score: preference,
      uncertainty: 1 / Math.sqrt(matches + 2),
      order: entrant.order,
    };
  });
  return rows.sort(
    (left, right) =>
      right.score - left.score ||
      right.points - left.points ||
      left.order - right.order,
  );
}

export interface BatchPair {
  leftId: string;
  rightId: string;
  round: number;
}

/**
 * The next match, or null when every round is answered.
 *
 * Round zero spans structural distance, so the first thing seen is the shape of
 * the spread rather than two near-identical children. Later rounds pair close
 * current standings, which is what makes the second half of a batch more
 * discriminating than the first instead of repeatedly feeding the leader
 * somebody it has already beaten.
 */
export function nextBatchPair(
  entrants: readonly BatchEntrantEvidence[],
  evidence: readonly BatchComparisonEvidence[],
  rounds: number,
  rng: () => number,
): BatchPair | null {
  const settled = evidence.filter((comparison) => comparison.disposition !== 'pending');
  const seen = (candidateId: string, round: number) =>
    settled.some(
      (comparison) =>
        comparison.round === round &&
        (comparison.leftId === candidateId || comparison.rightId === candidateId),
    );
  const total = (candidateId: string) =>
    settled.filter(
      (comparison) => comparison.leftId === candidateId || comparison.rightId === candidateId,
    ).length;
  const paired = (leftId: string, rightId: string) =>
    evidence.some(
      (comparison) =>
        (comparison.leftId === leftId && comparison.rightId === rightId) ||
        (comparison.leftId === rightId && comparison.rightId === leftId),
    );
  const standings = new Map(
    rankBatch(entrants, evidence).map((standing) => [standing.candidateId, standing]),
  );

  for (let round = 0; round < rounds; round++) {
    const available = entrants.filter((entrant) => !seen(entrant.candidateId, round));
    if (available.length < 2) continue;
    available.sort(
      (left, right) =>
        total(left.candidateId) - total(right.candidateId) || left.order - right.order,
    );
    const left = available[0];
    let opponents = available.slice(1).filter(
      (right) => !paired(left.candidateId, right.candidateId),
    );
    if (opponents.length === 0) opponents = available.slice(1);
    if (opponents.length === 0) continue;

    const leftStanding = standings.get(left.candidateId)!;
    let right = opponents[0];
    let best = -Infinity;
    for (const candidate of opponents) {
      const distance = circuitDistance(left.circuit, candidate.circuit);
      const score =
        round === 0
          ? distance
          : -Math.abs(leftStanding.score - standings.get(candidate.candidateId)!.score) +
            distance * 0.15;
      if (score > best) {
        best = score;
        right = candidate;
      }
    }
    return rng() < 0.5
      ? { leftId: left.candidateId, rightId: right.candidateId, round }
      : { leftId: right.candidateId, rightId: left.candidateId, round };
  }
  return null;
}
