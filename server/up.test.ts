import { describe, expect, it } from 'vitest';
import { readUp } from './up.ts';

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

describe('reading a message off the socket', () => {
  it('takes every gesture that carries nothing', () => {
    for (const kind of ['downbeat', 'next-flow', 'next-colorway', 'lab-open', 'save-scheme']) {
      expect(wire({ kind }).ok).toBe(true);
    }
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
