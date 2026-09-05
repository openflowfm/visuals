import { describe, expect, it } from 'vitest';
import type { Circuit, FlowDef } from '../../protocol.ts';
import { FIELD_MODES, LFO_SHAPES, LIGHT_MODES, SOURCES, TRACK_DRAWS, wouldLoop } from '../../protocol.ts';
import {
  MAX_VALUES,
  bareCircuit,
  canBypass,
  canTurnOff,
  compileCircuit,
  compileFlow,
  flatten,
  flowDoors,
  inletsOf,
  liveNodes,
  outletGivesNothing,
  reachesOut,
  repaired,
  signalOf,
  starterCircuit,
  strandedNodes,
  tracksOf,
  valuesOf,
  wouldFeedItself,
} from './circuit.ts';
import { namedTracks, paramsOf, signatureOfCircuit } from './flow.ts';
import { FIELD_WORK } from './glsl/fields.ts';
import { FRACTAL_ITERATIONS, TRACK_SHADERS } from './shaders.ts';

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

describe('compiling a flow', () => {
  it('compiles what a new flow starts as', () => {
    const built = compileCircuit(starterCircuit());
    expect(built.error).toBeNull();
    expect(bodyOf(built.source!)).toContain('fragColor =');
  });

  it('starts a new flow with the set already in it', () => {
    // A claim about what this rig is for: the picture should be reacting to
    // whoever is playing before anyone has decided anything, so taking the
    // tracks node out is a deliberate act rather than the default state.
    expect(compileCircuit(starterCircuit()).draws).toBe('by name');
    expect(compileCircuit(bareCircuit()).draws).toBe('by name');
  });

  it('gives a new flow one number of its own, already named', () => {
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

  it('draws nothing rather than refusing a graph with no out at all', () => {
    // A provider flow has no out on purpose — its doors are `give` nodes — so
    // an absent out is the honest transparent frame, not an error.
    const built = compileCircuit(wire([{ id: 'p', kind: 'point', x: 0, y: 0 }], []));
    expect(built.error).toBeNull();
    expect(bodyOf(built.source!)).toContain('vec4(0.0)');
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

  it('names the nodes whose work never leaves the flow', () => {
    // A branch that stops short draws nothing, so the picture is identical to
    // the same graph without it. The editor wants them named to finish them;
    // the lab wants a candidate that has none, because a second copy of one
    // picture is a second id, a second dot and a second comparison.
    const circuit = wire(
      [
        { id: 'live', kind: 'source', op: 'plasma', x: 0, y: 0 },
        { id: 'dead', kind: 'source', op: 'rings', x: 0, y: 1 },
        { id: 'lonely', kind: 'grade', op: 'warm', x: 1, y: 1 },
        { id: 'o', kind: 'out', x: 2, y: 0 },
      ],
      [
        { from: 'live/c', to: 'o/c' },
        { from: 'dead/c', to: 'lonely/c' },
      ],
    );
    expect(strandedNodes(circuit)).toEqual(['dead', 'lonely']);
    expect([...liveNodes(circuit)].sort()).toEqual(['live', 'o']);
    // And it never refuses to draw one: a graph mid-wiring is stranded almost
    // continuously, which is why this is a sentence and not a gate.
    expect(compileCircuit(circuit).error).toBeNull();
  });

  it('follows what an outlet actually reads, not what its node touches', () => {
    // The `lens` case, one direction over from `wouldFeedItself`. Its `p`
    // outlet never looks at its `c` inlet, so a picture wired into that inlet
    // when only the point is taken is genuinely doing nothing — and anything
    // reasoning node-to-node would call it live and keep it.
    const circuit = wire(
      [
        { id: 'pic', kind: 'source', op: 'plasma', x: 0, y: 0 },
        { id: 'l', kind: 'lens', op: 'ripple', x: 1, y: 0 },
        { id: 'field', kind: 'source', op: 'rings', x: 1, y: 1 },
        { id: 'o', kind: 'out', x: 2, y: 0 },
      ],
      [
        { from: 'pic/c', to: 'l/c' },
        { from: 'l/p', to: 'field/p' },
        { from: 'field/c', to: 'o/c' },
      ],
    );
    expect(strandedNodes(circuit)).toEqual(['pic']);

    // Take the colour instead and the same picture is load-bearing.
    const taken = wire(circuit.nodes, [
      { from: 'pic/c', to: 'l/c' },
      { from: 'l/c', to: 'o/c' },
    ]);
    expect(strandedNodes(taken)).toEqual(['field']);
  });

  it('counts a give as a door, so a provider is not entirely stranded', () => {
    const provider = wire(
      [
        { id: 's', kind: 'source', op: 'plasma', x: 0, y: 0 },
        { id: 'g', kind: 'give', op: 'colour', x: 1, y: 0 },
      ],
      [{ from: 's/c', to: 'g/in' }],
    );
    expect(strandedNodes(provider)).toEqual([]);
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

  it('banks the tracks a flow names, positionally', () => {
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
    expect(namedTracks(circuit).slice(0, 2).map((each) => each.id)).toEqual(['t1', 't2']);
  });

  it('banks a reading and a smoothing, not just a name', () => {
    // One bank rather than two, which is what merging `energy` into `track`
    // bought: the CPU fills each slot with whatever that node asked for, and
    // the shader reads a number without learning which. Two banks meant a flow
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

describe('disabling a node', () => {
  const graded = (bypassed = false): Circuit =>
    wire(
      [
        { id: 'g', kind: 'source', op: 'plasma', x: 0, y: 0 },
        {
          id: 'e',
          kind: 'grade',
          op: 'hue',
          values: { shift: 0.8 },
          bypassed,
          x: 1,
          y: 0,
        },
        { id: 'o', kind: 'out', x: 2, y: 0 },
      ],
      [
        { from: 'g/c', to: 'e/c' },
        { from: 'e/c', to: 'o/c' },
      ],
    );

  it('passes the matching input through without deleting settings or cords', () => {
    const active = bodyOf(compileCircuit(graded()).source!);
    const bypassed = bodyOf(compileCircuit(graded(true)).source!);
    expect(active).toContain('cHue(');
    expect(bypassed).toContain('gen_plasma(');
    expect(bypassed).not.toContain('cHue(');
    expect(graded(true).nodes[1]).toMatchObject({ values: { shift: 0.8 }, bypassed: true });
    expect(graded(true).cords).toEqual(graded().cords);
  });

  it('offers bypass only where a real same-signal route exists', () => {
    expect(canBypass(graded().nodes[1])).toBe(true);
    expect(canBypass({ id: 'source', kind: 'source', op: 'plasma', x: 0, y: 0 })).toBe(false);
    expect(canBypass({ id: 'model', kind: 'model', x: 0, y: 0 })).toBe(false);
    expect(canBypass({ id: 'figure', kind: 'figure', op: 'circle', x: 0, y: 0 })).toBe(false);
    expect(canBypass({ id: 'lfo', kind: 'lfo', op: 'sine', x: 0, y: 0 })).toBe(false);
    expect(canBypass({ id: 'out', kind: 'out', x: 0, y: 0 })).toBe(false);
  });

  it('makes only the chosen pass-through branch live', () => {
    const circuit = wire(
      [
        { id: 'base', kind: 'source', op: 'plasma', x: 0, y: 0 },
        { id: 'top', kind: 'source', op: 'rings', x: 0, y: 1 },
        { id: 'mix', kind: 'blend', op: 'add', bypassed: true, x: 1, y: 0 },
        { id: 'o', kind: 'out', x: 2, y: 0 },
      ],
      [
        { from: 'base/c', to: 'mix/base' },
        { from: 'top/c', to: 'mix/top' },
        { from: 'mix/c', to: 'o/c' },
      ],
    );
    expect(liveNodes(circuit)).toEqual(new Set(['o', 'mix', 'base']));
  });

  it('still refuses wiring that would loop when the node is enabled again', () => {
    const circuit = wire(
      [
        { id: 'a', kind: 'grade', op: 'hue', bypassed: true, x: 0, y: 0 },
        { id: 'b', kind: 'grade', op: 'levels', x: 1, y: 0 },
      ],
      [{ from: 'a/c', to: 'b/c' }],
    );
    expect(wouldFeedItself(circuit, 'b/c', 'a/c')).toBe(true);
  });
});

describe('LFO nodes', () => {
  it('compiles every waveform against the same controllable timing contract', () => {
    const expected = {
      sine: 'cLfoSine(',
      triangle: 'cLfoTriangle(',
      saw: 'cLfoSaw(',
      ramp: 'cLfoRamp(',
      square: 'cLfoSquare(',
      pulse: 'cLfoPulse(',
      noise: 'cLfoNoise(',
      'sample-hold': 'cLfoHold(',
    } as const;
    for (const op of LFO_SHAPES) {
      const built = compileCircuit(
        wire(
          [
            { id: 'l', kind: 'lfo', op, values: { rate: 0.5, sync: 1, phase: 0.25 }, x: 0, y: 0 },
            { id: 'p', kind: 'colorway', x: 1, y: 0 },
            { id: 'o', kind: 'out', x: 2, y: 0 },
          ],
          [
            { from: 'l/n', to: 'p/amount' },
            { from: 'p/primary', to: 'o/c' },
          ],
        ),
      );
      expect(built.error, op).toBeNull();
      expect(bodyOf(built.source!), op).toContain(expected[op]);
      expect(bodyOf(built.source!), op).toContain('cLfoPhase(');
      expect(built.values.filter((value) => value.id.startsWith('l/')).map((value) => value.id)).toEqual([
        'l/rate',
        'l/sync',
        'l/phase',
      ]);
    }
  });

  it('defaults to the calibrated square response at the old midpoint', () => {
    const lfo = { id: 'l', kind: 'lfo', op: 'sine', x: 0, y: 0 } as const;
    expect(inletsOf(lfo).map(({ name, at }) => ({ name, at }))).toEqual([
      // `clock` first, and with no resting number: it rests on the beat, and
      // being first is what lets the lab splice one onto a number cord.
      { name: 'clock', at: undefined },
      { name: 'rate', at: 0.5 },
      { name: 'sync', at: 1 },
      { name: 'phase', at: 0 },
    ]);
    const built = compileCircuit(
      wire(
        [lfo, { id: 'p', kind: 'colorway', x: 1, y: 0 }, { id: 'o', kind: 'out', x: 2, y: 0 }],
        [{ from: 'l/n', to: 'p/amount' }, { from: 'p/primary', to: 'o/c' }],
      ),
    );
    const source = bodyOf(built.source!);
    expect(source).toContain('cLfoPhase(');
    expect(source).toContain('pow(');
    expect(source).toContain(', 2.0)');
  });
});

describe('video nodes', () => {
  const videoCircuit = (count: number, connected = count): Circuit => {
    const nodes: Circuit['nodes'] = Array.from({ length: count }, (_, index) => ({
      id: `v${index}`,
      kind: 'video',
      op: index % 2 ? 'once' : 'loop',
      asset: `loops/${index}.mp4`,
      x: 0,
      y: index,
    }));
    if (connected > 1) nodes.push({ id: 'mix', kind: 'blend', op: 'add', x: 1, y: 0 });
    nodes.push({ id: 'o', kind: 'out', x: 2, y: 0 });
    const cords: Circuit['cords'] = [];
    if (connected === 1) cords.push({ from: 'v0/c', to: 'o/c' });
    if (connected > 1) {
      cords.push({ from: 'v0/c', to: 'mix/base' }, { from: 'v1/c', to: 'mix/top' });
      // A third reachable video replaces the top, matching the compiler's
      // last-cord-wins inlet rule while still forcing all three through a chain.
      if (connected > 2) {
        nodes.splice(nodes.length - 1, 0, { id: 'mix2', kind: 'blend', op: 'add', x: 2, y: 1 });
        cords.push(
          { from: 'mix/c', to: 'mix2/base' },
          { from: 'v2/c', to: 'mix2/top' },
          { from: 'mix2/c', to: 'o/c' },
        );
      } else cords.push({ from: 'mix/c', to: 'o/c' });
    }
    return { nodes, cords };
  };

  it('assigns stable sampler slots to reachable videos', () => {
    const built = compileCircuit(videoCircuit(2, 2));
    expect(built.error).toBeNull();
    expect(bodyOf(built.source!)).toContain('fromVideo0(');
    expect(bodyOf(built.source!)).toContain('fromVideo1(');
    expect(built.videos.map(({ asset, mode, index }) => ({ asset, mode, index }))).toEqual([
      { asset: 'loops/0.mp4', mode: 'loop', index: 0 },
      { asset: 'loops/1.mp4', mode: 'once', index: 1 },
    ]);
  });

  it('does not create a decoder slot for a parked video', () => {
    expect(compileCircuit(videoCircuit(3, 1)).videos).toHaveLength(1);
  });

  it('refuses more than two reachable decoders before reaching WebGL', () => {
    expect(compileCircuit(videoCircuit(3, 3)).error).toBe('more than 2 reachable video nodes');
  });
});

describe('image nodes', () => {
  const imageCircuit = (count: number, connected = count): Circuit => {
    const nodes: Circuit['nodes'] = Array.from({ length: count }, (_, index) => ({
      id: `i${index}`,
      kind: 'image',
      op: index % 2 ? 'contain' : 'cover',
      asset: `stills/${index}.png`,
      x: 0,
      y: index,
    }));
    const cords: Circuit['cords'] = [];
    let previous = 'i0/c';
    for (let index = 1; index < connected; index++) {
      const mix = `mix${index}`;
      nodes.push({ id: mix, kind: 'blend', op: 'add', x: index, y: 0 });
      cords.push({ from: previous, to: `${mix}/base` }, { from: `i${index}/c`, to: `${mix}/top` });
      previous = `${mix}/c`;
    }
    nodes.push({ id: 'o', kind: 'out', x: connected + 1, y: 0 });
    if (connected > 0) cords.push({ from: previous, to: 'o/c' });
    return { nodes, cords };
  };

  it('assigns stable sampler slots and framing to reachable images', () => {
    const built = compileCircuit(imageCircuit(2));
    expect(built.error).toBeNull();
    expect(bodyOf(built.source!)).toContain('fromImage0(');
    expect(bodyOf(built.source!)).toContain('fromImage1(');
    expect(bodyOf(built.source!)).toContain(', true)');
    expect(built.images.map(({ asset, mode, index }) => ({ asset, mode, index }))).toEqual([
      { asset: 'stills/0.png', mode: 'cover', index: 0 },
      { asset: 'stills/1.png', mode: 'contain', index: 1 },
    ]);
  });

  it('does not reserve a texture for a parked image', () => {
    expect(compileCircuit(imageCircuit(5, 1)).images).toHaveLength(1);
  });

  it('refuses more than four reachable still textures before WebGL', () => {
    expect(compileCircuit(imageCircuit(5)).error).toBe('more than 4 reachable image nodes');
  });
});

describe('the lightweight source registry', () => {
  it('compiles every source through both graph and per-track paths', () => {
    for (const op of SOURCES) {
      const built = compileCircuit(
        wire(
          [
            { id: 'g', kind: 'source', op, x: 0, y: 0 },
            { id: 'o', kind: 'out', x: 1, y: 0 },
          ],
          [{ from: 'g/c', to: 'o/c' }],
        ),
      );
      expect(built.error, op).toBeNull();
      expect(bodyOf(built.source!), op).toContain(`gen_${op}(`);
      expect(TRACK_SHADERS.has(op), op).toBe(true);
    }

    expect([...TRACK_SHADERS.keys()]).toEqual(SOURCES);
    expect(TRACK_DRAWS.slice(1)).toEqual(SOURCES);
  });
});

describe('the bounded procedural field node', () => {
  const field = (op: (typeof FIELD_MODES)[number]): Circuit =>
    wire(
      [
        { id: 'f', kind: 'field', op, x: 0, y: 0 },
        { id: 'o', kind: 'out', x: 1, y: 0 },
      ],
      [{ from: 'f/c', to: 'o/c' }],
    );

  it('compiles every published fixed-work mode without offering it per track', () => {
    for (const op of FIELD_MODES) {
      const built = compileCircuit(field(op));
      expect(built.error, op).toBeNull();
      expect(bodyOf(built.source!), op).toContain(`field_${op}(`);
      expect(FIELD_WORK[op], op).toBeGreaterThan(0);
      expect(TRACK_DRAWS, op).not.toContain(op);
      expect(TRACK_SHADERS.has(op), op).toBe(false);
    }
  });

  it('offers colony controls only on metaballs and passes both into its shader entry point', () => {
    // `cells` carries a `weave` beside its energy — the promoted lattice
    // scale, following the energy inlet until somebody takes it.
    expect(
      inletsOf({ id: 'cells', kind: 'field', op: 'cells', x: 0, y: 0 }).map(
        (port) => port.name,
      ),
    ).toEqual(['p', 'energy', 'weave']);
    expect(
      inletsOf({ id: 'metaballs', kind: 'field', op: 'metaballs', x: 0, y: 0 }).map(
        (port) => port.name,
      ),
    ).toEqual(['p', 'energy', 'balls', 'apart']);

    const built = compileCircuit(field('metaballs'));
    expect(bodyOf(built.source!)).toMatch(/field_metaballs\([^,]+, [^,]+, [^,]+, [^)]+\)/);
  });

  it('allows bounded sampling and refuses a multiplication beyond the work budget', () => {
    const sampled = (spread: 'shift' | 'bloom') =>
      compileCircuit(
        wire(
          [
            { id: 'f', kind: 'field', op: 'clouds', x: 0, y: 0 },
            { id: 's', kind: 'spread', op: spread, x: 1, y: 0 },
            { id: 'o', kind: 'out', x: 2, y: 0 },
          ],
          [
            { from: 'f/c', to: 's/c' },
            { from: 's/c', to: 'o/c' },
          ],
        ),
      );

    expect(sampled('shift').error).toBeNull();
    expect(sampled('bloom').source).toBeNull();
    expect(sampled('bloom').error).toMatch(/costly picture.*sampled too many times/);
  });

  it('keeps a seven-ball nine-tap bloom one work unit below the ceiling', () => {
    const bloomed = compileCircuit(
      wire(
        [
          { id: 'f', kind: 'field', op: 'metaballs', x: 0, y: 0 },
          { id: 's', kind: 'spread', op: 'bloom', x: 1, y: 0 },
          { id: 'o', kind: 'out', x: 2, y: 0 },
        ],
        [
          { from: 'f/c', to: 's/c' },
          { from: 's/c', to: 'o/c' },
        ],
      ),
    );

    expect(FIELD_WORK.metaballs * 9).toBe(63);
    expect(bloomed.error).toBeNull();
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
    // never put one together, so two oscillators — or two meters — had nowhere
    // to go.
    const built = compileCircuit(
      placed(
        [
          { id: 'b', kind: 'playback', op: 'beat', x: 0, y: 1 },
          { id: 'wx', kind: 'lfo', op: 'sine', x: 0, y: 2 },
          { id: 'wy', kind: 'lfo', op: 'saw', x: 0, y: 3 },
        ],
        [
          { from: 'b/n', to: 'wx/clock' },
          { from: 'b/n', to: 'wy/clock' },
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
          { id: 'pa', kind: 'colorway', x: 2, y: 0 },
          { id: 'o', kind: 'out', x: 3, y: 0 },
        ],
        [
          { from: 'pl/p', to: 'po/p' },
          { from: 'po/radius', to: 'pa/amount' },
          { from: 'pa/primary', to: 'o/c' },
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
    // GLSL rejects a zero-length array, so a flow with no values at all still
    // declares one float — and a flow with two declares two, because a fixed
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

  it('changes the cache signature whenever the uniform-bank shape changes', () => {
    const plain = posterize(undefined, [{ from: 'k/n', to: 'e/steps' }]);
    const ranged = {
      ...plain,
      nodes: plain.nodes.map((node) =>
        node.id === 'e' ? { ...node, depths: { steps: 0.4 } } : node,
      ),
    };
    expect(paramsOf(plain)).toHaveLength(1);
    expect(paramsOf(ranged)).toHaveLength(3);
    expect(signatureOfCircuit(ranged)).not.toBe(signatureOfCircuit(plain));

    // While the pair remains non-neutral, turning either number changes only
    // the uploaded values. This is the hot path a slider must keep off the
    // shader compiler.
    const turned = {
      ...ranged,
      nodes: ranged.nodes.map((node) =>
        node.id === 'e'
          ? { ...node, values: { steps: 0.2 }, depths: { steps: -0.7 } }
          : node,
      ),
    };
    expect(signatureOfCircuit(turned)).toBe(signatureOfCircuit(ranged));
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

  it('starts a live inlet on its signal, with no number of its own', () => {
    // `energy` reads the room and a wave's `phase` reads the beat, so neither
    // carries an `at`: their resting answer is a signal, and a default number
    // here would replace something moving with something that is not.
    const starting = (node: Circuit['nodes'][number]) =>
      inletsOf(node)
        .filter((port) => port.at !== undefined)
        .map((port) => port.name);
    expect(starting({ id: 'e', kind: 'lens', op: 'ripple', x: 0, y: 0 })).toEqual([
      'waves',
      'depth',
      'speed',
    ]);
    // `clock` rests on the beat rather than on a number, so it contributes no
    // starting value even though the three inlets beside it do.
    expect(starting({ id: 'w', kind: 'lfo', op: 'sine', x: 0, y: 0 })).toEqual([
      'rate',
      'sync',
      'phase',
    ]);
    expect(starting({ id: 'b', kind: 'blend', op: 'over', x: 0, y: 0 })).toEqual(['amount']);
  });

  it('can still hold a number on a live inlet, which takes the signal over', () => {
    // The face draws the energy row exactly like every other number row, so
    // the drag it offers has to mean something: a held `energy` reads the
    // held number, and clearing it hands the room back.
    const plasma = (values?: Record<string, number>): Circuit =>
      wire(
        [
          { id: 'g', kind: 'source', op: 'plasma', x: 0, y: 0, ...(values ? { values } : {}) },
          { id: 'o', kind: 'out', x: 1, y: 0 },
        ],
        [{ from: 'g/c', to: 'o/c' }],
      );
    expect(valuesOf(plasma()).map((each) => each.id)).toEqual([]);
    expect(bodyOf(compileCircuit(plasma()).source!)).toMatch(/gen_plasma\(.*uEnergy/);

    const held = plasma({ energy: 0.8 });
    expect(valuesOf(held).map((each) => each.id)).toEqual(['g/energy']);
    expect(paramsOf(held)).toEqual(new Float32Array([0.8]));
    const source = bodyOf(compileCircuit(held).source!);
    expect(source).toMatch(/gen_plasma\(.*uParams\[0\]/);
    expect(source).not.toMatch(/gen_plasma\(.*uEnergy/);
  });

  it('lets a promoted shape number follow energy until somebody takes it', () => {
    const bars = (values?: Record<string, number>): Circuit =>
      wire(
        [
          { id: 'g', kind: 'source', op: 'bars', x: 0, y: 0, ...(values ? { values } : {}) },
          { id: 'o', kind: 'out', x: 1, y: 0 },
        ],
        [{ from: 'g/c', to: 'o/c' }],
      );
    // Both begin from the room's normalized energy. The accepted square energy
    // response and linear columns response then let the two controls interpret
    // that shared source independently.
    const live = bodyOf(compileCircuit(bars()).source!);
    expect(live).toContain('gen_bars(');
    expect(live).toContain('pow(');
    expect(live).toMatch(/, uEnergy\),/);
    // A held energy is still the raw source for its follower; each inlet then
    // applies the response calibrated for its own meaning.
    const heldEnergy = bars({ energy: 0.8 });
    const heldEnergySource = bodyOf(compileCircuit(heldEnergy).source!);
    expect(heldEnergySource).toContain('pow(');
    expect(heldEnergySource).toMatch(/, uParams\[0\]\),/);
    // A caught `columns` pins the shape and leaves the energy live.
    const heldColumns = bars({ columns: 0.2 });
    expect(valuesOf(heldColumns).map((each) => each.id)).toEqual(['g/columns']);
    const heldColumnsSource = bodyOf(compileCircuit(heldColumns).source!);
    expect(heldColumnsSource).toContain('pow(');
    expect(heldColumnsSource).toContain('uParams[0]');
  });

  it('gives a nested flow its own slots', () => {
    const flows: Record<string, FlowDef> = {
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
            { id: 'sub', kind: 'flow', op: 'inner', x: 0, y: 0 },
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
    const built = compileFlow(flows, 'outer');
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

describe('the bounded fractal node', () => {
  const fractal = (op: 'mandelbrot' | 'julia'): Circuit =>
    wire(
      [
        { id: 'f', kind: 'fractal', op, x: 0, y: 0 },
        { id: 'o', kind: 'out', x: 1, y: 0 },
      ],
      [{ from: 'f/c', to: 'o/c' }],
    );

  it('compiles both modes through one hard-capped orbit implementation', () => {
    const mandelbrot = compileCircuit(fractal('mandelbrot'));
    const julia = compileCircuit(fractal('julia'));

    expect(mandelbrot.error).toBeNull();
    expect(julia.error).toBeNull();
    expect(bodyOf(mandelbrot.source!)).toContain('fractalMandelbrot(');
    expect(bodyOf(julia.source!)).toContain('fractalJulia(');
    expect(mandelbrot.source).toContain(`i < ${FRACTAL_ITERATIONS}`);
    expect(mandelbrot.source).toContain('if (i >= steps) break');
  });

  it('keeps detail in the uniform bank instead of recompiling the loop', () => {
    const circuit = fractal('mandelbrot');
    circuit.nodes[0].values = { detail: 0.8 };
    const built = compileCircuit(circuit);

    expect(built.error).toBeNull();
    expect(bodyOf(built.source!)).toContain('fractalMandelbrot(');
    expect(bodyOf(built.source!)).toContain('uParams[0]');
    expect(bodyOf(built.source!)).not.toContain('0.8');
  });

  it('allows two direct fractals but refuses a spread that multiplies their loop', () => {
    const two = compileCircuit(
      wire(
        [
          { id: 'a', kind: 'fractal', op: 'mandelbrot', x: 0, y: 0 },
          { id: 'b', kind: 'fractal', op: 'julia', x: 0, y: 1 },
          { id: 'mix', kind: 'blend', op: 'screen', x: 1, y: 0 },
          { id: 'o', kind: 'out', x: 2, y: 0 },
        ],
        [
          { from: 'a/c', to: 'mix/base' },
          { from: 'b/c', to: 'mix/top' },
          { from: 'mix/c', to: 'o/c' },
        ],
      ),
    );
    expect(two.error).toBeNull();

    const multiplied = compileCircuit(
      wire(
        [
          { id: 'f', kind: 'fractal', op: 'mandelbrot', x: 0, y: 0 },
          { id: 's', kind: 'spread', op: 'shift', x: 1, y: 0 },
          { id: 'o', kind: 'out', x: 2, y: 0 },
        ],
        [
          { from: 'f/c', to: 's/c' },
          { from: 's/c', to: 'o/c' },
        ],
      ),
    );
    expect(multiplied.source).toBeNull();
    expect(multiplied.error).toMatch(/costly picture.*sampled too many times/);
  });
});

describe('the bounded light node', () => {
  const light = (op: string): Circuit =>
    wire(
      [
        { id: 'l', kind: 'light', op, x: 0, y: 0 },
        { id: 'o', kind: 'out', x: 1, y: 0 },
      ],
      [{ from: 'l/c', to: 'o/c' }],
    );

  it('compiles every mode to its own bounded function', () => {
    for (const op of LIGHT_MODES) {
      const built = compileCircuit(light(op));
      expect(built.error).toBeNull();
      expect(bodyOf(built.source!)).toContain(`light_${op}(`);
    }
  });

  it('hangs where a cord says, and caustics nowhere at all', () => {
    const lamp = compileCircuit(light('lamp'));
    expect(bodyOf(lamp.source!)).toContain('light_lamp(centred(), vec2(0.0),');
    const caustics = compileCircuit(light('caustics'));
    expect(bodyOf(caustics.source!)).toContain('light_caustics(centred(),');
    expect(bodyOf(caustics.source!)).not.toContain('light_caustics(centred(), vec2(');
  });

  it('keeps a turned value in the uniform bank instead of recompiling', () => {
    const circuit = light('lamp');
    circuit.nodes[0].values = { carry: 0.8 };
    const built = compileCircuit(circuit);
    expect(built.error).toBeNull();
    expect(bodyOf(built.source!)).toContain('uParams[0]');
    expect(bodyOf(built.source!)).not.toContain('0.8');
  });

  it('lets three lights blend but refuses a bloom that multiplies the water', () => {
    const trio = compileCircuit(
      wire(
        [
          { id: 'a', kind: 'light', op: 'caustics', x: 0, y: 0 },
          { id: 'b', kind: 'light', op: 'shafts', x: 0, y: 1 },
          { id: 'm', kind: 'blend', op: 'screen', x: 1, y: 0 },
          { id: 'o', kind: 'out', x: 2, y: 0 },
        ],
        [
          { from: 'a/c', to: 'm/base' },
          { from: 'b/c', to: 'm/top' },
          { from: 'm/c', to: 'o/c' },
        ],
      ),
    );
    expect(trio.error).toBeNull();

    const multiplied = compileCircuit(
      wire(
        [
          { id: 'a', kind: 'light', op: 'caustics', x: 0, y: 0 },
          { id: 's', kind: 'spread', op: 'bloom', x: 1, y: 0 },
          { id: 'o', kind: 'out', x: 2, y: 0 },
        ],
        [
          { from: 'a/c', to: 's/c' },
          { from: 's/c', to: 'o/c' },
        ],
      ),
    );
    expect(multiplied.source).toBeNull();
    expect(multiplied.error).toMatch(/costly picture.*sampled too many times/);
  });
});

describe('the six ways two pictures combine', () => {
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

  it('leaves the base alone when nothing is on top of a carve either', () => {
    // The same rule as above, and it takes a different fallback to keep it. The
    // identity of a sum is nothing on top, which is vec4(0.0); the identity of a
    // stencil is a mask that lets everything through, and the identity of a cut
    // is one that takes nothing away. Left at zero, dropping a stencil on a
    // wired-up graph would black the frame — which is exactly the thing that
    // made multiply look like a node that had come unhooked.
    expect(blended('stencil', false)).toContain('(v0 * fxLuma(vec4(1.0).rgb))');
    expect(blended('cut', false)).toContain('(v0 * (1.0 - fxLuma(vec4(0.0, 0.0, 0.0, 1.0).rgb)))');
  });

  it('carves with the top picture’s brightness, which no blendFunc can do', () => {
    // The reason `blend` has a mode list of its own rather than sharing the set
    // pass's. Every mode above is a pair of GL blend factors written out as an
    // expression; these two read the top picture's LUMINANCE, and fixed-function
    // hardware only ever reads its alpha. On footage that is the whole
    // difference between a mask that works and one that cannot: a video's alpha
    // is 1 in every pixel it has.
    expect(blended('stencil', true)).toContain('(v0 * fxLuma(v1.rgb))');
    expect(blended('cut', true)).toContain('(v0 * (1.0 - fxLuma(v1.rgb)))');
  });

  it('reads the mask premultiplied, so a soft edge masks softly', () => {
    // Off the premultiplied colour on purpose: brightness times coverage, in one
    // number. A lamp fading to nothing at its edge should stop masking there,
    // and dividing the coverage back out first would make its faintest edge as
    // strong a mask as its core — which is a hard-edged circle drawn by
    // something that was chosen for being soft.
    expect(blended('stencil', true)).not.toContain('max(v1.a');
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

describe('a zoom that compounds is a rate, not a distance', () => {
  it('creeps by the elapsed time rather than by a step per frame', () => {
    // The same argument as the decay beside it, one node along. A fixed factor
    // applied once a frame compounds into a different speed on every display,
    // so sixty frames of 0.99 is not a hundred and twenty frames of 0.99 — and
    // a trail dialled in on the projector would run at half the speed on the
    // laptop next to it. Summing exponents over `uDt` is what makes it one
    // speed everywhere.
    const built = compileCircuit(
      wire(
        [
          { id: 'l', kind: 'last', x: 0, y: 0 },
          { id: 'c', kind: 'lens', op: 'creep', x: 1, y: 0 },
          { id: 'o', kind: 'out', x: 2, y: 0 },
        ],
        [
          { from: 'l/c', to: 'c/c' },
          { from: 'c/c', to: 'o/c' },
        ],
      ),
    );
    expect(built.error).toBeNull();
    expect(bodyOf(built.source!)).toContain('fxCreep(centred(), 0.5)');
    expect(built.source!).toContain('exp2(-n * n * n * 1.5 * uDt)');
  });

  it('holds still at the centre, like every other centred control', () => {
    // Dropping one changes nothing until it is turned, which is the bargain
    // every unwired inlet makes. A creep that drifted at rest would be a node
    // that moved the picture by existing.
    expect(inletsOf({ id: 'c', kind: 'lens', op: 'creep', x: 0, y: 0 })).toMatchObject([
      { name: 'p' },
      { name: 'c' },
      { name: 'grow', at: 0.5 },
    ]);
  });
});

describe('the frame before this one', () => {
  const trail = (nodes: Circuit['nodes'], cords: Circuit['cords']) => compileCircuit(wire(nodes, cords));

  it('reads a texture rather than an expression, and says the flow needs one', () => {
    // The deliberate second exception to expression-only pictures, and it is the
    // same exception a video is: a real texture, sampled as a colour at a point,
    // so every lens, grade, spread and blend works on it unchanged. What the
    // caller has to be told is only whether to keep a buffer at all, which is a
    // yes or a no and never a count — every `last` in a graph reads the one
    // frame.
    const built = trail(
      [
        { id: 'l', kind: 'last', x: 0, y: 0 },
        { id: 'o', kind: 'out', x: 1, y: 0 },
      ],
      [{ from: 'l/c', to: 'o/c' }],
    );
    expect(built.error).toBeNull();
    expect(bodyOf(built.source!)).toContain('fromLast(centred(), 0.45)');
    expect(built.feedback).toBe(true);
  });

  it('costs one buffer however many of them a graph has', () => {
    // Unlike a video, which is a decoder and is therefore capped at two. Four
    // `last` nodes are four samples of one texture, so the only budget they
    // touch is the ordinary one every sample touches.
    const many = trail(
      [
        { id: 'a', kind: 'last', x: 0, y: 0 },
        { id: 'b', kind: 'last', x: 0, y: 1 },
        { id: 'c', kind: 'last', x: 0, y: 2 },
        { id: 'd', kind: 'last', x: 0, y: 3 },
        { id: 'm1', kind: 'blend', op: 'add', x: 1, y: 0 },
        { id: 'm2', kind: 'blend', op: 'add', x: 1, y: 1 },
        { id: 'm3', kind: 'blend', op: 'add', x: 2, y: 0 },
        { id: 'o', kind: 'out', x: 3, y: 0 },
      ],
      [
        { from: 'a/c', to: 'm1/base' },
        { from: 'b/c', to: 'm1/top' },
        { from: 'c/c', to: 'm2/base' },
        { from: 'd/c', to: 'm2/top' },
        { from: 'm1/c', to: 'm3/base' },
        { from: 'm2/c', to: 'm3/top' },
        { from: 'm3/c', to: 'o/c' },
      ],
    );
    expect(many.error).toBeNull();
    expect(many.feedback).toBe(true);
  });

  it('folds a lens into the texture read, like any other picture', () => {
    // The trail everybody actually wants is the previous frame read slightly
    // zoomed and added back. If that needed a pass it would need a buffer per
    // step; because a colour is a function of a point, it is one sample of the
    // history at a moved point.
    const built = trail(
      [
        { id: 'l', kind: 'last', x: 0, y: 0 },
        { id: 'z', kind: 'lens', op: 'zoom', x: 1, y: 0 },
        { id: 'o', kind: 'out', x: 2, y: 0 },
      ],
      [
        { from: 'l/c', to: 'z/c' },
        { from: 'z/c', to: 'o/c' },
      ],
    );
    expect(bodyOf(built.source!)).toContain('fromLast(cZoom(centred(), 0.5)');
  });

  it('says nothing about feedback when a graph never asks for it', () => {
    expect(compileCircuit(starterCircuit()).feedback).toBe(false);
  });

  it('reports a last inside a nested flow, which reads the outer frame', () => {
    // There is one buffer and the sub-graph is pasted in, so a `last` down a
    // nesting reads the previous frame of the flow that reached the wall rather
    // than of the flow it was written in. Worth pinning: the alternative is a
    // buffer per flow node, which is the render-target-per-node design this
    // renderer exists instead of.
    const built = compileFlow(
      {
        trail: {
          name: 'trail',
          circuit: wire(
            [
              { id: 'l', kind: 'last', x: 0, y: 0 },
              { id: 'o', kind: 'out', x: 1, y: 0 },
            ],
            [{ from: 'l/c', to: 'o/c' }],
          ),
        },
        main: {
          name: 'main',
          circuit: wire(
            [
              { id: 'f', kind: 'flow', op: 'trail', x: 0, y: 0 },
              { id: 'o', kind: 'out', x: 1, y: 0 },
            ],
            [{ from: 'f/c', to: 'o/c' }],
          ),
        },
      },
      'main',
    );
    expect(built.error).toBeNull();
    expect(built.feedback).toBe(true);
    expect(bodyOf(built.source!)).toContain('fromLast(');
  });
});

describe('a picture can be a number now', () => {
  const reading = (op: string, cords: Circuit['cords'] = []) => {
    const built = compileCircuit(
      wire(
        [
          { id: 's', kind: 'source', op: 'plasma', x: 0, y: 0 },
          { id: 'r', kind: 'read', op, x: 1, y: 0 },
          { id: 'g', kind: 'grade', op: 'levels', x: 2, y: 0 },
          { id: 'o', kind: 'out', x: 3, y: 0 },
        ],
        [
          { from: 's/c', to: 'r/c' },
          { from: 's/c', to: 'g/c' },
          { from: 'r/n', to: 'g/gain' },
          { from: 'g/c', to: 'o/c' },
          ...cords,
        ],
      ),
    );
    expect(built.error).toBeNull();
    return bodyOf(built.source!);
  };

  it('divides the coverage back out, because every colour on the wire is premultiplied', () => {
    // A half-covered white pixel is vec4(0.5, 0.5, 0.5, 0.5), so reading .r raw
    // would call it grey. Luminance means the brightness you can SEE rather than
    // the brightness times how much of it is there.
    expect(reading('luma')).toMatch(/clamp\(fxLuma\(v\d+\.rgb \/ max\(v\d+\.a, 1e-4\)\), 0.0, 1.0\)/);
    expect(reading('red')).toMatch(/clamp\(v\d+\.r \/ max\(v\d+\.a, 1e-4\), 0.0, 1.0\)/);
  });

  it('does not divide when the coverage is the thing being asked about', () => {
    expect(reading('alpha')).toMatch(/clamp\(v\d+\.a, 0.0, 1.0\)/);
  });

  it('measures where the point inlet says, and at this fragment unwired', () => {
    // Unwired it is the point being drawn, which makes a read a per-pixel fact
    // about the picture. Wired to a `place` it is one spot, which makes it one
    // number for the whole frame — the difference between footage driving its
    // own hue and footage driving the whole show's brightness.
    expect(reading('luma')).toContain('gen_plasma(centred()');

    const built = compileCircuit(
      wire(
        [
          { id: 's', kind: 'source', op: 'plasma', x: 0, y: 0 },
          { id: 'pl', kind: 'place', x: 0, y: 1 },
          { id: 'r', kind: 'read', op: 'luma', x: 1, y: 0 },
          { id: 'g', kind: 'grade', op: 'levels', x: 2, y: 0 },
          { id: 'o', kind: 'out', x: 3, y: 0 },
        ],
        [
          { from: 's/c', to: 'r/c' },
          { from: 'pl/p', to: 'r/p' },
          { from: 's/c', to: 'g/c' },
          { from: 'r/n', to: 'g/gain' },
          { from: 'g/c', to: 'o/c' },
        ],
      ),
    );
    expect(built.error).toBeNull();
    // The same source, evaluated twice: once at the fragment for the picture
    // being graded, and once at the placed point for the number grading it.
    const body = bodyOf(built.source!);
    expect(body).toContain('gen_plasma(centred()');
    expect(body).toMatch(/gen_plasma\(v\d+,/);
    expect(body).toContain('recentred(vec2(');
  });

  it('refuses a picture whose own reading moves it', () => {
    // A real loop rather than a conservative refusal: the lens's colour outlet
    // reads its own `by`, so the number and the picture are the same trip round.
    // The way to say this legally is across a frame, with `last`.
    const built = compileCircuit(
      wire(
        [
          { id: 's', kind: 'source', op: 'plasma', x: 0, y: 0 },
          { id: 'l', kind: 'lens', op: 'zoom', x: 1, y: 0 },
          { id: 'r', kind: 'read', op: 'luma', x: 2, y: 0 },
          { id: 'o', kind: 'out', x: 3, y: 0 },
        ],
        [
          { from: 's/c', to: 'l/c' },
          { from: 'l/c', to: 'r/c' },
          { from: 'r/n', to: 'l/by' },
          { from: 'l/c', to: 'o/c' },
        ],
      ),
    );
    expect(built.error).toContain('feeds itself');
  });
});

describe('a point moved by what a picture says', () => {
  const displaced = (op: string) => {
    const built = compileCircuit(
      wire(
        [
          { id: 'f', kind: 'field', op: 'clouds', x: 0, y: 1 },
          { id: 'd', kind: 'displace', op, x: 1, y: 0 },
          { id: 's', kind: 'source', op: 'plasma', x: 2, y: 0 },
          { id: 'o', kind: 'out', x: 3, y: 0 },
        ],
        [
          { from: 'f/c', to: 'd/field' },
          { from: 'd/p', to: 's/p' },
          { from: 's/c', to: 'o/c' },
        ],
      ),
    );
    expect(built.error).toBeNull();
    return bodyOf(built.source!);
  };

  it('reads the field at the point being displaced', () => {
    // Not at the point this evaluation happens to be at, which is the difference
    // between a field that travels with a lens in front of it and one nailed to
    // the frame while the picture slides underneath.
    expect(displaced('curl')).toMatch(/fxDisplaceCurl\(centred\(\), v\d+, 0.3\)/);
    expect(displaced('map')).toMatch(/fxDisplaceMap\(centred\(\), v\d+, 0.3\)/);
  });

  it('keeps every cord across a mode flick, because both modes take the same number', () => {
    // The substitution rule, and the reason these are two modes rather than two
    // kinds: flicking between them with the picture up moves nothing. What
    // changes is how the field is READ.
    const named = (op: string) =>
      inletsOf({ id: 'd', kind: 'displace', op, x: 0, y: 0 }).map((port) => port.name);
    expect(named('map')).toEqual(named('curl'));
    expect(named('map')).toEqual(['p', 'field', 'amount']);
  });

  it('refuses a picture displaced by itself', () => {
    const built = compileCircuit(
      wire(
        [
          { id: 'd', kind: 'displace', op: 'curl', x: 1, y: 0 },
          { id: 'v', kind: 'source', op: 'plasma', x: 2, y: 0 },
          { id: 'o', kind: 'out', x: 3, y: 0 },
        ],
        [
          { from: 'v/c', to: 'd/field' },
          { from: 'd/p', to: 'v/p' },
          { from: 'v/c', to: 'o/c' },
        ],
      ),
    );
    expect(built.error).toContain('feeds itself');
  });
});

describe('a screen that keeps the picture', () => {
  const screened = (op: string) => {
    const built = compileCircuit(
      wire(
        [
          { id: 's', kind: 'source', op: 'plasma', x: 0, y: 0 },
          { id: 'h', kind: 'halftone', op, x: 1, y: 0 },
          { id: 'o', kind: 'out', x: 2, y: 0 },
        ],
        [
          { from: 's/c', to: 'h/c' },
          { from: 'h/c', to: 'o/c' },
        ],
      ),
    );
    expect(built.error).toBeNull();
    return bodyOf(built.source!);
  };

  it('lays its screen across the frame rather than across a point it was handed', () => {
    // `c.at` and not a `p` inlet. A screen that could be moved independently of
    // the picture under it would slide the dots off the content they are made
    // of, which is the one thing a halftone must not do.
    expect(screened('dots')).toMatch(/fxDots\(v\d+, centred\(\)/);
    expect(screened('lines')).toMatch(/fxLines\(v\d+, centred\(\)/);
    expect(screened('dither')).toMatch(/fxDither\(v\d+, centred\(\)/);
    expect(screened('scanlines')).toMatch(/fxScanlines\(v\d+, centred\(\)/);
  });

  it('gives a dither no angle to be turned to', () => {
    // A dither is an ordered matrix aligned to the frame. Turning it would be
    // turning the grid the threshold is defined on rather than turning a screen
    // laid over a picture, which is a different thing wearing the same word.
    const named = (op: string) =>
      inletsOf({ id: 'h', kind: 'halftone', op, x: 0, y: 0 }).map((port) => port.name);
    expect(named('dots')).toEqual(['c', 'size', 'tilt']);
    expect(named('dither')).toEqual(['c', 'size']);
  });

  it('dims a scanline where it carves a dot, and the difference is what they are', () => {
    // A screen decides whether there is ink here; a tube decides how brightly
    // this row is lit. Scanlines that carved holes would composite as lace over
    // whatever is under them.
    expect(screened('scanlines')).not.toContain('fxScreen');
  });
});

describe('at most one out, and none is a provider', () => {
  it('leaves a graph that arrived without one alone, and it still compiles', () => {
    // Repair used to invent an out here. A flow with none is a provider now —
    // its doors are `give` nodes — so an absent out is a design, not damage.
    const fixed = repaired(wire([{ id: 'g', kind: 'source', op: 'plasma', x: 200, y: 40 }], []));
    expect(fixed.nodes.filter((node) => node.kind === 'out')).toHaveLength(0);
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

describe('a flow with doors', () => {
  /**
   * A provider: no `out`, one number taken, one reactive number given. This is
   * the "pad energy" shape — all the reactivity wired once, inside, and one
   * named signal handed out for any other flow to use.
   */
  const doored = (): Record<string, FlowDef> => ({
    provider: {
      name: 'Pad energy',
      circuit: wire(
        [
          { id: 'beat', kind: 'playback', op: 'beat', x: 0, y: 0 },
          { id: 'amt', kind: 'take', label: 'depth', value: 0.25, x: 0, y: 1 },
          { id: 'm', kind: 'math', op: 'multiply', x: 1, y: 0 },
          { id: 'door', kind: 'give', op: 'number', label: 'pad energy', x: 2, y: 0 },
        ],
        [
          { from: 'beat/n', to: 'm/a' },
          { from: 'amt/n', to: 'm/b' },
          { from: 'm/n', to: 'door/in' },
        ],
      ),
    },
    main: {
      name: 'Main',
      circuit: wire(
        [
          { id: 'sub', kind: 'flow', op: 'provider', x: 0, y: 0, values: { depth: 0.9 } },
          { id: 'g', kind: 'source', op: 'plasma', x: 0, y: 1 },
          { id: 'e', kind: 'lens', op: 'ripple', x: 1, y: 0 },
          { id: 'o', kind: 'out', x: 2, y: 0 },
        ],
        [
          { from: 'g/c', to: 'e/c' },
          { from: 'sub/pad energy', to: 'e/depth' },
          { from: 'e/c', to: 'o/c' },
        ],
      ),
    },
  });

  it('reads the doors off the takes and gives inside', () => {
    const doors = flowDoors(doored().provider);
    expect(doors.takes).toEqual([
      {
        name: 'depth',
        kind: 'n',
        at: 0.25,
        nodeId: 'amt',
        description: 'The depth this flow takes.',
      },
    ]);
    expect(doors.gives.map((door) => ({ name: door.name, kind: door.kind }))).toEqual([
      { name: 'pad energy', kind: 'n' },
    ]);
  });

  it('skips a nameless door, a shadowing name, and the second claim on one', () => {
    const def: FlowDef = {
      name: 'Odd',
      circuit: wire(
        [
          { id: 'a', kind: 'take', label: '', x: 0, y: 0 },
          { id: 'b', kind: 'take', label: 'p', x: 0, y: 1 },
          { id: 'c1', kind: 'take', label: 'rate', value: 0.1, x: 0, y: 2 },
          { id: 'c2', kind: 'take', label: 'rate', value: 0.9, x: 0, y: 3 },
          { id: 'd', kind: 'give', op: 'number', label: 'c', x: 1, y: 0 },
        ],
        [],
      ),
    };
    const doors = flowDoors(def);
    expect(doors.takes.map((door) => door.nodeId)).toEqual(['c1']);
    expect(doors.gives).toEqual([]);
  });

  it('compiles a provider on its own: no out, an honest empty frame', () => {
    const built = compileFlow(doored(), 'provider');
    expect(built.error).toBeNull();
    expect(bodyOf(built.source!)).toContain('fragColor = vec4(0.0)');
  });

  it('hands a given signal to the parent, cut through to what feeds it', () => {
    const built = compileFlow(doored(), 'main');
    expect(built.error).toBeNull();
    // The ripple's depth arrives from the provider's own arithmetic — the
    // door itself has vanished from the flattened graph entirely.
    const flat = flatten(doored(), 'main').circuit;
    expect(flat.nodes.some((node) => node.kind === 'give')).toBe(false);
    expect(flat.cords).toContainEqual({ from: 'sub~m/n', to: 'e/depth' });
  });

  it('holds a taken number on the flow node, exactly like any inlet', () => {
    // Nothing wired into `sub/depth`, so the pasted take stands, carrying the
    // number held on the parent face — 0.9 — over its own resting 0.25.
    const built = compileFlow(doored(), 'main');
    expect(built.values.find((each) => each.id === 'sub~amt')?.value).toBe(0.9);
  });

  it('lets the parent drive a taken number, and the take steps aside', () => {
    const flows = doored();
    flows.main.circuit.nodes.push({ id: 'k', kind: 'value', value: 0.5, x: 0, y: 2 });
    flows.main.circuit.cords.push({ from: 'k/n', to: 'sub/depth' });
    const flat = flatten(flows, 'main').circuit;
    expect(flat.nodes.some((node) => node.id === 'sub~amt')).toBe(false);
    expect(flat.cords).toContainEqual({ from: 'k/n', to: 'sub~m/b' });
    expect(compileFlow(flows, 'main').error).toBeNull();
  });

  it('drops the read of a give nothing feeds, so the reader falls back', () => {
    const flows = doored();
    flows.provider.circuit.cords = flows.provider.circuit.cords.filter(
      (cord) => cord.to !== 'door/in',
    );
    const flat = flatten(flows, 'main').circuit;
    expect(flat.cords.some((cord) => cord.to === 'e/depth')).toBe(false);
    expect(compileFlow(flows, 'main').error).toBeNull();
  });

  it('answers a door cord at the file door instead of stripping it', () => {
    const flows = doored();
    const fixed = repaired(flows.main.circuit, flows);
    expect(fixed.cords).toContainEqual({ from: 'sub/pad energy', to: 'e/depth' });
    // Without the record the doors cannot be seen, and the cord is kept on
    // trust rather than deleted.
    expect(repaired(flows.main.circuit).cords).toContainEqual({
      from: 'sub/pad energy',
      to: 'e/depth',
    });
  });

  it('tells the canvas what a door carries, so wiring can be typed', () => {
    const flows = doored();
    expect(signalOf(flows.main.circuit, 'sub/pad energy', flows)).toBe('n');
    expect(signalOf(flows.main.circuit, 'sub/depth', flows)).toBe('n');
    expect(signalOf(flows.main.circuit, 'sub/p', flows)).toBe('p');
    expect(signalOf(flows.main.circuit, 'sub/nothing', flows)).toBeNull();
  });
});

describe('a flow inside a flow', () => {
  const library = (): Record<string, FlowDef> => ({
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
          { id: 'sub', kind: 'flow', op: 'inner', x: 0, y: 0 },
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
    const built = compileFlow(library(), 'outer');
    expect(built.error).toBeNull();
    expect(bodyOf(built.source!)).toContain('gen_rings(');
    expect(bodyOf(built.source!)).toContain('fxTwist(');
  });

  it('reads the whole sub-flow at the point wired into the node', () => {
    // The node advertised a point inlet, the canvas let you wire one, and the
    // expansion spliced the node out — so the cord was drawn across the screen
    // and addressed to a node that no longer existed. Nothing looked it up and
    // nothing on the wall moved, which is the worst thing an editor can do.
    const flows = library();
    flows.outer.circuit.nodes.push(
      { id: 'pt', kind: 'point', x: 0, y: 2 },
      { id: 'z', kind: 'lens', op: 'zoom', x: 0, y: 3 },
    );
    flows.outer.circuit.cords.push({ from: 'pt/p', to: 'z/p' }, { from: 'z/p', to: 'sub/p' });
    const built = compileFlow(flows, 'outer');
    expect(built.error).toBeNull();
    // The sub-flow's generator is evaluated at the zoomed point rather than at
    // the fragment's own, exactly as it would be inside one graph.
    expect(bodyOf(built.source!)).toMatch(/gen_rings\(v\d+,/);
    expect(bodyOf(built.source!)).toContain('cZoom(');
  });

  it('reads it where it is asked when nothing is wired into the node', () => {
    expect(bodyOf(compileFlow(library(), 'outer').source!)).toContain('gen_rings(fxTwist(');
  });

  it('gives a nested number a slot of its own', () => {
    // Flattening before compiling rather than teaching the compiler about
    // sub-flows is what keeps the compiler one thing: the banks fall out of the
    // expanded graph without a second pass to gather them.
    const built = compileFlow(library(), 'outer');
    expect(built.values).toHaveLength(1);
    expect(built.values[0].label).toBe('inner number');
  });

  it('prefixes ids so two copies of one flow cannot collide', () => {
    const flows = library();
    flows.two = {
      name: 'Two',
      circuit: wire(
        [
          { id: 'a', kind: 'flow', op: 'inner', x: 0, y: 0 },
          { id: 'b', kind: 'flow', op: 'inner', x: 0, y: 1 },
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
    const { circuit } = flatten(flows, 'two');
    expect(new Set(circuit.nodes.map((n) => n.id)).size).toBe(circuit.nodes.length);
    expect(compileFlow(flows, 'two').error).toBeNull();
  });

  it('draws nothing rather than failing when the flow it names is gone', () => {
    // A flow you deleted should make the thing that used it go quiet, not stop
    // the show.
    const flows = library();
    delete flows.inner;
    const built = compileFlow(flows, 'outer');
    expect(built.error).toBeNull();
  });

  it('refuses a loop before it is wired, not when it fails to compile', () => {
    // At compile time the honest message is "one of these seven flows contains
    // itself", which nobody can act on. At the moment of dropping, the message
    // is about the thing you just clicked.
    const flows = library();
    expect(wouldLoop(flows, 'inner', 'outer')).toBe(true);
    expect(wouldLoop(flows, 'outer', 'inner')).toBe(false);
    expect(wouldLoop(flows, 'inner', 'inner')).toBe(true);
  });

  it('says so rather than hanging when a loop got into a file anyway', () => {
    const flows = library();
    flows.inner.circuit.nodes.push({ id: 'back', kind: 'flow', op: 'outer', x: 2, y: 2 });
    flows.inner.circuit.cords.push({ from: 'back/c', to: 'o/c' });
    expect(compileFlow(flows, 'outer').error).toMatch(/contains itself/);
  });
});

describe('the circuit a new flow opens with', () => {
  it('does not draw two of its nodes on top of each other', () => {
    // It is the first thing anybody sees of the node graph, and it used to
    // open with the value node drawn over the source above it. 176 wide and
    // 224 tall is what a node takes up; `ui/nodes.ts` places against the same.
    const nodes = starterCircuit().nodes;
    const hits: string[] = [];
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        if (a.x < b.x + 176 && a.x + 176 > b.x && a.y < b.y + 224 && a.y + 224 > b.y) {
          hits.push(`${a.id} over ${b.id}`);
        }
      }
    expect(hits).toEqual([]);
  });
});

describe('turning a node off', () => {
  const wire = (nodes: unknown[], cords: unknown[]) => ({ nodes, cords }) as never;

  it('passes straight through where the signal is unchanged', () => {
    // A lens takes a colour and gives a colour, so off means the picture it was
    // handed carries on untouched and the flow is whole with one step skipped.
    const node = { id: 'e', kind: 'lens', op: 'ripple', bypassed: true, x: 0, y: 0 } as never;
    expect(outletGivesNothing(node, 'c')).toBe(false);
  });

  it('gives nothing where the signal changes on the way through', () => {
    // A glow takes a number and gives a colour. There is nothing to pass, so
    // off breaks the chain rather than shorting it.
    const node = { id: 'g', kind: 'glow', op: 'neon', bypassed: true, x: 0, y: 0 } as never;
    expect(outletGivesNothing(node, 'c')).toBe(true);
  });

  it('leaves what fed a silenced node doing nothing, and says so', () => {
    // The consequence a person is meant to see: switch the glow off and the
    // circle feeding it is no longer reaching anywhere.
    const off = wire(
      [
        { id: 'c', kind: 'figure', op: 'circle', x: 0, y: 0 },
        { id: 'g', kind: 'glow', op: 'neon', bypassed: true, x: 1, y: 0 },
        { id: 'o', kind: 'out', x: 2, y: 0 },
      ],
      [
        { from: 'c/d', to: 'g/d' },
        { from: 'g/c', to: 'o/c' },
      ],
    );
    expect([...strandedNodes(off)]).toContain('c');
  });

  it('leaves nothing stranded when the same flow is switched back on', () => {
    const on = wire(
      [
        { id: 'c', kind: 'figure', op: 'circle', x: 0, y: 0 },
        { id: 'g', kind: 'glow', op: 'neon', x: 1, y: 0 },
        { id: 'o', kind: 'out', x: 2, y: 0 },
      ],
      [
        { from: 'c/d', to: 'g/d' },
        { from: 'g/c', to: 'o/c' },
      ],
    );
    expect([...strandedNodes(on)]).toEqual([]);
  });

  it('offers the switch on everything except the destination', () => {
    for (const kind of ['source', 'glow', 'lens', 'figure', 'value', 'blend'] as const) {
      expect(canTurnOff({ id: 'n', kind, x: 0, y: 0 } as never)).toBe(true);
    }
    expect(canTurnOff({ id: 'o', kind: 'out', x: 0, y: 0 } as never)).toBe(false);
  });
});
