import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dealRoom, seeded, type CandidateDraft, type LabMethod } from '../lab.ts';
import type { FlowDef, LabRoom, LabSubmission } from '../protocol.ts';
import { SOURCES } from '../protocol.ts';
import { freshMethod } from './fresh.ts';
import { labEngine, openLab, type LabStore } from './lab.ts';

const dirs: string[] = [];
const opened: LabStore[] = [];

const scratch = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openflow-lab-'));
  dirs.push(dir);
  return path.join(dir, 'lab.sqlite3');
};

const open = (file: string): LabStore => {
  const store = openLab(file);
  opened.push(store);
  return store;
};

afterEach(() => {
  for (const store of opened.splice(0)) {
    try {
      store.close();
    } catch {
      // Already closed by the code under test.
    }
  }
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const candidate = (id: string, mode = 'rings'): { id: string; flow: FlowDef; bundle: {}; generatorVersion: string } => ({
  id,
  flow: {
    name: `Candidate ${id}`,
    circuit: {
      nodes: [
        { id: 's1', kind: 'source', op: mode, x: 0, y: 0 },
        { id: 'out1', kind: 'out', x: 100, y: 0 },
      ],
      cords: [{ from: 's1/c', to: 'out1/c' }],
    },
  },
  bundle: {},
  generatorVersion: 'test@1',
});

const judgment = (candidateId: string, room: LabRoom, score: 1 | 2 | 3 | 4 | 5): LabSubmission => ({
  candidateId,
  room,
  score,
  tags:
    score >= 4
      ? ['geometric', 'breathing', 'distinctive', 'euphoric']
      : score <= 2
        ? ['chaotic', 'twitchy', 'generic']
        : ['organic', 'breathing', 'coherent'],
  note: `scored ${score}`,
});

describe('the store', () => {
  it('creates its schema from nothing and reopens it migrated', () => {
    const file = scratch();
    const store = open(file);
    const experiment = store.openExperiment('fresh', 1, 'deck');
    expect(experiment).toBeGreaterThan(0);
    store.close();
    const again = open(file);
    expect(again.openExperiment('fresh', 1, 'deck')).toBe(experiment);
  });

  it('keeps a review whole across a restart', () => {
    const file = scratch();
    const store = open(file);
    const experiment = store.openExperiment('fresh', 1, 'deck');
    store.addCandidate(candidate('c-one'));
    store.addOrigin({ candidateId: 'c-one', experimentId: experiment, operation: 'fresh' });
    store.serve('c-one', experiment);
    const room = dealRoom('room:c-one');
    const answer = store.submit(judgment('c-one', room, 4), {
      experimentId: experiment,
      rendererVersion: 'pipeline@1',
    });
    expect(answer.ok).toBe(true);
    store.close();

    const again = open(file);
    const held = again.reviews('c-one');
    expect(held).toHaveLength(1);
    expect(held[0].score).toBe(4);
    expect(held[0].room).toEqual(room);
    expect(held[0].tags).toEqual(['breathing', 'distinctive', 'euphoric', 'geometric']);
    expect(again.candidate('c-one')?.flow.name).toBe('Candidate c-one');
    expect(again.counts(again.openExperiment('fresh', 1, 'deck'))).toEqual({
      reviewed: 1,
      skipped: 0,
      pending: 0,
    });
  });

  it('refuses a submission it cannot trust, atomically', () => {
    const store = open(scratch());
    const experiment = store.openExperiment('fresh', 1, 'deck');
    store.addCandidate(candidate('c-one'));
    store.serve('c-one', experiment);
    const bad = judgment('c-one', dealRoom('r'), 4);
    bad.tags = [...bad.tags, 'no-such-tag'];
    const answer = store.submit(bad, { experimentId: experiment, rendererVersion: 'p@1' });
    expect(answer.ok).toBe(false);
    expect(store.reviews('c-one')).toHaveLength(0);
    expect(store.counts(experiment).pending).toBe(1);

    const bare = judgment('c-one', dealRoom('r'), 2);
    bare.tags = [];
    expect(store.submit(bare, { experimentId: experiment, rendererVersion: 'p@1' }).ok).toBe(true);
  });

  it('keeps a skip as its own fact, never a score', () => {
    const store = open(scratch());
    const experiment = store.openExperiment('fresh', 1, 'deck');
    store.addCandidate(candidate('c-one'));
    store.serve('c-one', experiment);
    store.skip('c-one', experiment);
    expect(store.counts(experiment)).toEqual({ reviewed: 0, skipped: 1, pending: 0 });
    expect(store.reviews('c-one')).toHaveLength(0);
    expect(store.aggregate('c-one').count).toBe(0);
  });

  it('rebuilds aggregates from raw reviews and snapshots them versioned', () => {
    const store = open(scratch());
    const experiment = store.openExperiment('fresh', 1, 'deck');
    store.addCandidate(candidate('c-one'));
    for (const score of [4, 2] as const) {
      store.serve('c-one', experiment);
      const answer = store.submit(judgment('c-one', dealRoom(`r${score}`), score), {
        experimentId: experiment,
        rendererVersion: 'p@1',
      });
      expect(answer.ok).toBe(true);
    }
    const held = store.aggregate('c-one');
    expect(held.count).toBe(2);
    expect(held.mean).toBe(3);
    expect(held.distribution[4]).toBe(1);
    expect(held.distribution[2]).toBe(1);
    const generic = held.tags.find((t) => t.id === 'generic');
    expect(generic?.count).toBe(1);
    expect(store.snapshotRatings('mean', 1)).toBe(1);
  });

  it('lists the log newest first and pages past it', () => {
    const store = open(scratch());
    const experiment = store.openExperiment('fresh', 1, 'deck');
    store.addCandidate(candidate('c-one'));
    for (const score of [2, 3, 4] as const) {
      store.serve('c-one', experiment);
      store.submit(judgment('c-one', dealRoom(`r${score}`), score), {
        experimentId: experiment,
        rendererVersion: 'p@1',
      });
    }
    const page = store.reviewLog(2);
    expect(page.more).toBe(true);
    expect(page.reviews.map((row) => row.score)).toEqual([4, 3]);
    expect(page.reviews[0].flowName).toBe('Candidate c-one');
    expect(page.reviews[0].room).toEqual(dealRoom('r4'));
    const rest = store.reviewLog(2, page.reviews[1].id);
    expect(rest.more).toBe(false);
    expect(rest.reviews.map((row) => row.score)).toEqual([2]);
  });

  it('revises tags and note; the judgment itself has no verb', () => {
    const store = open(scratch());
    const experiment = store.openExperiment('fresh', 1, 'deck');
    store.addCandidate(candidate('c-one'));
    store.serve('c-one', experiment);
    store.submit(judgment('c-one', dealRoom('r'), 2), {
      experimentId: experiment,
      rendererVersion: 'p@1',
    });
    const held = store.reviewLog(1).reviews[0];

    const retagged = store.retag(held.id, ['generic', 'muddy']);
    expect(retagged.ok && retagged.review.tags).toEqual(['generic', 'muddy']);
    expect(store.retag(held.id, ['no-such-tag']).ok).toBe(false);
    expect(store.retag(held.id + 99, ['generic']).ok).toBe(false);

    const renoted = store.renote(held.id, ' better words ');
    expect(renoted.ok && renoted.review.note).toBe('better words');
    const cleared = store.renote(held.id, '  ');
    expect(cleared.ok && cleared.review.note).toBe(null);

    const rescored = store.rescore(held.id, 4);
    expect(rescored.ok && rescored.review.score).toBe(4);
    expect(store.rescore(held.id, 7 as 5).ok).toBe(false);
    expect(store.rescore(held.id + 99, 3).ok).toBe(false);

    const after = store.reviewLog(1).reviews[0];
    expect(after.score).toBe(4);
    expect(after.room).toEqual(held.room);
    expect(after.createdAt).toBe(held.createdAt);
  });

  it('round-trips every durable fact through JSONL', () => {
    const store = open(scratch());
    const experiment = store.openExperiment('fresh', 1, 'deck');
    store.addCandidate(candidate('c-one'));
    store.addOrigin({ candidateId: 'c-one', experimentId: experiment, operation: 'fresh' });
    store.serve('c-one', experiment);
    store.submit(judgment('c-one', dealRoom('r'), 5), {
      experimentId: experiment,
      rendererVersion: 'p@1',
    });
    store.addCandidate(candidate('c-two', 'noise'));
    store.serve('c-two', experiment);
    store.skip('c-two', experiment);

    const text = store.exportJsonl();
    const twin = open(scratch());
    twin.importJsonl(text);
    expect(twin.reviews('c-one')).toEqual(store.reviews('c-one'));
    expect(twin.candidate('c-two')?.flow).toEqual(store.candidate('c-two')?.flow);
    expect(twin.counts(twin.openExperiment('fresh', 1, 'deck'))).toEqual(
      store.counts(experiment),
    );
    expect(() => twin.importJsonl(text)).toThrow(/empty/);
  });
});

/** A method that is not `fresh` in any way, to prove the engine does not care. */
const fakeMethod = (): LabMethod<number> => ({
  id: 'fake',
  version: 7,
  start: () => 0,
  next(_state, _evidence, budget, rng) {
    const drafts: CandidateDraft[] = [];
    for (let i = 0; i < budget; i++) {
      const mode = SOURCES[Math.floor(rng() * SOURCES.length)];
      const dealt = candidate('x', mode).flow;
      // A held value as well as a mode, so no two deals share an identity.
      dealt.circuit.nodes[0].values = { amount: Math.round(rng() * 1000) / 1000 };
      drafts.push({ flow: dealt, bundle: {}, parents: [], operation: 'fake-deal' });
    }
    return drafts;
  },
  observe: (state) => state + 1,
});

describe('the engine', () => {
  it('deals only when opened, and identically for one seed', () => {
    const a = labEngine(open(scratch()), fakeMethod(), 'one-deck');
    const b = labEngine(open(scratch()), fakeMethod(), 'one-deck');
    const stateA = a.open();
    const stateB = b.open();
    expect(stateA.candidate?.id).toBeTruthy();
    expect(stateA.candidate?.id).toBe(stateB.candidate?.id);
    expect(stateA.room).toEqual(stateB.room);
    expect(stateA.pending).toBe(1);
    expect(stateA.method).toBe('fake');
  });

  it('survives a restart holding the same candidate', () => {
    const file = scratch();
    const engine = labEngine(open(file), fakeMethod(), 'one-deck');
    const before = engine.open();
    engine.close();
    const again = labEngine(open(file), fakeMethod(), 'one-deck');
    const after = again.open();
    expect(after.candidate?.id).toBe(before.candidate?.id);
    expect(after.pending).toBe(1);
  });

  it('advances on a submit and refuses without losing the candidate', () => {
    const engine = labEngine(open(scratch()), fakeMethod(), 'one-deck');
    const first = engine.open();
    const bad = judgment(first.candidate!.id, first.room!, 3);
    bad.tags = ['no-such-tag'];
    const refused = engine.submit(bad);
    expect(refused.notice).toBeTruthy();
    expect(refused.candidate?.id).toBe(first.candidate?.id);
    expect(refused.reviewed).toBe(0);

    const accepted = engine.submit(judgment(first.candidate!.id, first.room!, 3));
    expect(accepted.notice).toBeNull();
    expect(accepted.reviewed).toBe(1);
    expect(accepted.candidate?.id).toBeTruthy();
    expect(accepted.candidate?.id).not.toBe(first.candidate?.id);
  });

  it('advances on a skip, recorded as a skip', () => {
    const engine = labEngine(open(scratch()), fakeMethod(), 'one-deck');
    const first = engine.open();
    const after = engine.skip(first.candidate!.id);
    expect(after.skipped).toBe(1);
    expect(after.reviewed).toBe(0);
    expect(after.candidate?.id).not.toBe(first.candidate?.id);
  });

  it('an offered flow jumps the queue and says it is manual', () => {
    const engine = labEngine(open(scratch()), fakeMethod(), 'one-deck');
    const dealt = engine.open();
    expect(dealt.candidate?.method).toBe('fake');

    const mine = candidate('built-by-hand', 'plasma');
    const offered = engine.offer(mine.flow, mine.bundle);
    expect(offered.candidate?.flow.name).toBe('Candidate built-by-hand');
    expect(offered.candidate?.method).toBe('manual');
    expect(offered.pending).toBe(2);

    // Offering the same flow again while it waits is a double click, not a
    // second serving.
    expect(engine.offer(mine.flow, mine.bundle).pending).toBe(2);

    const judged = engine.submit(
      judgment(offered.candidate!.id, offered.room!, 4),
    );
    expect(judged.candidate?.method).toBe('fake');
    expect(judged.candidate?.id).toBe(dealt.candidate?.id);
  });

  it('refuses an offer that does not compile', () => {
    const engine = labEngine(open(scratch()), fakeMethod(), 'one-deck');
    engine.open();
    const broken = candidate('broken', 'plasma');
    broken.flow.circuit.nodes = [...broken.flow.circuit.nodes, { id: 'out2', kind: 'out', x: 0, y: 90 }];
    const state = engine.offer(broken.flow, broken.bundle);
    expect(state.notice).toBeTruthy();
    expect(state.candidate?.method).toBe('fake');
  });
});

describe('the fresh method', () => {
  it('is deterministic in its seed', () => {
    const method = freshMethod();
    const a = method.next(null, { reviewed: 0, skipped: 0 }, 3, seeded('deck:0'));
    const b = method.next(null, { reviewed: 0, skipped: 0 }, 3, seeded('deck:0'));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = method.next(null, { reviewed: 0, skipped: 0 }, 3, seeded('deck:1'));
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));
  });

  it('deals candidates the engine accepts', () => {
    const engine = labEngine(open(scratch()), freshMethod(), 'real-deck');
    const state = engine.open();
    expect(state.candidate).not.toBeNull();
    expect(state.candidate!.flow.circuit.nodes.length).toBeGreaterThan(3);
    expect(state.candidate!.method).toBe('fresh');
  });
});
