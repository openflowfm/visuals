import { describe, expect, it } from 'vitest';
import { readUp, UP_KINDS } from './up.ts';

/**
 * The input boundary, against the shapes that used to end the show.
 *
 * Every case below was traced to a throw inside the socket's `'message'`
 * listener, which is process exit, which is a black wall mid-set. None of them
 * needs an attacker: a wall tab left open across a server restart sends the
 * protocol it was built against, and that is version skew rather than malice.
 */

const room = {
  tempo: 120,
  quantum: 4,
  energy: 0.5,
  section: 'chorus',
  sections: ['verse', 'chorus'],
  key: 7,
  colors: ['#112233'],
  seed: 'oak-ember-12',
};

const wire = (value: unknown) => readUp(JSON.stringify(value));

/** One valid frame per kind, so a schema that exists but is wrong is still caught. */
const SAMPLES: Record<string, unknown> = {
  scheme: { kind: 'scheme', scheme: {} },
  'save-scheme': { kind: 'save-scheme' },
  'save-scheme-as': { kind: 'save-scheme-as', id: 'one' },
  'load-scheme': { kind: 'load-scheme', id: 'one' },
  downbeat: { kind: 'downbeat' },
  'next-flow': { kind: 'next-flow' },
  'next-colorway': { kind: 'next-colorway' },
  'model-save': {
    kind: 'model-save',
    setup: {
      id: 'capsule',
      name: 'Capsule',
      assetHash: 'a'.repeat(64),
      bindings: [{
        id: 'turn',
        label: 'Turn',
        group: 'motion',
        target: { kind: 'node-transform', node: 0, nodePath: 'Capsule', property: 'rotation-x' },
        default: 0.5,
        min: -3.14,
        max: 3.14,
      }],
      materials: [{ material: 0, source: 'color-a', amount: 1 }],
      camera: null,
    },
  },
  'model-reconcile': {
    kind: 'model-reconcile',
    setupId: 'capsule',
    assetHash: 'b'.repeat(64),
    decision: {
      targets: {
        turn: { kind: 'node-transform', node: 2, nodePath: 'Revised/Capsule', property: 'rotation-x' },
      },
      materials: { 0: 1 },
      camera: null,
    },
  },
  'lab-open': { kind: 'lab-open' },
  'lab-compare': { kind: 'lab-compare', comparison: { encounterId: 1, choice: 'left' } },
  'lab-skip-encounter': { kind: 'lab-skip-encounter', encounterId: 1 },
  'lab-archive-open': { kind: 'lab-archive-open' },
  'lab-archive-select': { kind: 'lab-archive-select', candidateId: 'c' },
  'lab-archive-decide': {
    kind: 'lab-archive-decide',
    decision: { candidateId: 'c', verdict: 'keep', source: 'archive' },
  },
  'lab-lineage-finalist': {
    kind: 'lab-lineage-finalist',
    decision: { candidateId: 'c', finalist: true },
  },
  'lab-explore-open': { kind: 'lab-explore-open' },
  'lab-explore-judge': {
    kind: 'lab-explore-judge',
    submission: { encounterId: 1, verdict: 'yes' },
  },
  'lab-explore-skip': { kind: 'lab-explore-skip', encounterId: 1 },
  'lab-bookmark': { kind: 'lab-bookmark', decision: { candidateId: 'c', marked: true } },
  'lab-develop-open': { kind: 'lab-develop-open', candidateId: 'c' },
  'lab-develop-deal': { kind: 'lab-develop-deal', request: { candidateId: 'c', size: 10 } },
  'lab-develop-compare': {
    kind: 'lab-develop-compare',
    comparison: { encounterId: 1, choice: 'both' },
  },
  'lab-develop-skip': { kind: 'lab-develop-skip', encounterId: 1 },
  'lab-develop-close': { kind: 'lab-develop-close' },
  'lab-finals-open': { kind: 'lab-finals-open' },
  'lab-finals-new': { kind: 'lab-finals-new' },
  'lab-finals-compare': {
    kind: 'lab-finals-compare',
    comparison: {
      encounterId: 1,
      choice: 'left',
      leftShowReady: true,
      rightShowReady: false,
    },
  },
  'lab-finals-skip': { kind: 'lab-finals-skip', encounterId: 1 },
  'lab-select': { kind: 'lab-select', selection: { candidateId: 'c', verdict: 'up' } },
  'lab-review': {
    kind: 'lab-review',
    review: { candidateId: 'c', room, score: 3, tags: [] },
  },
  'lab-skip': { kind: 'lab-skip', candidateId: 'c' },
  'lab-offer': { kind: 'lab-offer', flowId: 'f' },
  'lab-log': { kind: 'lab-log' },
  'lab-rescore': { kind: 'lab-rescore', reviewId: 1, score: 4 },
  'lab-retag': { kind: 'lab-retag', reviewId: 1, tags: ['warm'] },
  'lab-renote': { kind: 'lab-renote', reviewId: 1, note: 'a note' },
  'lab-candidate': { kind: 'lab-candidate', candidateId: 'c' },
  'calibration-open': { kind: 'calibration-open' },
  'calibration-decide': {
    kind: 'calibration-decide',
    decision: {
      trialId: 't',
      trialVersion: 1,
      room,
      selectedOptionId: null,
      response: null,
      extent: 1,
    },
  },
};

describe('every message the protocol names gets through this door', () => {
  /**
   * The failure this covers is quiet and was real: a gesture added to
   * `protocol.ts` and to both ends of the wire, but not to the schema here, is
   * dropped with one line in the server log — the client sends it, nothing
   * happens, and the feature looks broken rather than unvalidated. The type
   * assertion in `up.ts` catches a *missing* schema; this catches one that
   * exists and refuses the very frame the client actually sends.
   */
  it('accepts one real frame of each kind, with none forgotten', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...UP_KINDS].sort());
    for (const kind of UP_KINDS) {
      const read = readUp(JSON.stringify(SAMPLES[kind]));
      expect(read.ok, `${kind}: ${read.ok ? '' : read.why}`).toBe(true);
    }
  });
});

describe('reading a message off the socket', () => {
  it('takes every gesture that carries nothing', () => {
    for (const kind of [
      'downbeat',
      'next-flow',
      'next-colorway',
      'lab-open',
      'calibration-open',
      'save-scheme',
    ]) {
      expect(wire({ kind }).ok).toBe(true);
    }
  });

  it('accepts a whole calibration decision and rejects a malformed response', () => {
    const decision = {
      trialId: 'rotation-spin',
      trialVersion: 1,
      room,
      selectedOptionId: 'square',
      response: {
        kind: 'centered-power',
        center: 0.5,
        min: -0.1,
        neutral: 0,
        max: 0.1,
        exponent: 2,
        unit: 'turn/beat',
      },
      extent: 0.8,
      note: 'good middle',
    };
    expect(wire({ kind: 'calibration-decide', decision }).ok).toBe(true);
    expect(
      wire({
        kind: 'calibration-decide',
        decision: { ...decision, response: { ...decision.response, exponent: -1 } },
      }).ok,
    ).toBe(false);
  });

  it('opens one calibration parameter only with its complete frozen identity', () => {
    expect(
      wire({ kind: 'calibration-open', trialId: 'parameter-lens-zoom-by', trialVersion: 1 }).ok,
    ).toBe(true);
    expect(wire({ kind: 'calibration-open', trialId: 'parameter-lens-zoom-by' }).ok).toBe(false);
    expect(wire({ kind: 'calibration-open', trialVersion: 1 }).ok).toBe(false);
  });

  it('refuses text that is not json at all', () => {
    const read = readUp('not json');
    expect(read.ok).toBe(false);
    expect(read.ok === false && read.why).toBe('not json');
  });

  it('refuses a kind nothing here answers', () => {
    expect(wire({ kind: 'nonsense' }).ok).toBe(false);
    expect(wire({}).ok).toBe(false);
    expect(readUp('[]').ok).toBe(false);
    expect(readUp('null').ok).toBe(false);
  });

  it('refuses a judgment missing the parts a row is made of', () => {
    // `tags.join` in the store, and `review.room.seed` in the row it writes.
    expect(wire({ kind: 'lab-review', review: { score: 3 } }).ok).toBe(false);
    expect(wire({ kind: 'lab-review', review: { candidateId: 'a', room, score: 3 } }).ok).toBe(
      false,
    );
    expect(
      wire({ kind: 'lab-review', review: { candidateId: 'a', room, score: 3, tags: 'good' } }).ok,
    ).toBe(false);
    expect(
      wire({ kind: 'lab-review', review: { candidateId: 'a', room: {}, score: 3, tags: [] } }).ok,
    ).toBe(false);
  });

  it('takes a judgment that has all of them, note or no note', () => {
    const review = { candidateId: 'a', room, score: 4, tags: ['calm'] };
    expect(wire({ kind: 'lab-review', review }).ok).toBe(true);
    expect(wire({ kind: 'lab-review', review: { ...review, note: 'the fold reads' } }).ok).toBe(
      true,
    );
  });

  it('takes only a complete binary train decision', () => {
    const selection = { candidateId: 'a', verdict: 'up' };
    expect(wire({ kind: 'lab-select', selection }).ok).toBe(true);
    expect(wire({ kind: 'lab-select', selection: { ...selection, verdict: 'down' } }).ok).toBe(
      true,
    );
    expect(wire({ kind: 'lab-select', selection: { candidateId: 'a' } }).ok).toBe(
      false,
    );
    expect(wire({ kind: 'lab-select', selection: { ...selection, verdict: 'maybe' } }).ok).toBe(
      false,
    );
  });

  it('takes one explicit pair answer, including both and neither', () => {
    for (const choice of ['left', 'right', 'both', 'neither']) {
      expect(
        wire({ kind: 'lab-compare', comparison: { encounterId: 7, choice } }).ok,
      ).toBe(true);
    }
    expect(
      wire({ kind: 'lab-compare', comparison: { encounterId: 0, choice: 'left' } }).ok,
    ).toBe(false);
    expect(
      wire({ kind: 'lab-compare', comparison: { encounterId: 7, choice: 'better' } }).ok,
    ).toBe(false);
    expect(wire({ kind: 'lab-skip-encounter', encounterId: 7 }).ok).toBe(true);
    expect(wire({ kind: 'lab-skip-encounter', encounterId: '7' }).ok).toBe(false);
  });

  it('keeps Finals preference and show-readiness in one complete gesture', () => {
    expect(wire({ kind: 'lab-finals-open' }).ok).toBe(true);
    expect(wire({ kind: 'lab-finals-new' }).ok).toBe(true);
    const comparison = {
      encounterId: 9,
      choice: 'both',
      leftShowReady: true,
      rightShowReady: false,
    };
    expect(wire({ kind: 'lab-finals-compare', comparison }).ok).toBe(true);
    expect(
      wire({
        kind: 'lab-finals-compare',
        comparison: { ...comparison, leftShowReady: 'yes' },
      }).ok,
    ).toBe(false);
    expect(
      wire({ kind: 'lab-finals-compare', comparison: { encounterId: 9, choice: 'left' } }).ok,
    ).toBe(false);
    expect(wire({ kind: 'lab-finals-skip', encounterId: 9 }).ok).toBe(true);
  });

  it('takes only a complete absolute Archive judgment', () => {
    expect(wire({ kind: 'lab-archive-open' }).ok).toBe(true);
    expect(wire({ kind: 'lab-archive-select', candidateId: 'candidate' }).ok).toBe(true);
    for (const verdict of ['keep', 'pass', 'clear']) {
      expect(wire({
        kind: 'lab-archive-decide',
        decision: { candidateId: 'candidate', verdict, source: 'archive' },
      }).ok).toBe(true);
    }
    expect(wire({
      kind: 'lab-archive-decide',
      decision: { candidateId: 'candidate', verdict: 'keep' },
    }).ok).toBe(false);
    expect(wire({
      kind: 'lab-archive-decide',
      decision: { candidateId: 'candidate', verdict: 'favorite', source: 'search' },
    }).ok).toBe(false);
    expect(wire({
      kind: 'lab-lineage-finalist',
      decision: { candidateId: 'candidate', finalist: true },
    }).ok).toBe(true);
    expect(wire({
      kind: 'lab-lineage-finalist',
      decision: { candidateId: 'candidate', finalist: 'yes' },
    }).ok).toBe(false);
  });

  it('holds the score to the five the corpus is anchored on', () => {
    for (const score of [1, 2, 3, 4, 5]) {
      expect(wire({ kind: 'lab-rescore', reviewId: 1, score }).ok).toBe(true);
    }
    expect(wire({ kind: 'lab-rescore', reviewId: 1, score: 0 }).ok).toBe(false);
    expect(wire({ kind: 'lab-rescore', reviewId: 1, score: 6 }).ok).toBe(false);
    expect(wire({ kind: 'lab-rescore', reviewId: 1, score: '4' }).ok).toBe(false);
  });

  it('refuses a revision whose description is the wrong shape', () => {
    // `tags.map` and `note.trim()`, both bare in the store.
    expect(wire({ kind: 'lab-retag', reviewId: 1, tags: 'loud' }).ok).toBe(false);
    expect(wire({ kind: 'lab-retag', reviewId: 1, tags: [1, 2] }).ok).toBe(false);
    expect(wire({ kind: 'lab-renote', reviewId: 1, note: 42 }).ok).toBe(false);
    expect(wire({ kind: 'lab-retag', reviewId: 1, tags: ['loud'] }).ok).toBe(true);
    expect(wire({ kind: 'lab-renote', reviewId: 1, note: '' }).ok).toBe(true);
  });

  it('refuses an id that is not a scalar', () => {
    expect(wire({ kind: 'lab-skip', candidateId: { a: 1 } }).ok).toBe(false);
    expect(wire({ kind: 'lab-skip', candidateId: 7 }).ok).toBe(false);
    expect(wire({ kind: 'lab-candidate', candidateId: [] }).ok).toBe(false);
    expect(wire({ kind: 'lab-log', before: 'yesterday' }).ok).toBe(false);
    expect(wire({ kind: 'lab-log' }).ok).toBe(true);
  });

  it('takes a flow id that names a prototype member, because the handler decides', () => {
    // A string is a string. `constructor` is refused where it is looked up, with
    // `Object.hasOwn`, rather than here — a valid id can be anything.
    expect(wire({ kind: 'lab-offer', flowId: 'constructor' }).ok).toBe(true);
    expect(wire({ kind: 'lab-offer', flowId: 3 }).ok).toBe(false);
  });

  it('asks only that a scheme be an object, and leaves the rest to merge', () => {
    // Checking the graph twice, in two vocabularies, is how the two drift.
    expect(wire({ kind: 'scheme', scheme: { colorways: {} } }).ok).toBe(true);
    expect(wire({ kind: 'scheme', scheme: 'main' }).ok).toBe(false);
    expect(wire({ kind: 'scheme' }).ok).toBe(false);
  });

  it('hands back the message that arrived, not a rebuilt one', () => {
    // Validation only. A schema that stripped what it does not name would strip
    // a node's `values`, and the flow would come back with its knobs at zero.
    const sent = { kind: 'scheme', scheme: { flows: { mine: { name: 'Mine' } } } };
    const read = wire(sent);
    expect(read.ok === true && read.up).toEqual(sent);
  });
});
