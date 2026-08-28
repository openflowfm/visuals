import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { seeded } from '../lab.ts';
import { compileCircuit } from '../src/render/circuit.ts';
import { labSearchEngine, openLab, type LabStore } from './lab.ts';
import { circuitDistance, lineageMethod, mutateCircuit, randomCircuit } from './lineage.ts';

const dirs: string[] = [];
const stores: LabStore[] = [];

const open = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openflow-lineage-'));
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

describe('small random graphs', () => {
  it('is deterministic, bounded, and compiling across a broad deck', () => {
    expect(randomCircuit(seeded('same'))).toEqual(randomCircuit(seeded('same')));
    const kinds = new Set<string>();
    for (let at = 0; at < 250; at++) {
      const circuit = randomCircuit(seeded(`seed-${at}`));
      expect(circuit.nodes.length).toBeLessThanOrEqual(7);
      expect(compileCircuit(circuit).error, `seed-${at}`).toBeNull();
      for (const node of circuit.nodes) kinds.add(node.kind);
    }
    // These used to be unreachable from the fixed fresh dealer. Their presence
    // proves this deck is sampling typed capabilities rather than five recipes.
    expect(kinds).toContain('lfo');
    expect(kinds).toContain('halftone');
    expect(kinds).toContain('blend');
    expect(kinds).toContain('fractal');
  });
});

describe('atomic mutation', () => {
  it('changes one operation and never adds more than one node', () => {
    let changed = 0;
    for (let at = 0; at < 120; at++) {
      const circuit = randomCircuit(seeded(`parent-${at}`));
      const mutation = mutateCircuit(circuit, seeded(`mutation-${at}`));
      if (!mutation) continue;
      changed += 1;
      expect(mutation.operation).toMatch(/^mutate:/);
      expect(mutation.circuit.nodes.length - circuit.nodes.length).toBeLessThanOrEqual(1);
      expect(mutation.circuit).not.toEqual(circuit);
      expect(compileCircuit(mutation.circuit).error).toBeNull();
    }
    expect(changed).toBeGreaterThan(100);
  });
});

describe('recursive explore and refine', () => {
  it('moves from distant immigrants to a leap, an atomic refinement, then a new-depth explore', () => {
    const engine = labSearchEngine(open(), lineageMethod(), 'lineage-deck');
    let state = engine.open();
    const roots = state.encounter!;
    expect(roots.phase).toBe('explore');
    expect(roots.anchorId).toBeNull();
    expect(roots.left.generation).toBe(0);
    expect(roots.right.generation).toBe(0);
    expect(circuitDistance(roots.left.flow.circuit, roots.right.flow.circuit)).toBeGreaterThan(0.5);

    state = engine.compare({ encounterId: roots.id, choice: 'left' });
    const leap = state.encounter!;
    expect(leap.phase).toBe('explore');
    expect(leap.anchorId).toBe(roots.left.id);
    expect(leap.left.parentId).toBe(roots.left.id);
    expect(leap.right.parentId).toBe(roots.left.id);
    expect(leap.left.operation).toBe('explore:leap');
    expect(leap.right.operation).toBe('explore:leap');
    expect(circuitDistance(leap.left.flow.circuit, leap.right.flow.circuit)).toBeGreaterThan(0.2);

    state = engine.compare({ encounterId: leap.id, choice: 'right' });
    const refinement = state.encounter!;
    expect(refinement.phase).toBe('refine');
    expect(refinement.anchorId).toBe(leap.right.id);
    expect(refinement.left.id).toBe(leap.right.id);
    expect(refinement.right.parentId).toBe(leap.right.id);
    expect(refinement.right.operation).toMatch(/^mutate:/);
    expect(
      refinement.right.flow.circuit.nodes.length - refinement.left.flow.circuit.nodes.length,
    ).toBeLessThanOrEqual(1);

    state = engine.compare({ encounterId: refinement.id, choice: 'right' });
    const recursive = state.encounter!;
    expect(recursive.phase).toBe('explore');
    expect(recursive.anchorId).toBe(refinement.right.id);
    expect(recursive.depth).toBe(refinement.right.generation + 1);
    expect(state.comparisons).toBe(3);
    expect(state.explores).toBe(2);
    expect(state.refines).toBe(1);
    expect(state.frontier).toBeGreaterThan(1);
    expect(state.maxGeneration).toBeGreaterThanOrEqual(2);
  });

  it('does not manufacture a winner when neither immigrant works', () => {
    const engine = labSearchEngine(open(), lineageMethod(), 'empty-deck');
    const first = engine.open().encounter!;
    const state = engine.compare({ encounterId: first.id, choice: 'neither' });
    expect(state.frontier).toBe(0);
    expect(state.encounter?.phase).toBe('explore');
    expect(state.encounter?.anchorId).toBeNull();
  });

  it('keeps both branches when both directions work', () => {
    const engine = labSearchEngine(open(), lineageMethod(), 'both-deck');
    const first = engine.open().encounter!;
    const state = engine.compare({ encounterId: first.id, choice: 'both' });
    expect(state.frontier).toBe(2);
    expect(state.encounter?.anchorId).not.toBeNull();
  });

  it('bounds a growing frontier and reopens global exploration every five answers', () => {
    const engine = labSearchEngine(open(), lineageMethod(), 'long-deck');
    let state = engine.open();
    for (let answered = 0; answered < 15; answered++) {
      const encounter = state.encounter!;
      if (answered % 5 === 0) {
        expect(encounter.phase).toBe('explore');
        expect(encounter.anchorId).toBeNull();
      }
      state = engine.compare({ encounterId: encounter.id, choice: 'both' });
      expect(state.frontier).toBeLessThanOrEqual(8);
    }
    expect(state.comparisons).toBe(15);
    expect(state.frontier).toBe(8);
    expect(state.maxGeneration).toBeGreaterThanOrEqual(1);
  });

  it('puts a manually offered flow ahead of the infinite generated supply', () => {
    const engine = labSearchEngine(open(), lineageMethod(), 'manual-deck');
    const generated = engine.open().encounter!;
    const changed = mutateCircuit(generated.left.flow.circuit, seeded('manual-change'))!;
    const manual = {
      ...generated.left.flow,
      name: 'Built by hand',
      circuit: changed.circuit,
    };
    const state = engine.offer(manual, generated.left.bundle);
    expect(state.pending).toBe(2);
    expect(state.encounter?.phase).toBe('refine');
    expect(state.encounter?.left.flow.name).toBe('Built by hand');
    expect(state.encounter?.left.method).toBe('manual');

    const stale = engine.compare({ encounterId: generated.id, choice: 'left' });
    expect(stale.notice).toMatch(/no longer/);
    expect(stale.encounter?.id).toBe(state.encounter?.id);

    const after = engine.compare({ encounterId: state.encounter!.id, choice: 'left' });
    expect(after.encounter?.id).toBe(generated.id);

    // Canonical identity ignores a display-name-only edit. Offering that known
    // behavior still focuses its new question without forging a manual origin.
    const known = engine.offer(
      { ...generated.right.flow, name: 'A known graph, renamed' },
      generated.right.bundle,
    );
    expect(known.encounter?.id).not.toBe(generated.id);
    expect(known.encounter?.phase).toBe('refine');
    expect(known.encounter?.anchorId).toBe(generated.right.id);
    expect(known.encounter?.left.id).toBe(generated.right.id);
    expect(known.encounter?.left.method).toBe('lineage');
    const repeated = engine.offer(generated.right.flow, generated.right.bundle);
    expect(repeated.pending).toBe(known.pending);
    expect(repeated.encounter?.id).toBe(known.encounter?.id);
  });
});

describe('the historical Archive', () => {
  it('separates preserving a finished work from advancing its search direction', () => {
    const engine = labSearchEngine(open(), lineageMethod(), 'archive-deck');
    let state = engine.open();
    const first = state.encounter!;

    state = engine.archiveDecide({
      candidateId: first.left.id,
      verdict: 'keep',
      source: 'search',
    });
    expect(state.archive?.keptCandidateIds).toContain(first.left.id);
    expect(state.encounter?.id).toBe(first.id);

    state = engine.compare({ encounterId: first.id, choice: 'both' });
    expect(state.archive?.candidate?.id).toBe(first.right.id);
    expect(state.archive?.room).toEqual(first.room);
    state = engine.archiveDecide({
      candidateId: first.right.id,
      verdict: 'pass',
      source: 'archive',
    });
    expect(state.archive?.reviewed).toBe(2);
    expect(state.archive?.kept).toBe(1);
    expect(state.archive?.nodes).toHaveLength(4);

    state = engine.archiveSelect(first.left.id);
    state = engine.lineageFinalist({ candidateId: first.left.id, finalist: true });
    const descendant = state.archive!.nodes.find(
      (node) => node.cohort === first.left.cohort && node.id !== first.left.id,
    )!;
    state = engine.archiveSelect(descendant.id);
    state = engine.lineageFinalist({ candidateId: descendant.id, finalist: true });
    expect(
      state.archive?.nodes.filter((node) => node.cohort === descendant.cohort && node.finalist)
        .map((node) => node.id),
    ).toEqual([descendant.id]);
  });
});

describe('Finals over a frozen search', () => {
  it('plays a diverse field once in every room and produces ten leaders', () => {
    const store = open();
    const method = lineageMethod();
    const engine = labSearchEngine(store, method, 'finals-deck');
    let state = engine.open();
    for (let at = 0; at < 60; at++) {
      const encounter = state.encounter!;
      state = engine.compare({ encounterId: encounter.id, choice: 'both' });
    }

    state = engine.finalsOpen();
    expect(state.finals?.status).toBe('judging');
    expect(state.finals?.nominees).toBe(24);
    expect(state.finals?.total).toBe(48);

    let answered = 0;
    while (state.finals?.status === 'judging' && answered < 60) {
      const match = state.finals.encounter!;
      state = engine.finalsCompare({
        encounterId: match.id,
        choice: answered % 3 === 0 ? 'both' : 'left',
        leftShowReady: true,
        rightShowReady: answered % 2 === 0,
      });
      answered += 1;
    }

    expect(answered).toBe(48);
    expect(state.finals?.status).toBe('complete');
    expect(state.finals?.compared).toBe(48);
    expect(state.finals?.encounter).toBeNull();
    expect(state.finals?.leaders).toHaveLength(10);
    expect(state.finals?.leaders.every((leader) => leader.matches === 4)).toBe(true);

    const firstRun = state.finals!.runId;
    const protectedWork = state.encounter!.left;
    state = engine.archiveDecide({
      candidateId: protectedWork.id,
      verdict: 'keep',
      source: 'search',
    });
    state = engine.archiveSelect(protectedWork.id);
    state = engine.lineageFinalist({ candidateId: protectedWork.id, finalist: true });
    state = engine.finalsNew();
    expect(state.finals?.runId).not.toBe(firstRun);
    expect(state.finals?.status).toBe('judging');
    const experiment = store.openExperiment(method.id, method.version, 'finals-deck');
    const nominees = store.finalsNominees(state.finals!.runId, experiment)
      .map((nominee) => nominee.candidate.id);
    expect(nominees).toContain(protectedWork.id);
    expect(nominees[0]).toBe(protectedWork.id);
  }, 10_000);
});
