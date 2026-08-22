import { describe, expect, it } from 'vitest';
import type { Circuit, LookDef } from '../../protocol.ts';
import { wouldLoop } from '../../protocol.ts';
import {
  bareCircuit,
  compileCircuit,
  compileLook,
  flatten,
  inletsOf,
  valuesOf,
  MAX_VALUES,
  reachesOut,
  repaired,
  signalOf,
  starterCircuit,
  tracksOf,
  wouldFeedItself,
} from './circuit.ts';
import { paramsOf } from './look.ts';

/**
 * The compiler.
 *
 * A shader that fails to compile is a black screen with a driver message behind
 * it, so the interesting cases are all the ones where a half-finished graph
 * still has to produce something drawable. Building one of these means dropping
 * a node and looking at it — a compiler that treated an unfinished graph as an
 * error would make the canvas unusable for exactly the way it gets used.
 *
 * The other half is the thing that replaced the layer stack: **a colour is a
 * function of a point**. Most of what is asserted below is that composing at a
 * moved point actually composes, because that is what makes a graph able to say
 * everything a stack of full-screen passes used to.
 */

const wire = (nodes: Circuit['nodes'], cords: Circuit['cords']): Circuit => ({ nodes, cords });

/** Just `main`, so an assertion about what runs isn't fooled by a declaration. */
const bodyOf = (source: string) => source.slice(source.indexOf('void main()'));

describe('compiling a look', () => {
  it('compiles what a new look starts as', () => {
    const built = compileCircuit(starterCircuit());
    expect(built.error).toBeNull();
    expect(bodyOf(built.source!)).toContain('fragColor =');
  });

  it('starts a new look with the set already in it', () => {
    // A claim about what this rig is for: the picture should be reacting to
    // whoever is playing before anyone has decided anything, so taking the
    // tracks node out is a deliberate act rather than the default state.
    expect(compileCircuit(starterCircuit()).draws).toBe('by name');
    expect(compileCircuit(bareCircuit()).draws).toBe('by name');
  });

  it('gives a new look one number of its own, already named', () => {
    const values = valuesOf(starterCircuit());
    expect(values).toHaveLength(1);
    expect(values[0]).toMatchObject({ label: 'wash', index: 0 });
  });

  it('draws nothing rather than failing when nothing is wired to out', () => {
    // Not an error. A canvas with one node on it should compile and show black
    // rather than refuse — that is the state every graph passes through.
    const built = compileCircuit(wire([{ id: 'o', kind: 'out', x: 0, y: 0 }], []));
    expect(built.error).toBeNull();
    expect(bodyOf(built.source!)).toContain('vec4(0.0)');
  });

  it('refuses a graph with no out at all', () => {
    const built = compileCircuit(wire([{ id: 'p', kind: 'point', x: 0, y: 0 }], []));
    expect(built.source).toBeNull();
    expect(built.error).toMatch(/out/);
  });

  it('falls back on an unconnected inlet rather than refusing', () => {
    const built = compileCircuit(
      wire(
        [
          { id: 'f', kind: 'lens', op: 'fold', x: 0, y: 0 },
          { id: 'g', kind: 'source', op: 'plasma', x: 1, y: 0 },
          { id: 'o', kind: 'out', x: 2, y: 0 },
        ],
        [
          { from: 'f/p', to: 'g/p' },
          { from: 'g/c', to: 'o/c' },
        ],
      ),
    );
    expect(built.error).toBeNull();
    expect(bodyOf(built.source!)).toContain('gen_plasma(');
  });

  it('refuses a cycle by name rather than hanging in one', () => {
    const built = compileCircuit(
      wire(
        [
          { id: 'a', kind: 'grade', op: 'hue', x: 0, y: 0 },
          { id: 'o', kind: 'out', x: 1, y: 0 },
        ],
        [
          { from: 'a/c', to: 'a/c' },
          { from: 'a/c', to: 'o/c' },
        ],
      ),
    );
    expect(built.source).toBeNull();
    expect(built.error).toMatch(/loop|feeds itself/);
  });

  it('refuses a cycle that goes round through an effect that moves the point', () => {
    // From the front of house this was not an error message, it was the page
    // stopping: the guard was keyed by the node *and the point*, and a loop with
    // a kaleidoscope in it arrives at a different point every trip round, so
    // nothing ever matched and it descended until the stack gave out.
    const built = compileCircuit(
      wire(
        [
          { id: 'k', kind: 'lens', op: 'kaleido', x: 0, y: 0 },
          { id: 'b', kind: 'blend', op: 'screen', x: 1, y: 0 },
          { id: 'o', kind: 'out', x: 2, y: 0 },
        ],
        [
          { from: 'k/c', to: 'b/base' },
          { from: 'b/c', to: 'k/c' },
          { from: 'b/c', to: 'o/c' },
        ],
      ),
    );
    expect(built.source).toBeNull();
    expect(built.error).toMatch(/feeds itself/);
  });

  it('refuses a cord that would close a loop, before it is dropped', () => {
    const circuit = wire(
      [
        { id: 'a', kind: 'grade', op: 'hue', x: 0, y: 0 },
        { id: 'b', kind: 'grade', op: 'levels', x: 1, y: 0 },
      ],
      [{ from: 'a/c', to: 'b/c' }],
    );
    expect(wouldFeedItself(circuit, 'b/c', 'a/c')).toBe(true);
    expect(wouldFeedItself(circuit, 'a/c', 'a/c')).toBe(true);
    expect(wouldFeedItself(circuit, 'b/c', 'b/gain')).toBe(true);
    // Two nodes side by side are not a loop however many cords join them.
    expect(wouldFeedItself(circuit, 'a/c', 'b/gain')).toBe(false);
  });

  it('says when nothing reaches out, without refusing to draw', () => {
    // Black is the honest answer and always was. What was missing is that a
    // canvas full of nodes drawing black looks exactly like a canvas full of
    // nodes that is broken, and the difference is one cord nobody can see.
    const stranded = wire(
      [
        { id: 'g', kind: 'source', op: 'plasma', x: 0, y: 0 },
        { id: 'o', kind: 'out', x: 1, y: 0 },
      ],
      [],
    );
    expect(reachesOut(stranded)).toBe(false);
    expect(compileCircuit(stranded).error).toBeNull();
    expect(reachesOut(starterCircuit())).toBe(true);
  });

  it('gives a mode nobody has heard of the values it will be compiled with', () => {
    // The inlets took `op` at its word and the emit fell back to the first
    // mode, so one out of a hand-edited file drew a faceplate with no values on
    // it and a shader whose values were all zero — a lens folded hard left with
    // nothing on the canvas to say why.
    const node = { id: 'e', kind: 'lens' as const, op: 'lasers', x: 0, y: 0 };
    expect(inletsOf(node).map((port) => port.name)).toEqual(['p', 'c', 'by']);
  });

  it('is a number, so it will not go into a point', () => {
    // The canvas refuses by type rather than inventing a conversion, and a
    // meter is exactly the thing someone will try to drop onto a position.
    const circuit = wire([{ id: 't', kind: 'track', of: 'Bass', x: 0, y: 0 }], []);
    expect(signalOf(circuit, 't/n')).toBe('n');
  });

  it('banks the tracks a look names, positionally', () => {
    // Positional rather than keyed by name, so two nodes naming one track keep a
    // slot each — deduplicating them would make deleting one silently change
    // what the other read.
    const circuit = wire(
      [
        { id: 't1', kind: 'track', of: 'Bass', x: 0, y: 0 },
        { id: 't2', kind: 'track', of: 'Bass', x: 0, y: 1 },
      ],
      [],
    );
    expect(tracksOf(circuit).map((each) => each.index)).toEqual([0, 1]);
  });

  it('banks a reading and a smoothing, not just a name', () => {
    // One bank rather than two, which is what merging `energy` into `track`
    // bought: the CPU fills each slot with whatever that node asked for, and
    // the shader reads a number without learning which. Two banks meant a look
    // could name eight tracks *and* eight energies, and a shader declaring
    // sixteen floats to hold what is almost always two.
    const circuit = wire(
      [
        { id: 't1', kind: 'track', of: 'Bass', op: 'fader', x: 0, y: 0 },
        { id: 't2', kind: 'track', of: 'Drums', x: 0, y: 1, smooth: 0.6 },
      ],
      [],
    );
    expect(tracksOf(circuit)).toEqual([
      { id: 't1', name: 'Bass', read: 'fader', index: 0, smooth: 0 },
      // Nothing said is the number itself, so a `track` that never asked for an
      // envelope behaves exactly as it did before there was one to ask for.
      { id: 't2', name: 'Drums', read: 'level', index: 1, smooth: 0.6 },
    ]);
  });
});

describe('a lens has two outlets and they are not the same node twice', () => {
  it('is the geometry node from its point and the effect from its colour', () => {
    // The claim the merge rests on. `fold` and `kaleido` were two kinds under
    // two prefixes in two files and are one wedge fold; which of them you get
    // is which outlet you take, and the graph says so rather than the browser.
    const asPoint = compileCircuit(
      wire(
        [
          { id: 'pt', kind: 'point', x: 0, y: 0 },
          { id: 'l', kind: 'lens', op: 'fold', x: 1, y: 0 },
          { id: 'g', kind: 'source', op: 'plasma', x: 2, y: 0 },
          { id: 'o', kind: 'out', x: 3, y: 0 },
        ],
        [
          { from: 'pt/p', to: 'l/p' },
          { from: 'l/p', to: 'g/p' },
          { from: 'g/c', to: 'o/c' },
        ],
      ),
    );
    // A plasma read at a folded point: the fold lands in a variable and the
    // picture is read there.
    const folded = /vec2 (v\d+) = cFold\(/.exec(bodyOf(asPoint.source!))?.[1];
    expect(folded).toBeTruthy();
    expect(bodyOf(asPoint.source!)).toContain(`gen_plasma(${folded}`);

    const asEffect = compileCircuit(
      wire(
        [
          { id: 'g', kind: 'source', op: 'plasma', x: 0, y: 0 },
          { id: 'l', kind: 'lens', op: 'fold', x: 1, y: 0 },
          { id: 'o', kind: 'out', x: 2, y: 0 },
        ],
        [
          { from: 'g/c', to: 'l/c' },
          { from: 'l/c', to: 'o/c' },
        ],
      ),
    );
    // The same fold and the same GLSL, inline this time because the colour
    // outlet asks its input for a point rather than handing one on. Nothing is
    // wired to the lens's own `p`, so the point it moves is the one it was
    // asked about — which is exactly what the effect it replaced did.
    expect(bodyOf(asEffect.source!)).toContain('gen_plasma(cFold(centred()');
    // And nothing dead: the point outlet nobody took is not declared.
    expect(bodyOf(asEffect.source!)).not.toMatch(/vec2 v\d+ = cFold/);
  });

  it('lets a lens feed a picture that feeds the lens back', () => {
    // The graph a node-wide loop guard refused and a person would draw without
    // thinking: the point goes out to a source, the source comes back as the
    // colour. It terminates, because the point never looked at the colour —
    // which is exactly what `reads` on the spec says and what the compiler's
    // guard is keyed by now.
    const circuit = wire(
      [
        { id: 'l', kind: 'lens', op: 'swirl', x: 0, y: 0 },
        { id: 'g', kind: 'source', op: 'rings', x: 1, y: 0 },
        { id: 'o', kind: 'out', x: 2, y: 0 },
      ],
      [
        { from: 'l/p', to: 'g/p' },
        { from: 'g/c', to: 'l/c' },
        { from: 'l/c', to: 'o/c' },
      ],
    );
    expect(wouldFeedItself(circuit, 'g/c', 'l/c')).toBe(false);
    const built = compileCircuit(circuit);
    expect(built.error).toBeNull();
    expect(built.source).toBeTruthy();
  });

  it('still refuses a colour that comes back round to itself', () => {
    const circuit = wire(
      [
        { id: 'l', kind: 'lens', op: 'swirl', x: 0, y: 0 },
        { id: 'gr', kind: 'grade', op: 'hue', x: 1, y: 0 },
        { id: 'o', kind: 'out', x: 2, y: 0 },
      ],
      [
        { from: 'l/c', to: 'gr/c' },
        { from: 'gr/c', to: 'o/c' },
      ],
    );
    expect(wouldFeedItself(circuit, 'gr/c', 'l/c')).toBe(true);
  });
});

describe('a place is two numbers made into a point', () => {
  /** A picture read wherever the place says, which is the whole of the node. */
  const placed = (nodes: Circuit['nodes'] = [], cords: Circuit['cords'] = []): Circuit =>
    wire(
      [
        { id: 'pl', kind: 'place', x: 0, y: 0 },
        { id: 'g', kind: 'source', op: 'plasma', x: 1, y: 0 },
        { id: 'o', kind: 'out', x: 2, y: 0 },
        ...nodes,
      ],
      [{ from: 'pl/p', to: 'g/p' }, { from: 'g/c', to: 'o/c' }, ...cords],
    );

  it('makes a point out of two numbers and hands it downstream', () => {
    const built = compileCircuit(placed());
    expect(built.error).toBeNull();
    const at = /vec2 (v\d+) = recentred\(/.exec(bodyOf(built.source!))?.[1];
    expect(at).toBeTruthy();
    expect(bodyOf(built.source!)).toContain(`gen_plasma(${at}`);
  });

  it('sits in the middle with nothing wired and nothing set', () => {
    // The one default that has to be obvious: an untouched place is the centre,
    // so dropping one changes nothing until you turn it. A half in each is the
    // middle of the frame because `recentred` takes 0–1 across the picture.
    expect(bodyOf(compileCircuit(placed()).source!)).toContain('recentred(vec2(0.5, 0.5))');
  });

  it('spans the frame rather than a square of it', () => {
    // Through `recentred`, which is aspect-corrected, so a full `x` is the
    // frame's own edge on any window. A hand-written `(n - 0.5) * 2.0` would
    // land short of it on a wide one and past it on a tall one.
    expect(compileCircuit(placed()).source).toContain('vec2 recentred(vec2 uv)');
  });

  it('is a point a pair of moving numbers can name', () => {
    // The thing nothing could say before: a graph could take a point apart and
    // never put one together, so two waves — or two meters — had nowhere to go.
    const built = compileCircuit(
      placed(
        [
          { id: 'b', kind: 'playback', op: 'beat', x: 0, y: 1 },
          { id: 'wx', kind: 'wave', op: 'sine', x: 0, y: 2 },
          { id: 'wy', kind: 'wave', op: 'saw', x: 0, y: 3 },
        ],
        [
          { from: 'b/n', to: 'wx/phase' },
          { from: 'b/n', to: 'wy/phase' },
          { from: 'wx/n', to: 'pl/x' },
          { from: 'wy/n', to: 'pl/y' },
        ],
      ),
    );
    expect(built.error).toBeNull();
    expect(bodyOf(built.source!)).toMatch(/recentred\(vec2\(v\d+, v\d+\)\)/);
  });

  it('holds a number on each inlet, riding the bank like every other', () => {
    const built = compileCircuit(placed([], []));
    expect(built.values).toHaveLength(0);
    const set = compileCircuit(
      wire(
        [
          { id: 'pl', kind: 'place', x: 0, y: 0, values: { x: 0.2, y: 0.9 } },
          { id: 'g', kind: 'source', op: 'plasma', x: 1, y: 0 },
          { id: 'o', kind: 'out', x: 2, y: 0 },
        ],
        [
          { from: 'pl/p', to: 'g/p' },
          { from: 'g/c', to: 'o/c' },
        ],
      ),
    );
    expect(set.values.map((each) => each.id)).toEqual(['pl/x', 'pl/y']);
    // Never written into the source, or every turn of it would recompile.
    expect(bodyOf(set.source!)).toContain('recentred(vec2(uParams[0], uParams[1]))');
  });

  it('goes round to a number and back through polar', () => {
    // The two directions between a point and a pair of numbers, in one graph:
    // there is nothing clever about it, but a vocabulary where only one of them
    // exists is one where half the graphs you reach for cannot be drawn.
    const built = compileCircuit(
      wire(
        [
          { id: 'pl', kind: 'place', x: 0, y: 0 },
          { id: 'po', kind: 'polar', x: 1, y: 0 },
          { id: 'pa', kind: 'paint', x: 2, y: 0 },
          { id: 'o', kind: 'out', x: 3, y: 0 },
        ],
        [
          { from: 'pl/p', to: 'po/p' },
          { from: 'po/radius', to: 'pa/amount' },
          { from: 'pa/c', to: 'o/c' },
        ],
      ),
    );
    expect(built.error).toBeNull();
    const at = /vec2 (v\d+) = recentred\(vec2\(0\.5, 0\.5\)\);/.exec(bodyOf(built.source!))?.[1];
    expect(at).toBeTruthy();
    expect(bodyOf(built.source!)).toContain(`length(${at})`);
  });
});

describe('an inlet holds a number of its own', () => {
  /** The size the shader declared its bank at, which is what the CPU must match. */
  const bankOf = (source: string) => Number(/uniform float uParams\[(\d+)\]/.exec(source)?.[1]);

  const posterize = (values?: Record<string, number>, cords: Circuit['cords'] = []): Circuit =>
    wire(
      [
        { id: 'g', kind: 'source', op: 'plasma', x: 0, y: 0 },
        { id: 'k', kind: 'value', x: 0, y: 1, value: 0.25, label: 'dial' },
        { id: 'e', kind: 'grade', op: 'posterize', x: 1, y: 0, ...(values ? { values } : {}) },
        { id: 'o', kind: 'out', x: 2, y: 0 },
      ],
      [{ from: 'g/c', to: 'e/c' }, { from: 'e/c', to: 'o/c' }, ...cords],
    );

  it('uses its own answer when nobody has set one', () => {
    expect(bodyOf(compileCircuit(posterize()).source!)).toContain('fxPosterize(v0, 0.5)');
  });

  it('rides a uniform rather than being written into the shader', () => {
    // The whole bargain. Set numbers are deliberately out of `signatureOf`, so
    // dragging one does not rebuild a shader sixty times a second — a value
    // interpolated into the GLSL hands that back at every inlet on the canvas,
    // and what it reaches a person as is a control that stalls the picture.
    const built = compileCircuit(posterize({ steps: 0.78 }));
    expect(built.error).toBeNull();
    expect(bodyOf(built.source!)).not.toContain('0.78');
    expect(bodyOf(built.source!)).toContain('fxPosterize(v0, uParams[1])');
  });

  it('cuts the bank to the graph, and never to nothing', () => {
    // GLSL rejects a zero-length array, so a look with no values at all still
    // declares one float — and a look with two declares two, because a fixed
    // bank big enough for every inlet would be hundreds of unread uniforms.
    expect(bankOf(compileCircuit(bareCircuit()).source!)).toBe(1);
    expect(bankOf(compileCircuit(posterize()).source!)).toBe(1);
    expect(bankOf(compileCircuit(posterize({ steps: 0.78 })).source!)).toBe(2);
  });

  it('hands the CPU a bank exactly as long as the shader declared', () => {
    // Shorter and the tail reads zero; longer and `uniform1fv` is an
    // INVALID_OPERATION, which on a node face is a black picture and no
    // message. Both come off `valuesOf` so that neither can happen.
    for (const circuit of [bareCircuit(), starterCircuit(), posterize({ levels: 0.4 })]) {
      expect(paramsOf(circuit).length).toBe(bankOf(compileCircuit(circuit).source!));
    }
  });

  it('gives the slots out in the order the graph reads', () => {
    const values = valuesOf(posterize({ steps: 0.78 }));
    expect(values.map((each) => each.id)).toEqual(['k', 'e/steps']);
    expect(paramsOf(posterize({ steps: 0.78 }))).toEqual(new Float32Array([0.25, 0.78]));
  });

  it('goes dormant under a cord rather than being lost', () => {
    // Wiring an inlet must not be a destructive gesture: the number stays on
    // the node, out of the bank while the cord is on top of it, and comes back
    // where it was when the cord goes. Snapping to the default on unwiring is
    // the sort of thing that makes people stop experimenting with a canvas.
    const wired = posterize({ levels: 0.78 }, [{ from: 'k/n', to: 'e/steps' }]);
    expect(valuesOf(wired).map((each) => each.id)).toEqual(['k']);
    // The `value` node's slot, read through the cord — not the number on the face.
    expect(bodyOf(compileCircuit(wired).source!)).toContain('float v1 = uParams[0]');
    expect(bodyOf(compileCircuit(wired).source!)).toContain('fxPosterize(v0, v1)');
    expect(wired.nodes.find((node) => node.id === 'e')?.values).toEqual({ levels: 0.78 });
  });

  it('is offered on every number inlet whose answer is not already alive', () => {
    // `energy` reads the room and a wave's `phase` reads the beat. A number on
    // either offers to replace something moving with a number that is not,
    // which is a worse default than the one it would replace.
    const values = (node: Circuit['nodes'][number]) =>
      inletsOf(node)
        .filter((port) => port.at !== undefined)
        .map((port) => port.name);
    expect(values({ id: 'e', kind: 'lens', op: 'ripple', x: 0, y: 0 })).toEqual([
      'waves',
      'depth',
      'speed',
    ]);
    expect(values({ id: 'w', kind: 'wave', op: 'sine', x: 0, y: 0 })).toEqual([]);
    expect(values({ id: 'b', kind: 'blend', op: 'over', x: 0, y: 0 })).toEqual(['amount']);
  });

  it('gives a nested look its own slots', () => {
    const looks: Record<string, LookDef> = {
      inner: {
        name: 'Inner',
        circuit: wire(
          [
            { id: 'g', kind: 'source', op: 'rings', x: 0, y: 0 },
            { id: 'p', kind: 'grade', op: 'posterize', x: 1, y: 0, values: { steps: 0.9 } },
            { id: 'o', kind: 'out', x: 2, y: 0 },
          ],
          [
            { from: 'g/c', to: 'p/c' },
            { from: 'p/c', to: 'o/c' },
          ],
        ),
      },
      outer: {
        name: 'Outer',
        circuit: wire(
          [
            { id: 'sub', kind: 'look', op: 'inner', x: 0, y: 0 },
            { id: 'h', kind: 'grade', op: 'hue', x: 1, y: 0, values: { shift: 0.3 } },
            { id: 'o', kind: 'out', x: 2, y: 0 },
          ],
          [
            { from: 'sub/c', to: 'h/c' },
            { from: 'h/c', to: 'o/c' },
          ],
        ),
      },
    };
    const built = compileLook(looks, 'outer');
    expect(built.error).toBeNull();
    expect(built.values.map((each) => each.id)).toEqual(['sub~p/steps', 'h/shift']);
    expect(bankOf(built.source!)).toBe(2);
  });

  it('refuses a graph with more values than the bank may hold', () => {
    const many = Array.from({ length: MAX_VALUES + 1 }, (_, i) => ({
      id: `k${i}`,
      kind: 'value' as const,
      x: 0,
      y: i,
      value: 0.5,
    }));
    const built = compileCircuit(wire([...many, { id: 'o', kind: 'out', x: 1, y: 0 }], []));
    expect(built.source).toBeNull();
    expect(built.error).toMatch(/numbers set/);
  });
});

describe('a colour is a function of a point', () => {
  it('reads its input at the point the effect moved it to', () => {
    // The change that let the layer stack go away. A kaleidoscope does not
    // sample a buffer; it asks its input for the colour at a folded point, and
    // the input re-evaluates itself there.
    const built = compileCircuit(
      wire(
        [
          { id: 'g', kind: 'source', op: 'plasma', x: 0, y: 0 },
          { id: 'k', kind: 'lens', op: 'kaleido', x: 1, y: 0 },
          { id: 'o', kind: 'out', x: 2, y: 0 },
        ],
        [
          { from: 'g/c', to: 'k/c' },
          { from: 'k/c', to: 'o/c' },
        ],
      ),
    );
    expect(built.error).toBeNull();
    const body = bodyOf(built.source!);
    expect(body).toContain('fxKaleido(');
    // The generator is evaluated **at the folded point** rather than at the
    // fragment's own, which is the whole of how the composition happens — and
    // it is one expression rather than two passes and a texture.
    expect(body).toContain('gen_plasma(fxKaleido(centred()');
  });

  it('lets two pictures be moved differently and blended', () => {
    // The shape that was impossible before. Two sources, two different
    // geometries, one mix — which a stack of full-screen passes cannot say at
    // all, because a stack has exactly one thing underneath at a time.
    const built = compileCircuit(
      wire(
        [
          { id: 'p', kind: 'point', x: 0, y: 0 },
          { id: 'f', kind: 'lens', op: 'fold', x: 1, y: 0 },
          { id: 's', kind: 'lens', op: 'swirl', x: 1, y: 1 },
          { id: 'a', kind: 'source', op: 'plasma', x: 2, y: 0 },
          { id: 'b', kind: 'source', op: 'rings', x: 2, y: 1 },
          { id: 'm', kind: 'blend', op: 'screen', x: 3, y: 0 },
          { id: 'o', kind: 'out', x: 4, y: 0 },
        ],
        [
          { from: 'p/p', to: 'f/p' },
          { from: 'p/p', to: 's/p' },
          { from: 'f/p', to: 'a/p' },
          { from: 's/p', to: 'b/p' },
          { from: 'a/c', to: 'm/base' },
          { from: 'b/c', to: 'm/top' },
          { from: 'm/c', to: 'o/c' },
        ],
      ),
    );
    expect(built.error).toBeNull();
    expect(bodyOf(built.source!)).toContain('gen_plasma(');
    expect(bodyOf(built.source!)).toContain('gen_rings(');
    expect(bodyOf(built.source!)).toContain('cFold(');
    expect(bodyOf(built.source!)).toContain('cSwirl(');
  });

  it('evaluates its input once per tap, which is what a blur costs', () => {
    // Honest rather than hidden. A multi-tap effect re-runs its whole input at
    // each tap, and knowing that is the difference between a graph you can
    // reason about and one that mysteriously drops to fifteen frames.
    const built = compileCircuit(
      wire(
        [
          { id: 'g', kind: 'source', op: 'sparks', x: 0, y: 0 },
          { id: 'b', kind: 'spread', op: 'bloom', x: 1, y: 0 },
          { id: 'o', kind: 'out', x: 2, y: 0 },
        ],
        [
          { from: 'g/c', to: 'b/c' },
          { from: 'b/c', to: 'o/c' },
        ],
      ),
    );
    expect(built.error).toBeNull();
    const taps = bodyOf(built.source!).match(/gen_sparks\(/g) ?? [];
    // Eight on the ring plus the untouched centre.
    expect(taps.length).toBe(9);
  });

  it('names a generator that exists when the mode is one nobody has heard of', () => {
    // `op` comes off a file a person may have hand-edited, and a mode nobody
    // recognises has to draw something rather than emit a call to a function
    // that is not there — a shader that fails to compile is a black screen.
    const built = compileCircuit(
      wire(
        [
          { id: 'g', kind: 'source', op: 'lasers', x: 0, y: 0 },
          { id: 'o', kind: 'out', x: 1, y: 0 },
        ],
        [{ from: 'g/c', to: 'o/c' }],
      ),
    );
    expect(built.error).toBeNull();
    expect(bodyOf(built.source!)).not.toContain('gen_lasers');
    expect(bodyOf(built.source!)).toMatch(/gen_\w+\(/);
  });
});

describe('the four ways two pictures combine', () => {
  const blended = (op: string, top: boolean): string => {
    const built = compileCircuit(
      wire(
        [
          { id: 'a', kind: 'source', op: 'plasma', x: 0, y: 0 },
          { id: 'b', kind: 'source', op: 'rings', x: 0, y: 1 },
          { id: 'm', kind: 'blend', op, x: 1, y: 0 },
          { id: 'o', kind: 'out', x: 2, y: 0 },
        ],
        [
          { from: 'a/c', to: 'm/base' },
          ...(top ? [{ from: 'b/c', to: 'm/top' }] : []),
          { from: 'm/c', to: 'o/c' },
        ],
      ),
    );
    expect(built.error).toBeNull();
    return bodyOf(built.source!);
  };

  it('leaves the base alone when nothing is on top, in every mode', () => {
    // `multiply` did not. It was a plain `a * b` on premultiplied colour, so an
    // unwired top — which is `vec4(0.0)` — multiplied the picture by nothing and
    // the frame went black. On the canvas that reads as a node that has come
    // unhooked, because a wire is plainly going into it and nothing is coming
    // out. Every other mode already treated an empty inlet as a no-op, and each
    // of these reduces to the base with the top at zero.
    expect(blended('over', false)).toContain('(vec4(0.0) + v0 * (1.0 - vec4(0.0).a))');
    expect(blended('add', false)).toContain('(v0 + vec4(0.0))');
    expect(blended('screen', false)).toContain('(v0 + vec4(0.0) - v0 * vec4(0.0))');
    expect(blended('multiply', false)).toContain('(v0 * vec4(0.0) + v0 * (1.0 - vec4(0.0).a))');
  });

  it('multiplies the way the set stacks, and not the way arithmetic does', () => {
    // The same shape as `DST_COLOR, ONE_MINUS_SRC_ALPHA`, which is how a Live
    // track multiplies onto the one under it. Two answers to how two pictures
    // combine is the thing a graph exists to have one of.
    expect(blended('multiply', true)).toContain('* (1.0 - v1.a)');
  });
});

describe('an effect reads its input where it says it does', () => {
  it('takes an edge difference the same distance in both directions, in plane units', () => {
    // Two rules in one expression, both learned by looking at it.
    //
    // The same distance both ways, because centring is what makes a circle
    // round and so is what makes a step square — the aspect correction had been
    // applied a second time on the horizontal tap, and every outline came out
    // with a sideways smear that looks like the effect reading the wrong
    // picture rather than like a step being 1.78 pixels wide.
    //
    // And **not** a count of pixels, which is the tap an edge detector normally
    // wants and is wrong for a rig authored on a 320-pixel node face, judged on
    // an 800-pixel bench and projected at 1920. `uRes` in here at all means the
    // one node whose whole job is a line is the one node no preview of which
    // can be trusted.
    const built = compileCircuit(
      wire(
        [
          { id: 'g', kind: 'source', op: 'grid', x: 0, y: 0 },
          { id: 'e', kind: 'spread', op: 'edge', x: 1, y: 0 },
          { id: 'o', kind: 'out', x: 2, y: 0 },
        ],
        [
          { from: 'g/c', to: 'e/c' },
          { from: 'e/c', to: 'o/c' },
        ],
      ),
    );
    expect(built.error).toBeNull();
    const body = bodyOf(built.source!);
    const step = body.match(/vec2\((\([^)]*\)), 0\.0\)/)?.[1];
    expect(step).toBeTruthy();
    expect(body).toContain(`vec2(0.0, ${step})`);
    expect(step).not.toContain('uRes');
  });
});

describe('exactly one out, and it is not optional', () => {
  it('gives a graph that arrived without one somewhere to leave from', () => {
    const fixed = repaired(wire([{ id: 'g', kind: 'source', op: 'plasma', x: 200, y: 40 }], []));
    expect(fixed.nodes.filter((node) => node.kind === 'out')).toHaveLength(1);
    expect(compileCircuit(fixed).error).toBeNull();
  });

  it('keeps the one that was drawing when a file names two', () => {
    // A second `out` is a compile error by name — "more than one out node" —
    // which is a black wall and a sentence about a file nobody is looking at.
    const fixed = repaired(
      wire(
        [
          { id: 'g', kind: 'source', op: 'plasma', x: 0, y: 0 },
          { id: 'spare', kind: 'out', x: 1, y: 0 },
          { id: 'real', kind: 'out', x: 1, y: 1 },
        ],
        [{ from: 'g/c', to: 'real/c' }],
      ),
    );
    expect(fixed.nodes.filter((node) => node.kind === 'out').map((node) => node.id)).toEqual([
      'real',
    ]);
    expect(reachesOut(fixed)).toBe(true);
  });

  it('cuts a cord addressed to an inlet the mode no longer has', () => {
    // What this looked like: an outlet lit up with no wire leaving it. A
    // `ripple` has `waves`; a `posterize` has `levels` and nothing else, so a
    // file saved either side of that change carries a cord the canvas has no
    // port to draw and the compiler quietly ignores.
    const fixed = repaired(
      wire(
        [
          { id: 'k', kind: 'value', x: 0, y: 0, value: 0.5 },
          { id: 'e', kind: 'grade', op: 'posterize', x: 1, y: 0 },
          { id: 'o', kind: 'out', x: 2, y: 0 },
        ],
        [
          { from: 'k/n', to: 'e/waves' },
          { from: 'e/c', to: 'o/c' },
        ],
      ),
    );
    expect(fixed.cords.map((cord) => cord.to)).toEqual(['o/c']);
  });

  it('drops a value addressed to an inlet the mode no longer has', () => {
    // The same repair as the cord above, one step quieter and therefore worse:
    // a stray cord at least lights an outlet up, where a number under a name no
    // port answers to is invisible — until the mode comes back and the picture
    // changes for no reason anyone can see.
    const fixed = repaired(
      wire(
        [
          {
            id: 'e',
            kind: 'grade',
            op: 'posterize',
            x: 0,
            y: 0,
            values: { steps: 0.8, waves: 0.3 },
          },
          { id: 'o', kind: 'out', x: 1, y: 0 },
        ],
        [{ from: 'e/c', to: 'o/c' }],
      ),
    );
    expect(fixed.nodes[0].values).toEqual({ steps: 0.8 });
    // And a node whose values were all strays loses the field rather than
    // keeping an empty map in every save of the file from then on.
    const bare = repaired(
      wire(
        [
          { id: 'h', kind: 'grade', op: 'hue', x: 0, y: 0, values: { reach: 0.4 } },
          { id: 'o', kind: 'out', x: 1, y: 0 },
        ],
        [{ from: 'h/c', to: 'o/c' }],
      ),
    );
    expect(bare.nodes[0].values).toBeUndefined();
  });

  it('leaves a graph the editor made exactly as it was', () => {
    expect(repaired(starterCircuit())).toEqual(starterCircuit());
    expect(repaired(bareCircuit())).toEqual(bareCircuit());
  });
});

describe('a look inside a look', () => {
  const library = (): Record<string, LookDef> => ({
    inner: {
      name: 'Inner',
      circuit: wire(
        [
          { id: 'g', kind: 'source', op: 'rings', x: 0, y: 0 },
          { id: 'k', kind: 'value', x: 0, y: 1, value: 0.3, label: 'inner number' },
          { id: 'o', kind: 'out', x: 1, y: 0 },
        ],
        [{ from: 'g/c', to: 'o/c' }],
      ),
    },
    outer: {
      name: 'Outer',
      circuit: wire(
        [
          { id: 'sub', kind: 'look', op: 'inner', x: 0, y: 0 },
          { id: 'fx', kind: 'lens', op: 'twist', x: 1, y: 0 },
          { id: 'o', kind: 'out', x: 2, y: 0 },
        ],
        [
          { from: 'sub/c', to: 'fx/c' },
          { from: 'fx/c', to: 'o/c' },
        ],
      ),
    },
  });

  it('replaces the node with the graph it names', () => {
    const built = compileLook(library(), 'outer');
    expect(built.error).toBeNull();
    expect(bodyOf(built.source!)).toContain('gen_rings(');
    expect(bodyOf(built.source!)).toContain('fxTwist(');
  });

  it('reads the whole sub-look at the point wired into the node', () => {
    // The node advertised a point inlet, the canvas let you wire one, and the
    // expansion spliced the node out — so the cord was drawn across the screen
    // and addressed to a node that no longer existed. Nothing looked it up and
    // nothing on the wall moved, which is the worst thing an editor can do.
    const looks = library();
    looks.outer.circuit.nodes.push(
      { id: 'pt', kind: 'point', x: 0, y: 2 },
      { id: 'z', kind: 'lens', op: 'zoom', x: 0, y: 3 },
    );
    looks.outer.circuit.cords.push({ from: 'pt/p', to: 'z/p' }, { from: 'z/p', to: 'sub/p' });
    const built = compileLook(looks, 'outer');
    expect(built.error).toBeNull();
    // The sub-look's generator is evaluated at the zoomed point rather than at
    // the fragment's own, exactly as it would be inside one graph.
    expect(bodyOf(built.source!)).toMatch(/gen_rings\(v\d+,/);
    expect(bodyOf(built.source!)).toContain('cZoom(');
  });

  it('reads it where it is asked when nothing is wired into the node', () => {
    expect(bodyOf(compileLook(library(), 'outer').source!)).toContain('gen_rings(fxTwist(');
  });

  it('gives a nested number a slot of its own', () => {
    // Flattening before compiling rather than teaching the compiler about
    // sub-looks is what keeps the compiler one thing: the banks fall out of the
    // expanded graph without a second pass to gather them.
    const built = compileLook(library(), 'outer');
    expect(built.values).toHaveLength(1);
    expect(built.values[0].label).toBe('inner number');
  });

  it('prefixes ids so two copies of one look cannot collide', () => {
    const looks = library();
    looks.two = {
      name: 'Two',
      circuit: wire(
        [
          { id: 'a', kind: 'look', op: 'inner', x: 0, y: 0 },
          { id: 'b', kind: 'look', op: 'inner', x: 0, y: 1 },
          { id: 'm', kind: 'blend', op: 'add', x: 1, y: 0 },
          { id: 'o', kind: 'out', x: 2, y: 0 },
        ],
        [
          { from: 'a/c', to: 'm/base' },
          { from: 'b/c', to: 'm/top' },
          { from: 'm/c', to: 'o/c' },
        ],
      ),
    };
    const { circuit } = flatten(looks, 'two');
    expect(new Set(circuit.nodes.map((n) => n.id)).size).toBe(circuit.nodes.length);
    expect(compileLook(looks, 'two').error).toBeNull();
  });

  it('draws nothing rather than failing when the look it names is gone', () => {
    // A look you deleted should make the thing that used it go quiet, not stop
    // the show.
    const looks = library();
    delete looks.inner;
    const built = compileLook(looks, 'outer');
    expect(built.error).toBeNull();
  });

  it('refuses a loop before it is wired, not when it fails to compile', () => {
    // At compile time the honest message is "one of these seven looks contains
    // itself", which nobody can act on. At the moment of dropping, the message
    // is about the thing you just clicked.
    const looks = library();
    expect(wouldLoop(looks, 'inner', 'outer')).toBe(true);
    expect(wouldLoop(looks, 'outer', 'inner')).toBe(false);
    expect(wouldLoop(looks, 'inner', 'inner')).toBe(true);
  });

  it('says so rather than hanging when a loop got into a file anyway', () => {
    const looks = library();
    looks.inner.circuit.nodes.push({ id: 'back', kind: 'look', op: 'outer', x: 2, y: 2 });
    looks.inner.circuit.cords.push({ from: 'back/c', to: 'o/c' });
    expect(compileLook(looks, 'outer').error).toMatch(/contains itself/);
  });
});
