import type { LabRoom } from '../protocol.ts';
import {
  dealRoom,
  type FinalsComparisonEvidence,
  type FinalsNomineeEvidence,
  type SearchEvidence,
} from '../lab.ts';
import { circuitDistance } from './lineage.ts';

export const FINALS_NOMINEES = 24;
export const FINALS_WINNERS = 10;

export interface FinalsRoom {
  name: string;
  room: LabRoom;
}

/** Four deliberately different musical conditions, frozen into every run. */
export function finalsRooms(seed: string): FinalsRoom[] {
  const sections = ['opening', 'verse', 'build', 'chorus'];
  const shape = (
    at: number,
    name: string,
    tempo: number,
    energy: number,
    section: string,
  ): FinalsRoom => ({
    name,
    room: {
      ...dealRoom(`${seed}:finals-room:${at}`),
      tempo,
      quantum: 4,
      energy,
      section,
      sections,
    },
  });
  return [
    shape(0, 'hush', 88, 0.18, 'opening'),
    shape(1, 'pulse', 116, 0.46, 'verse'),
    shape(2, 'lift', 128, 0.72, 'build'),
    shape(3, 'arrival', 140, 0.92, 'chorus'),
  ];
}

interface SearchStanding {
  points: number;
  shown: number;
  accepted: boolean;
}

const selected = (choice: NonNullable<SearchEvidence['comparisons'][number]['choice']>) => ({
  left: choice === 'left' || choice === 'both',
  right: choice === 'right' || choice === 'both',
});

/**
 * Explicitly preserved works enter first. Remaining seats are a
 * quality/novelty beam across every historically accepted work: a lineage is
 * provenance, not an archetype, so distinct descendants may both belong.
 */
export function nominateFinalists(
  evidence: SearchEvidence,
  limit = FINALS_NOMINEES,
  preservedIds: readonly string[] = [],
): FinalsNomineeEvidence[] {
  const stats = new Map<string, SearchStanding>();
  const held = (id: string): SearchStanding => {
    let row = stats.get(id);
    if (!row) {
      row = { points: 0, shown: 0, accepted: false };
      stats.set(id, row);
    }
    return row;
  };
  for (const comparison of evidence.comparisons) {
    if (!comparison.choice) continue;
    const choice = selected(comparison.choice);
    for (const [id, chosen] of [
      [comparison.leftId, choice.left],
      [comparison.rightId, choice.right],
    ] as const) {
      const row = held(id);
      row.shown += 1;
      if (chosen) {
        row.accepted = true;
        row.points += comparison.choice === 'both' ? 0.75 : 1;
      }
    }
  }

  const preserved = new Set(preservedIds);
  const scored = evidence.candidates.flatMap((candidate) => {
    const row = stats.get(candidate.id);
    if (!row?.accepted && !preserved.has(candidate.id)) return [];
    const posterior = row ? (1 + row.points) / (2 + row.shown) : 0.5;
    const confidence = 0.28 / Math.sqrt((row?.shown ?? 0) + 1);
    return [{ candidate, seedScore: posterior - confidence }];
  });

  const byId = new Map(scored.map((candidate) => [candidate.candidate.id, candidate]));
  const chosen = preservedIds.flatMap((id) => byId.get(id) ?? []);
  const chosenIds = new Set(chosen.map((candidate) => candidate.candidate.id));
  const pool = scored.filter((candidate) => !chosenIds.has(candidate.candidate.id));
  const fieldSize = Math.max(limit, chosen.length);
  while (pool.length > 0 && chosen.length < fieldSize) {
    let bestAt = 0;
    let best = -Infinity;
    for (let at = 0; at < pool.length; at++) {
      const candidate = pool[at];
      const novelty =
        chosen.length === 0
          ? 1
          : Math.min(
              ...chosen.map((other) =>
                circuitDistance(
                  candidate.candidate.flow.circuit,
                  other.candidate.flow.circuit,
                ),
              ),
            );
      const score = candidate.seedScore * 0.72 + novelty * 0.28;
      if (score > best) {
        best = score;
        bestAt = at;
      }
    }
    chosen.push(pool.splice(bestAt, 1)[0]);
  }
  // A room is a perfect matching. Prefer adding a work over silently removing
  // an explicitly protected one when its count is odd.
  if (chosen.length % 2 === 1) {
    if (pool.length > 0) chosen.push(pool.shift()!);
  }
  return chosen.map((candidate, selectedOrder) => ({ ...candidate, selectedOrder }));
}

export interface FinalsStanding {
  candidateId: string;
  matches: number;
  showReady: number;
  preference: number;
  score: number;
  uncertainty: number;
  seedScore: number;
}

/** Derived every time from raw matches; no mutable leaderboard is trusted. */
export function rankFinalists(
  nominees: readonly FinalsNomineeEvidence[],
  evidence: readonly FinalsComparisonEvidence[],
): FinalsStanding[] {
  const compared = evidence.filter(
    (comparison): comparison is FinalsComparisonEvidence & { choice: NonNullable<FinalsComparisonEvidence['choice']> } =>
      comparison.disposition === 'compared' && comparison.choice !== null,
  );
  const rows = nominees.map((nominee) => {
    let matches = 0;
    let points = 0;
    let showReady = 0;
    for (const comparison of compared) {
      const left = comparison.leftId === nominee.candidate.id;
      const right = comparison.rightId === nominee.candidate.id;
      if (!left && !right) continue;
      matches += 1;
      if (left ? comparison.leftShowReady : comparison.rightShowReady) showReady += 1;
      if (comparison.choice === 'both') points += 0.75;
      else if (
        (left && comparison.choice === 'left') ||
        (right && comparison.choice === 'right')
      ) {
        points += 1;
      }
    }
    const preference = (1 + points) / (2 + matches);
    const readiness = (1 + showReady) / (2 + matches);
    return {
      candidateId: nominee.candidate.id,
      matches,
      showReady,
      preference,
      score: preference * 0.68 + readiness * 0.32,
      uncertainty: 1 / Math.sqrt(matches + 2),
      seedScore: nominee.seedScore,
    };
  });
  return rows.sort(
    (left, right) =>
      right.score - left.score ||
      right.showReady - left.showReady ||
      right.preference - left.preference ||
      right.seedScore - left.seedScore,
  );
}

export interface FinalsPair {
  leftId: string;
  rightId: string;
  roomIndex: number;
}

/**
 * Four balanced rounds: every nominee appears once in every room. The first
 * room spans visual distance; later rooms pair similar current standings so a
 * comparison remains informative rather than repeatedly feeding a favorite a
 * much weaker opponent.
 */
export function nextFinalsPair(
  nominees: readonly FinalsNomineeEvidence[],
  evidence: readonly FinalsComparisonEvidence[],
  roomCount: number,
  rng: () => number,
): FinalsPair | null {
  const compared = evidence.filter((comparison) => comparison.disposition === 'compared');
  const seen = (candidateId: string, roomIndex: number) =>
    compared.some(
      (comparison) =>
        comparison.roomIndex === roomIndex &&
        (comparison.leftId === candidateId || comparison.rightId === candidateId),
    );
  const total = (candidateId: string) =>
    compared.filter(
      (comparison) =>
        comparison.leftId === candidateId || comparison.rightId === candidateId,
    ).length;
  const paired = (leftId: string, rightId: string) =>
    evidence.some(
      (comparison) =>
        (comparison.leftId === leftId && comparison.rightId === rightId) ||
        (comparison.leftId === rightId && comparison.rightId === leftId),
    );
  const standings = new Map(
    rankFinalists(nominees, evidence).map((standing) => [standing.candidateId, standing]),
  );

  for (let roomIndex = 0; roomIndex < roomCount; roomIndex++) {
    const available = nominees.filter((nominee) => !seen(nominee.candidate.id, roomIndex));
    if (available.length === 0) continue;
    available.sort(
      (left, right) =>
        total(left.candidate.id) - total(right.candidate.id) ||
        left.selectedOrder - right.selectedOrder,
    );
    const left = available[0];
    let opponents = available.slice(1).filter(
      (right) =>
        right.candidate.cohort !== left.candidate.cohort &&
        !paired(left.candidate.id, right.candidate.id),
    );
    if (opponents.length === 0) opponents = available.slice(1);
    if (opponents.length === 0) return null;

    const leftStanding = standings.get(left.candidate.id)!;
    let right = opponents[0];
    let best = -Infinity;
    for (const candidate of opponents) {
      const distance = circuitDistance(
        left.candidate.flow.circuit,
        candidate.candidate.flow.circuit,
      );
      const score =
        roomIndex === 0
          ? distance
          : -Math.abs(leftStanding.score - standings.get(candidate.candidate.id)!.score) +
            distance * 0.15;
      if (score > best) {
        best = score;
        right = candidate;
      }
    }
    const pair = [left.candidate.id, right.candidate.id] as const;
    return rng() < 0.5
      ? { leftId: pair[0], rightId: pair[1], roomIndex }
      : { leftId: pair[1], rightId: pair[0], roomIndex };
  }
  return null;
}
