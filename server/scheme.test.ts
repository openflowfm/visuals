import { describe, expect, it } from 'vitest';
import { hint } from '../hints.ts';
import { NODE_FAMILIES } from '../protocol.ts';
import { compileLook, reachesOut, repaired } from '../src/render/circuit.ts';
import { BUILT_IN, merge } from './scheme.ts';

/**
 * The name hints, against the names of a real set.
 *
 * These exist because a mis-routed track does not look like a bad regular
 * expression — it looks like a rendering bug. A pad drawing as a strobe is one
 * wrong thing among twenty-six right ones, on screen, at a gig, and nothing
 * about it points back at a missing `\b`.
 *
 * The names below are taken from an actual set rather than invented, which is
 * the whole point: the failures were all in names nobody would think to make up.
 *
 * They survived the cascade because what they were always good at is the thing
 * that is left: guessing what an instrument looks like from what it is called.
 * That is now one node's `by name` mode, and it is what a `tracks` node draws
 * before anyone has wired anything else.
 */
const baseFor = (name: string) => hint(name);

describe('name hints', () => {
  it('does not match a word inside a longer one', () => {
    // The bug this file was written for. "beat" is inside "Beating", so without
    // a word boundary a pad track drew as a drum — and it was the drum hint
    // that won, because it is first.
    expect(baseFor('Beating Pad')).toBe('noise');
    expect(baseFor('Subtle Keys')).toBe('grid');
  });

  it('is strict in both directions, which is the price of the fix', () => {
    // The same boundary that saves "Beating Pad" means "Padded" is not a pad
    // and "Drumming" is not a drum. They fall through to the neutral picture
    // instead, which is the safe half of being wrong: an unremarkable track
    // rather than a confidently misrouted one.
    expect(baseFor('Padded Cell')).toBe('plasma');
    expect(baseFor('Drumming')).toBe('plasma');
  });

  it('reads an arp as a sequence rather than a chord', () => {
    // Four of these in one set, and the arp rule is tested before the keys one
    // so `Pluck Arp` is a sequence rather than a pluck. What matters is that all
    // four agree and that none of them lands on the keys picture — scattered,
    // they read as four unrelated things when they are one family.
    const drawn = ['Space Arp', 'Retro Arp', 'Pluck Arp', '13-Felixian Pluck Arp'].map(baseFor);
    expect(new Set(drawn).size).toBe(1);
    expect(drawn[0]).not.toBe(baseFor('Keys'));
  });

  it('routes the ordinary instrument names', () => {
    expect(baseFor('Drums')).toBe('strobe');
    expect(baseFor('Bass')).toBe('bars');
    expect(baseFor('Sub Bass')).toBe('bars');
    expect(baseFor('303 EXT')).toBe('bars');
    expect(baseFor('Guitar')).toBe('rings');
    expect(baseFor('Vox')).toBe('rings');
    expect(baseFor('Sparkle Pad')).toBe('noise');
    expect(baseFor('Texture')).toBe('noise');
  });

  it('gives a name that says nothing something to draw anyway', () => {
    // Never null. A track nobody named usefully still has to draw, or a set
    // where half the names are "MIDI" is a set that is half black — and that is
    // the state every set is in on its first evening.
    for (const name of ['MIDI', 'Uppers', 'Downers', 'Song', 'Sample', '29-Kontakt 8']) {
      expect(hint(name), name).toBe('plasma');
    }
  });

  it('is case-insensitive, because nobody is consistent', () => {
    expect(baseFor('DRUMS')).toBe('strobe');
    expect(baseFor('drum bus')).toBe('strobe');
  });
});

describe('the built-in scheme', () => {
  it('is a show on its own, with nothing configured', () => {
    // The rule the file is designed around. A rig that draws nothing until it
    // has been configured is a rig nobody configures.
    expect(Object.keys(BUILT_IN.looks).length).toBeGreaterThan(1);
    expect(Object.keys(BUILT_IN.colorways).length).toBeGreaterThan(1);
    expect(BUILT_IN.looks[BUILT_IN.defaults.look]).toBeDefined();
    expect(BUILT_IN.colorways[BUILT_IN.defaults.colorway]).toBeDefined();
  });

  it('turns through everything, because nothing is narrowed', () => {
    expect(BUILT_IN.rotation.looks).toEqual([]);
    expect(BUILT_IN.rotation.colorways).toEqual([]);
    expect(BUILT_IN.rotation.bars).toBeGreaterThan(0);
  });

  it('every look it ships compiles', () => {
    // The library is the only documentation of the vocabulary anyone will read,
    // so one of them failing to build is four-quarters of the manual gone.
    for (const [id, def] of Object.entries(BUILT_IN.looks)) {
      const built = compileLook(BUILT_IN.looks, id);
      expect(built.error, `${def.name}: ${built.error}`).toBeNull();
      expect(built.source).toContain('void main()');
    }
  });

  it('ships nothing that draws nothing', () => {
    // A shipped look with a node parked off to one side is fine; a shipped look
    // with nothing wired to `out` is a black frame with a library entry's name
    // on it, and it is the first thing anyone opens.
    for (const [id, def] of Object.entries(BUILT_IN.looks)) {
      expect(reachesOut(def.circuit), def.name).toBe(true);
      expect(repaired(def.circuit), `${id} needs no repair`).toEqual(def.circuit);
    }
  });

  it('uses every family in the vocabulary between the four of them', () => {
    // The library is the only documentation of the vocabulary anyone actually
    // reads, so a library that only demonstrates pictures and blends leaves the
    // half that makes this model unusual — geometry, and numbers becoming
    // colours — invisible to everyone who learns it by taking these apart.
    const kinds = new Set(
      Object.values(BUILT_IN.looks).flatMap((def) => def.circuit.nodes.map((node) => node.kind)),
    );
    for (const family of NODE_FAMILIES) {
      expect(family.kinds.some((kind) => kinds.has(kind)), family.name).toBe(true);
    }
  });

  it('ships a look that reads the set, and one that does not', () => {
    // Both halves have to exist in the library or half the vocabulary is
    // invisible to anyone who learns it by taking these apart.
    const reads = Object.values(BUILT_IN.looks).filter((def) =>
      def.circuit.nodes.some((n) => n.kind === 'tracks'),
    );
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.length).toBeLessThan(Object.keys(BUILT_IN.looks).length);
  });
});

describe('reading a file', () => {
  it('overrides one colourway without deleting the rest', () => {
    const merged = merge({ colorways: { mine: ['#123456'] } });
    expect(merged.colorways.mine).toEqual(['#123456']);
    expect(Object.keys(merged.colorways).length).toBeGreaterThan(1);
  });

  it('keeps the looks that ship alongside one the file adds', () => {
    const merged = merge({
      looks: { mine: { name: 'Mine', circuit: { nodes: [], cords: [] } } },
    });
    expect(merged.looks.mine).toBeDefined();
    expect(Object.keys(merged.looks).length).toBeGreaterThan(1);
  });

  it('reads a song written as a bare colourway name', () => {
    // A song's whole entry used to be its colourway's name, and a file out
    // there still says so. Refusing it would unstyle every song in it.
    expect(merge({ songs: { one: 'ember' } as never }).songs.one).toEqual({ colorway: 'ember' });
  });

  it('remembers what a rolled show was rolled from', () => {
    expect(merge({ seed: 'oak-ember-12' }).seed).toBe('oak-ember-12');
    expect(merge({}).seed).toBeUndefined();
  });
});

describe('a file written when the cascade existed', () => {
  /** Most of a real scheme.json from before the collapse. */
  const old = {
    colorways: { rust: ['#aa4422'] },
    songs: { sandstorm: { colorway: 'rust', bias: 0.2 } },
    archetypes: { CHORUS: { energy: 0.9, looks: ['kaleido'] } },
    layers: { Drums: { looks: ['strobe'], blend: 'add', bias: 0.1 } },
    clips: { 'quiet one': { bias: -0.3 } },
    looks: {
      strobe: { name: 'Strobe', builtin: 'strobe' },
      mine: {
        name: 'Mine',
        circuit: {
          nodes: [
            { id: 'p', kind: 'point', x: 0, y: 0 },
            { id: 's', kind: 'sample', x: 1, y: 0 },
            { id: 'e', kind: 'signal', op: 'energy', x: 2, y: 0 },
            { id: 'o', kind: 'out', x: 3, y: 0 },
          ],
          cords: [
            { from: 'p/p', to: 's/p' },
            { from: 's/c', to: 'o/c' },
          ],
        },
      },
    },
    defaults: { colorway: 'rust', energy: 0.4, blend: ['over'], looks: ['bars'], maxLooks: 3, pace: 1 },
  };

  it('keeps what a person made and drops what the cascade decided', () => {
    // Inventing a graph out of a layer binding would produce something nobody
    // wrote and nobody wants to debug, so the bindings go. The colourways, the
    // song assignments and any look that was a graph are work, so they stay.
    const merged = merge(old as never);
    expect(merged.colorways.rust).toEqual(['#aa4422']);
    expect(merged.songs.sandstorm).toEqual({ colorway: 'rust' });
    expect(merged.looks.mine).toBeDefined();
    expect((merged as unknown as Record<string, unknown>).layers).toBeUndefined();
    expect((merged as unknown as Record<string, unknown>).archetypes).toBeUndefined();
  });

  it('does not carry a look that was only a built-in', () => {
    // A built-in is a node mode now. A library full of twenty-three entries
    // that are one node each is worse than an empty one.
    expect(merge(old as never).looks.strobe).toBeUndefined();
  });

  it('rewords a graph written against the old vocabulary', () => {
    // `sample` meant "the frame that arrived", which was the layer underneath in
    // a stack. The nearest thing to that now is the set's own picture.
    const kept = merge(old as never).looks.mine.circuit;
    expect(kept.nodes.find((n) => n.id === 's')?.kind).toBe('tracks');
    expect(kept.nodes.find((n) => n.id === 's')?.op).toBe('by name');
    // `energy` and `amount` were signal modes and are not any more.
    expect(kept.nodes.find((n) => n.id === 'e')?.op).toBe('level');
    // And `signal` itself is `playback` — the same node, next to a `song` node
    // that was also, unhelpfully, a signal.
    expect(kept.nodes.find((n) => n.id === 'e')?.kind).toBe('playback');
  });

  it('folds an energy node into the track it was following', () => {
    // It was `track` with an envelope on it: same signature, same bank, named
    // the same way. A file full of them has to keep breathing, so an unstated
    // fall is written down at the value it used to mean rather than inheriting
    // the merged node's zero.
    const merged = merge({
      looks: {
        mine: {
          name: 'Mine',
          circuit: {
            nodes: [
              { id: 'e', kind: 'energy', op: 'Bass', x: 0, y: 0 },
              { id: 'p', kind: 'paint', x: 1, y: 0 },
              { id: 'o', kind: 'out', x: 2, y: 0 },
            ],
            cords: [
              { from: 'e/n', to: 'p/amount' },
              { from: 'p/c', to: 'o/c' },
            ],
          },
        },
      },
    } as never).looks.mine.circuit;
    const node = merged.nodes.find((n) => n.id === 'e');
    expect(node?.kind).toBe('track');
    expect(node?.of).toBe('Bass');
    expect(node?.op).toBe('level');
    expect(node?.value).toBe(0.4);
    // Its outlet was already `n`, so the cord is untouched.
    expect(merged.cords).toContainEqual({ from: 'e/n', to: 'p/amount' });
  });

  it('splits effect three ways without moving a single cord', () => {
    // `effect` was one name over three things — six modes that moved the point,
    // two that changed the colour where it was, four that read their input many
    // times. The split could be done to libraries people already have precisely
    // because all twelve kept their `c` inlet and their `c` outlet: only the
    // kind changes, and a cord names ports rather than kinds.
    const kept = merge({
      looks: {
        mine: {
          name: 'Mine',
          circuit: {
            nodes: [
              { id: 'g', kind: 'source', op: 'plasma', x: 0, y: 0 },
              { id: 'k', kind: 'effect', op: 'kaleido', x: 1, y: 0 },
              { id: 'b', kind: 'effect', op: 'bloom', x: 2, y: 0 },
              { id: 'p', kind: 'effect', op: 'posterize', x: 3, y: 0, knobs: { levels: 0.8 } },
              { id: 's', kind: 'effect', op: 'shift', x: 4, y: 0, knobs: { spread: 0.4 } },
              { id: 'o', kind: 'out', x: 5, y: 0 },
            ],
            cords: [
              { from: 'g/c', to: 'k/c' },
              { from: 'k/c', to: 'b/c' },
              { from: 'b/c', to: 'p/c' },
              { from: 'p/c', to: 's/c' },
              { from: 's/c', to: 'o/c' },
            ],
          },
        },
      },
    } as never).looks.mine.circuit;
    const kindOf = (id: string) => kept.nodes.find((n) => n.id === id)?.kind;
    expect(kindOf('k')).toBe('lens');
    expect(kindOf('b')).toBe('spread');
    expect(kindOf('p')).toBe('grade');
    expect(kindOf('s')).toBe('spread');
    expect(kept.cords).toHaveLength(5);
    // Two of them collided with a name beside them once the families existed:
    // posterize's `levels` with the mode next to it, shift's `spread` with the
    // kind it landed in. A number that kept a stale name would be trimmed away by
    // `repaired` and the look would quietly revert to a default. The file spells
    // the map `knobs`, as a file of that vintage would, so this covers the
    // rename and the split arriving together.
    expect(kept.nodes.find((n) => n.id === 'p')?.values).toEqual({ steps: 0.8 });
    expect(kept.nodes.find((n) => n.id === 's')?.values).toEqual({ split: 0.4 });
  });

  it('reads the numbers on a node whichever of the two names the file uses', () => {
    // `knobs` is what `values` was called. A file written before the word went
    // is every file anybody already has, and a number that failed to come
    // across is not a parse error — it is a look that opens with its inlets
    // quietly back at their defaults, on the night it mattered.
    const kept = merge({
      looks: {
        mine: {
          name: 'Mine',
          circuit: {
            nodes: [
              { id: 'g', kind: 'source', op: 'plasma', x: 0, y: 0 },
              {
                id: 'r',
                kind: 'lens',
                op: 'ripple',
                x: 1,
                y: 0,
                knobs: { waves: 0.72, depth: 0.4 },
              },
              { id: 'o', kind: 'out', x: 2, y: 0 },
            ],
            cords: [
              { from: 'g/c', to: 'r/c' },
              { from: 'r/c', to: 'o/c' },
            ],
          },
        },
      },
    } as never).looks.mine.circuit;
    const ripple = kept.nodes.find((n) => n.id === 'r');
    expect(ripple?.values).toEqual({ waves: 0.72, depth: 0.4 });
    // And the old spelling is gone rather than sitting beside the new one:
    // `scheme.json` is read and diffed by hand, and two names for one map in it
    // is a question nobody should have to answer.
    expect((ripple as { knobs?: unknown }).knobs).toBeUndefined();
  });

  it('makes the five geometry kinds modes of the lens they always were', () => {
    const kept = merge({
      looks: {
        mine: {
          name: 'Mine',
          circuit: {
            nodes: [
              { id: 'pt', kind: 'point', x: 0, y: 0 },
              { id: 'f', kind: 'fold', x: 1, y: 0, knobs: { sides: 0.4 } },
              { id: 'g', kind: 'source', op: 'rings', x: 2, y: 0 },
              { id: 'h', kind: 'hue', x: 3, y: 0, knobs: { shift: 0.7 } },
              { id: 'o', kind: 'out', x: 4, y: 0 },
            ],
            cords: [
              { from: 'pt/p', to: 'f/p' },
              { from: 'f/p', to: 'g/p' },
              { from: 'g/c', to: 'h/c' },
              { from: 'h/c', to: 'o/c' },
            ],
          },
        },
      },
    } as never).looks.mine.circuit;
    const fold = kept.nodes.find((n) => n.id === 'f');
    expect(fold?.kind).toBe('lens');
    expect(fold?.op).toBe('fold');
    expect(fold?.values).toEqual({ sides: 0.4 });
    expect(kept.nodes.find((n) => n.id === 'h')?.kind).toBe('grade');
    // `p` in and `p` out on the lens, `c` on the grade — every port kept its
    // name, so every cord survived.
    expect(kept.cords).toHaveLength(4);
  });

  it('moves a track name off op, and its cords off level', () => {
    // The node has to say which track *and* which of its numbers now, so the
    // name moves to `of` and `op` becomes the reading. The outlet goes with it:
    // `level` was the only number outlet in the vocabulary not called `n`, and
    // a cord addressed to a port that is not there is one `repaired` deletes.
    const merged = merge({
      looks: {
        mine: {
          name: 'Mine',
          circuit: {
            nodes: [
              { id: 't', kind: 'track', op: 'Drums', x: 0, y: 0 },
              { id: 'p', kind: 'paint', x: 1, y: 0 },
              { id: 'o', kind: 'out', x: 2, y: 0 },
            ],
            cords: [
              { from: 't/level', to: 'p/amount' },
              { from: 'p/c', to: 'o/c' },
            ],
          },
        },
      },
    } as never).looks.mine.circuit;
    const node = merged.nodes.find((n) => n.id === 't');
    expect(node?.of).toBe('Drums');
    expect(node?.op).toBe('level');
    expect(merged.cords).toContainEqual({ from: 't/n', to: 'p/amount' });
  });

  it('carries the pace across and forgets the rest of the defaults', () => {
    const merged = merge(old as never);
    expect(merged.defaults.pace).toBe(1);
    expect(merged.defaults.colorway).toBe('rust');
    expect(merged.looks[merged.defaults.look]).toBeDefined();
  });

  it('leaves a file already written in the new spelling alone', () => {
    const circuit = {
      nodes: [
        { id: 'g', kind: 'source' as const, op: 'spiral', x: 0, y: 0 },
        { id: 'o', kind: 'out' as const, x: 200, y: 0 },
      ],
      cords: [{ from: 'g/c', to: 'o/c' }],
    };
    const now = merge({
      looks: { mine: { name: 'Mine', circuit } },
      rotation: { looks: ['mine'], colorways: [], bars: 16, onClip: false, colorEvery: 32 },
    });
    expect(now.rotation.bars).toBe(16);
    expect(now.rotation.looks).toEqual(['mine']);
    expect(now.looks.mine.circuit).toEqual(circuit);
  });

  it('gives a look somewhere to leave from, whatever the file says', () => {
    // This is the one door: a scheme reaches the renderer off disk or off the
    // wire and both come through `merge`. A look with no `out` is a compile
    // error and a black wall, and the message is about a file nobody has open —
    // so it is repaired here, once, and written back that way.
    const now = merge({
      looks: {
        empty: { name: 'Empty', circuit: { nodes: [], cords: [] } },
        two: {
          name: 'Two',
          circuit: {
            nodes: [
              { id: 'g', kind: 'source' as const, op: 'grid', x: 0, y: 0 },
              { id: 'a', kind: 'out' as const, x: 200, y: 0 },
              { id: 'b', kind: 'out' as const, x: 200, y: 200 },
            ],
            cords: [{ from: 'g/c', to: 'b/c' }],
          },
        },
      },
    });
    for (const id of ['empty', 'two']) {
      const ends = now.looks[id].circuit.nodes.filter((node) => node.kind === 'out');
      expect(ends, id).toHaveLength(1);
      expect(compileLook(now.looks, id).error, id).toBeNull();
    }
    // The one that was drawing survives, not the one that was written first.
    expect(now.looks.two.circuit.nodes.filter((n) => n.kind === 'out')[0].id).toBe('b');
  });
});
