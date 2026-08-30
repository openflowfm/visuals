import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { seeded } from '../lab.ts';
import { strandedNodes } from '../src/render/circuit.ts';
import { labSearchEngine, openLab, type LabStore } from './lab.ts';
import { batchDrafts, lineageMethod, randomCircuit, seedDraft } from './lineage.ts';
import { nextBatchPair, rankBatch, type BatchComparisonEvidence } from './batch.ts';

const dirs: string[] = [];
const stores: LabStore[] = [];

const open = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openflow-batch-'));
  dirs.push(dir);
  const store = openLab(path.join(dir, 'lab.sqlite3'));
  stores.push(store);
  return store;
};

afterEach(() => {
  for (const store of stores.splice(0)) {
    try {
      store.close();
    } catch {
      // The engine may already have closed it.
    }
  }
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('nothing staged has a branch that draws nothing', () => {
  it('refuses a stranded root, however the constructor built it', () => {
    for (let at = 0; at < 200; at++) {
      const circuit = randomCircuit(seeded(`root-${at}`));
      expect(strandedNodes(circuit), `root-${at}`).toEqual([]);
    }
  });

  it('refuses a stranded child, but lets the steps inside a leap strand freely', () => {
    // The candidate is the boundary, never the edit. A leap that strands a
    // branch on step one and blends it back in on step three is the one path
    // where that is a change somebody can see, so its intermediate states are
    // deliberately unchecked and only its result has to be whole.
    let leaps = 0;
    for (let at = 0; at < 60; at++) {
      const parent = {
        id: `p${at}`,
        flow: { name: 'parent', circuit: randomCircuit(seeded(`parent-${at}`)) },
        bundle: {},
        parentId: null,
        operation: 'random',
        generation: 0,
        cohort: `family-${at}`,
        verdict: null,
        selectedAt: null,
      };
      for (const draft of batchDrafts(parent, 6, seeded(`batch-${at}`))) {
        expect(strandedNodes(draft.flow.circuit), draft.operation).toEqual([]);
        if (draft.operation === 'explore:leap') leaps += 1;
      }
    }
    // The mix is the point: one-step children answer which knob, leaps answer
    // which future, and a batch that was all of one would only ask half.
    expect(leaps).toBeGreaterThan(0);
  });
});

describe('a batch of children', () => {
  it('is distinct, bounded, and never repeats the parent', () => {
    const parent = {
      id: 'p',
      flow: { name: 'parent', circuit: randomCircuit(seeded('one-parent')) },
      bundle: {},
      parentId: null,
      operation: 'random',
      generation: 0,
      cohort: 'family-one',
      verdict: null,
      selectedAt: null,
    };
    const drafts = batchDrafts(parent, 9, seeded('one-batch'));
    expect(drafts.length).toBeGreaterThan(4);
    const shapes = drafts.map((draft) => JSON.stringify(draft.flow.circuit));
    expect(new Set(shapes).size).toBe(shapes.length);
    expect(shapes).not.toContain(JSON.stringify(parent.flow.circuit));
    for (const draft of drafts) {
      expect(draft.parents).toEqual(['p']);
      expect(draft.generation).toBe(1);
      expect(draft.cohort).toBe('family-one');
    }
  });

  it('is deterministic from its seed', () => {
    const parent = {
      id: 'p',
      flow: { name: 'parent', circuit: randomCircuit(seeded('same-parent')) },
      bundle: {},
      parentId: null,
      operation: 'random',
      generation: 0,
      cohort: 'family',
      verdict: null,
      selectedAt: null,
    };
    expect(batchDrafts(parent, 5, seeded('deck'))).toEqual(
      batchDrafts(parent, 5, seeded('deck')),
    );
  });
});

describe('the batch tournament', () => {
  const field = (count: number) =>
    Array.from({ length: count }, (_, at) => ({
      candidateId: `c${at}`,
      isParent: at === 0,
      order: at,
      circuit: randomCircuit(seeded(`entrant-${at}`)),
    }));

  it('gives every entrant one match per round and stops when the rounds are answered', () => {
    const entrants = field(6);
    const evidence: BatchComparisonEvidence[] = [];
    let id = 1;
    for (let guard = 0; guard < 100; guard++) {
      const pair = nextBatchPair(entrants, evidence, 3, seeded(`pair-${id}`));
      if (!pair) break;
      evidence.push({
        id: id++,
        leftId: pair.leftId,
        rightId: pair.rightId,
        round: pair.round,
        disposition: 'compared',
        choice: 'left',
      });
    }
    // Six entrants, three rounds, a round being a perfect matching.
    expect(evidence).toHaveLength(9);
    for (let round = 0; round < 3; round++) {
      const played = evidence.filter((fact) => fact.round === round);
      expect(played).toHaveLength(3);
      const seen = played.flatMap((fact) => [fact.leftId, fact.rightId]).sort();
      expect(seen).toEqual(entrants.map((entrant) => entrant.candidateId).sort());
    }
  });

  it('ranks on smoothed preference, so one lucky win does not top four real ones', () => {
    const entrants = field(4);
    const standings = rankBatch(entrants, [
      { id: 1, leftId: 'c1', rightId: 'c2', round: 0, disposition: 'compared', choice: 'left' },
      { id: 2, leftId: 'c1', rightId: 'c3', round: 1, disposition: 'compared', choice: 'left' },
      { id: 3, leftId: 'c1', rightId: 'c0', round: 2, disposition: 'compared', choice: 'left' },
      { id: 4, leftId: 'c2', rightId: 'c3', round: 0, disposition: 'compared', choice: 'left' },
    ]);
    expect(standings[0].candidateId).toBe('c1');
    // `c2` won one of two; `c1` won three of three and is ahead despite both
    // having a perfect record on some prefix of their matches.
    expect(standings[0].preference).toBeGreaterThan(
      standings.find((row) => row.candidateId === 'c2')!.preference,
    );
  });

  it('leaves a skipped match out of the standings entirely', () => {
    const entrants = field(4);
    const standings = rankBatch(entrants, [
      { id: 1, leftId: 'c0', rightId: 'c1', round: 0, disposition: 'skipped', choice: null },
    ]);
    expect(standings.every((row) => row.matches === 0)).toBe(true);
  });
});

describe('Explore stages one root at a time', () => {
  it('admits, declines and skips without ever manufacturing a comparison', () => {
    const engine = labSearchEngine(open(), lineageMethod(), 'explore-deck');
    let state = engine.exploreOpen();
    const first = state.explore!.encounter!;
    expect(first.candidate.generation).toBe(0);
    expect(state.explore!.seen).toBe(0);

    state = engine.exploreJudge({ encounterId: first.id, verdict: 'yes' });
    expect(state.explore!.admitted).toBe(1);
    expect(state.explore!.seen).toBe(1);
    // Yes is the bookmark: "worth developing" and "come back here" are one
    // intention, said once.
    expect(state.archive!.nodes.find((node) => node.id === first.candidate.id)?.bookmarked).toBe(
      true,
    );

    const second = state.explore!.encounter!;
    expect(second.id).not.toBe(first.id);
    state = engine.exploreJudge({ encounterId: second.id, verdict: 'no' });
    expect(state.explore!.declined).toBe(1);
    expect(
      state.archive!.nodes.find((node) => node.id === second.candidate.id)?.bookmarked,
    ).toBe(false);

    const third = state.explore!.encounter!;
    state = engine.exploreSkip(third.id);
    expect(state.explore!.skipped).toBe(1);
    // A skip settles the question and creates no verdict of either kind.
    expect(state.explore!.seen).toBe(2);
    expect(state.explore!.admitted + state.explore!.declined).toBe(2);
    expect(state.explore!.encounter!.id).not.toBe(third.id);
  });

  it('refuses an answer to a seed that is no longer the one on screen', () => {
    const engine = labSearchEngine(open(), lineageMethod(), 'stale-deck');
    const state = engine.exploreOpen();
    const held = state.explore!.encounter!;
    engine.exploreJudge({ encounterId: held.id, verdict: 'yes' });
    const again = engine.exploreJudge({ encounterId: held.id, verdict: 'no' });
    expect(again.explore!.notice).toMatch(/no longer/);
    expect(again.explore!.admitted).toBe(1);
    expect(again.explore!.declined).toBe(0);
  });
});

describe('Develop runs a batch somebody asked for', () => {
  it('puts the parent in its own field and can report that nothing beat it', () => {
    const engine = labSearchEngine(open(), lineageMethod(), 'develop-deck');
    let state = engine.exploreOpen();
    const seed = state.explore!.encounter!;
    state = engine.exploreJudge({ encounterId: seed.id, verdict: 'yes' });

    state = engine.developDeal({ candidateId: seed.candidate.id, size: 6 });
    const develop = state.develop!;
    expect(develop.parent.id).toBe(seed.candidate.id);
    expect(develop.size).toBeGreaterThanOrEqual(4);
    expect(develop.size % 2).toBe(0);
    expect(develop.standings.some((row) => row.isParent)).toBe(true);
    expect(develop.encounter).not.toBeNull();

    // Answer every match in favour of whichever side is the parent.
    for (let guard = 0; guard < 60; guard++) {
      const held = state.develop?.encounter;
      if (!held) break;
      const parentIsLeft = held.left.id === develop.parent.id;
      state = engine.developCompare({
        encounterId: held.id,
        choice: parentIsLeft ? 'left' : held.right.id === develop.parent.id ? 'right' : 'neither',
      });
    }
    const done = state.develop!;
    expect(done.status).toBe('complete');
    expect(done.encounter).toBeNull();
    expect(done.compared).toBe(done.total);
    // The results screen re-stages an entrant in the room it was judged in, so
    // the room has to outlive the encounter that used to carry it — and every
    // entrant has to still be there to be looked at, not just the winner.
    expect(done.room).toEqual(develop.room);
    expect(done.standings).toHaveLength(develop.size);
    expect(done.standings.every((row) => row.candidate.flow.circuit.nodes.length > 0)).toBe(true);
    // The result the old Refine phase could not state.
    expect(done.standings[0].isParent).toBe(true);
    expect(done.improved).toBe(false);
  });

  it('records the room a match was answered under when the light was changed', () => {
    const store = open();
    const engine = labSearchEngine(store, lineageMethod(), 'relight-deck');
    let state = engine.exploreOpen();
    const seed = state.explore!.encounter!;
    state = engine.exploreJudge({ encounterId: seed.id, verdict: 'yes' });
    state = engine.developDeal({ candidateId: seed.candidate.id, size: 6 });

    const dealt = state.develop!.room;
    const relit = { ...dealt, colors: ['#ff0000', '#00ff00'] };
    const first = state.develop!.encounter!;
    state = engine.developCompare({ encounterId: first.id, choice: 'left', room: relit });

    // The batch keeps the room it was dealt: that one is the field's control,
    // and a person changing the light must not be able to rewrite it.
    expect(state.develop!.room).toEqual(dealt);

    const rows = store
      .exportJsonl()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const comparison = rows.find((row) => row.t === 'batch_comparison')!;
    const challenge = rows.find(
      (row) => row.t === 'challenge' && row.id === comparison.challenge_id,
    )!;
    expect(JSON.parse(challenge.room_json as string).colors).toEqual(['#ff0000', '#00ff00']);

    // And a match answered without saying anything is the batch's own room.
    const second = state.develop!.encounter!;
    state = engine.developCompare({ encounterId: second.id, choice: 'left' });
    const after = store
      .exportJsonl()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const plain = after.filter((row) => row.t === 'batch_comparison')[1]!;
    const dealtChallenge = after.find(
      (row) => row.t === 'challenge' && row.id === plain.challenge_id,
    )!;
    expect(JSON.parse(dealtChallenge.room_json as string).colors).toEqual(dealt.colors);
  });

  it('records that the family improved when a child leads', () => {
    const engine = labSearchEngine(open(), lineageMethod(), 'improve-deck');
    let state = engine.exploreOpen();
    const seed = state.explore!.encounter!;
    state = engine.exploreJudge({ encounterId: seed.id, verdict: 'yes' });
    state = engine.developDeal({ candidateId: seed.candidate.id, size: 6 });
    const parentId = state.develop!.parent.id;

    for (let guard = 0; guard < 60; guard++) {
      const held = state.develop?.encounter;
      if (!held) break;
      const choice =
        held.left.id === parentId ? 'right' : held.right.id === parentId ? 'left' : 'left';
      state = engine.developCompare({ encounterId: held.id, choice });
    }
    const done = state.develop!;
    expect(done.improved).toBe(true);
    expect(done.standings[0].isParent).toBe(false);
    // The children a batch staged are in the forest whether or not they won.
    const developed = state.archive!.nodes.find((node) => node.id === parentId);
    expect(developed?.batches).toBe(1);
    expect(developed?.children).toBeGreaterThan(0);
  });

  it('refuses a second batch while one is open, and reopens the forest after discarding', () => {
    const engine = labSearchEngine(open(), lineageMethod(), 'one-batch-deck');
    let state = engine.exploreOpen();
    const seed = state.explore!.encounter!;
    state = engine.exploreJudge({ encounterId: seed.id, verdict: 'yes' });
    state = engine.developDeal({ candidateId: seed.candidate.id, size: 6 });
    expect(state.develop).not.toBeNull();

    state = engine.developDeal({ candidateId: seed.candidate.id, size: 6 });
    expect(state.notice).toMatch(/open batch/);

    state = engine.developClose();
    expect(state.develop).toBeNull();
    // Abandoned rather than deleted: the works it staged keep their dots.
    expect(state.archive!.nodes.length).toBeGreaterThan(1);
  });

  it('refuses a field size it does not offer', () => {
    const engine = labSearchEngine(open(), lineageMethod(), 'size-deck');
    let state = engine.exploreOpen();
    const seed = state.explore!.encounter!;
    state = engine.exploreJudge({ encounterId: seed.id, verdict: 'yes' });
    state = engine.developDeal({ candidateId: seed.candidate.id, size: 7 });
    expect(state.develop).toBeNull();
    expect(state.notice).toMatch(/6, 10, 16/);
  });
});

describe('bookmarks are navigation, not a verdict', () => {
  it('marks and unmarks any work in the forest, several per family', () => {
    const engine = labSearchEngine(open(), lineageMethod(), 'bookmark-deck');
    let state = engine.exploreOpen();
    const first = state.explore!.encounter!;
    state = engine.exploreJudge({ encounterId: first.id, verdict: 'yes' });
    state = engine.developDeal({ candidateId: first.candidate.id, size: 6 });

    const child = state.develop!.standings.find((row) => !row.isParent)!.candidate.id;
    state = engine.bookmark({ candidateId: child, marked: true });
    const family = state.archive!.nodes.filter((node) => node.bookmarked).map((node) => node.id);
    expect(family).toContain(first.candidate.id);
    expect(family).toContain(child);

    state = engine.bookmark({ candidateId: child, marked: false });
    expect(state.archive!.nodes.find((node) => node.id === child)?.bookmarked).toBe(false);
    // Unmarking the descendant leaves the ancestor exactly where it was.
    expect(state.archive!.nodes.find((node) => node.id === first.candidate.id)?.bookmarked).toBe(
      true,
    );
  });
});

describe('a seed deals the same root from the same seed', () => {
  it('is deterministic and whole', () => {
    expect(seedDraft(seeded('one')).flow.circuit).toEqual(seedDraft(seeded('one')).flow.circuit);
    expect(strandedNodes(seedDraft(seeded('one')).flow.circuit)).toEqual([]);
  });
});
