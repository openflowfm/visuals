import { describe, expect, it } from 'vitest';
import type { Scheme } from '../../protocol.ts';
import {
  FIELD_MODES,
  FRACTAL_MODES,
  LIGHT_MODES,
  LFO_SHAPES,
  GRADE_MODES,
  NODE_FAMILIES,
  SOURCES,
  TRACK_DRAWS,
} from '../../protocol.ts';
import { EXAMPLES } from '../../server/scheme.ts';
import {
  NODE_SPECS,
  descriptionOf,
  inletsOf,
  modesOf,
  bareCircuit,
} from '../render/circuit.ts';
import {
  drop,
  flowShelf,
  keyOf,
  matching,
  matchingFlows,
  palette,
  pickOf,
  passes,
  portsOf,
  swapEntry,
  type Entry,
} from './nodes.ts';

/**
 * The node browser.
 *
 * It lists **the node**, with presets under it, the way a device browser does —
 * and the thing that has to keep working across that change is the thing the
 * flat list of modes was built for: nobody should have to know that `plasma` is
 * a `source` with a mode set, or that a track's meter is a `track` node, to find
 * either one. So most of what is asserted here is about the search box, because
 * search is what pays for the presets being folded away.
 */

const scheme = EXAMPLES as Scheme;
const browser = () => palette();
const bySignal = (a: string, b: string) => 'pnc'.indexOf(a) - 'pnc'.indexOf(b);
const find = (entries: readonly Entry[], kind: string, op?: string) =>
  entries.find((each) => each.node.kind === kind && (op === undefined || each.node.op === op));

describe('the documented vocabulary', () => {
  it('documents every node, every mode, and every port that can appear', () => {
    // Documentation is part of the executable registry rather than a table in
    // the browser. Walking every mode matters: a lens's ports belong to its
    // mode, so checking only the default would let `ripple/depth` disappear
    // from the reference without anything failing.
    for (const family of NODE_FAMILIES) {
      for (const kind of family.kinds) {
        const spec = NODE_SPECS[kind];
        expect(spec.description.trim(), `${kind} description`).not.toBe('');
        const modes = spec.modes ?? [];
        expect(new Set(modes.map((mode) => mode.name)).size, `${kind} duplicate modes`).toBe(
          modes.length,
        );
        for (const mode of modes) {
          expect(mode.description.trim(), `${kind}/${mode.name} description`).not.toBe('');
        }
        const variants = modes.length > 0 ? modes.map((mode) => mode.name) : [undefined];
        for (const op of variants) {
          const node = { id: kind, kind, op, x: 0, y: 0 };
          for (const port of [...inletsOf(node), ...spec.outlets]) {
            expect(
              port.description.trim(),
              `${kind}${op ? `/${op}` : ''}/${port.name} description`,
            ).not.toBe('');
          }
        }
      }
    }
  });

  it('hands the same mode documentation to search and the browser', () => {
    const kaleido = find(browser(), 'lens')?.presets.find((preset) => preset.op === 'kaleido');
    expect(kaleido?.about).toBe(descriptionOf('lens', 'kaleido'));
    expect(kaleido?.terms).toContain('wedges');
    expect(modesOf('lens')).toContain('kaleido');
  });
});

describe('what the browser lists', () => {
  it('gives every row a key nothing else in the browser shares', () => {
    // The browser renders one child per row, and React keys them by `keyOf`.
    // A duplicate is not cosmetic: children under one key may be duplicated or
    // omitted, which is a node you cannot drop. It caught the merge that gave
    // every `track` row the same mode — three rows spelling `track:level`.
    const keys = browser().map((each) => keyOf(each.node));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('lists the node once, with its modes as presets under it', () => {
    // It used to list eleven pictures and never mention the node they were, so
    // what you got on the canvas was a node you had not chosen with a mode
    // already set — a browser of presets pretending to be a browser of things.
    const sources = browser().filter((each) => each.node.kind === 'source');
    expect(sources).toHaveLength(1);
    expect(sources[0].node.op).toBeUndefined();
    expect(sources[0].presets.map((each) => each.op)).toEqual(SOURCES);

    const fields = browser().filter((each) => each.node.kind === 'field');
    expect(fields).toHaveLength(1);
    expect(fields[0].presets.map((each) => each.op)).toEqual(FIELD_MODES);

    const fractals = browser().filter((each) => each.node.kind === 'fractal');
    expect(fractals).toHaveLength(1);
    expect(fractals[0].presets.map((each) => each.op)).toEqual(FRACTAL_MODES);

    const lights = browser().filter((each) => each.node.kind === 'light');
    expect(lights).toHaveLength(1);
    expect(lights[0].presets.map((each) => each.op)).toEqual(LIGHT_MODES);

    const lfos = browser().filter((each) => each.node.kind === 'lfo');
    expect(lfos).toHaveLength(1);
    expect(lfos[0].presets.map((each) => each.op)).toEqual(LFO_SHAPES);
  });

  it('does not offer an iterative fractal once per playing track', () => {
    // `tracks` draws its selected mode once per active Live track. Keeping the
    // dedicated fractal out of that list is the first GPU guard, not a browser
    // preference: an eight-track set must not turn one orbit into eight.
    expect(TRACK_DRAWS).not.toContain('mandelbrot');
    expect(TRACK_DRAWS).not.toContain('julia');
    for (const mode of FIELD_MODES) expect(TRACK_DRAWS).not.toContain(mode);
    for (const mode of LIGHT_MODES) expect(TRACK_DRAWS).not.toContain(mode);
  });

  it('lists no flows, because a flow is not one of these', () => {
    // Every flow in the library used to be a row here, under `draw`, in the
    // same chip as `source` and `colorway` — so a graph of sixteen nodes and a
    // shipped shader were the same object to anyone reading the column. That is
    // the whole of what this browser got wrong, and it is why `The set`, a flow
    // that was one `tracks` node, read as a kind of node.
    expect(browser().filter((each) => each.node.kind === 'flow')).toEqual([]);
  });

  it('says what each node takes and gives, so a cord can be aimed', () => {
    // The metadata column, and it is this rather than a category because it is
    // the question you have *before* you drop something.
    expect(portsOf('point')).toEqual({ takes: [], gives: ['p'] });
    expect(portsOf('source')).toEqual({ takes: ['p', 'n'], gives: ['c'] });
    expect(portsOf('fractal')).toEqual({ takes: ['p', 'n'], gives: ['c'] });
    expect(portsOf('light')).toEqual({ takes: ['p', 'n'], gives: ['c'] });
    expect(portsOf('video')).toEqual({ takes: ['p', 'n'], gives: ['c'] });
    expect(portsOf('math')).toEqual({ takes: ['n'], gives: ['n'] });
    expect(portsOf('out')).toEqual({ takes: ['c'], gives: [] });
    // The flattener's own inlet is hidden here exactly as the canvas hides it.
    expect(portsOf('flow')).toEqual({ takes: ['p'], gives: ['c'] });
  });

  it('always lists signals in p n c order, whatever order the ports are in', () => {
    // The browser draws all six positions on every row and dims what is not
    // there. A signature whose letters moved about row to row would be
    // unreadable as a column, which is the whole reason it is a fixed grid.
    for (const family of NODE_FAMILIES) {
      for (const kind of family.kinds) {
        const ports = portsOf(kind);
        for (const side of [ports.takes, ports.gives]) {
          expect([...side].sort(bySignal), kind).toEqual([...side]);
        }
      }
    }
  });

  it('lists one track row, not one per track in the set', () => {
    // It was one each, on the argument that a name from the set is the thing
    // nobody could guess — which is the search box's job, not the list's. A set
    // with twenty-six tracks buried `playback` and `song` under twenty-six
    // near-identical rows, and the node has carried a chooser the whole time.
    const rows = browser().filter((each) => each.node.kind === 'track');
    expect(rows).toHaveLength(1);
    expect(rows[0].node.label).toBe('track');
    expect(rows[0].node.of).toBeUndefined();
  });

  it('offers every kind in the vocabulary except the one with a shelf', () => {
    // The browser is built from the vocabulary, so a kind that fell out of it
    // in a restructure is a node nobody can reach and nothing else would say.
    // `flow` has a shelf of its own; `out` is a row again now that deleting
    // it is legal and the browser is the way back.
    const reachable = new Set(browser().map((each) => each.node.kind));
    const shelved = new Set(['flow']);
    for (const family of NODE_FAMILIES) {
      for (const kind of family.kinds) {
        expect(reachable.has(kind), kind).toBe(!shelved.has(kind));
      }
    }
  });
});

describe('the flow shelf', () => {
  /**
   * The second shelf, and the reason there are two.
   *
   * A flow is a composite and a node is a primitive, and the browser has to say
   * which is which before you drop one — which is exactly what it did not do
   * when both were chips in one list.
   */
  it('lists every flow in the library, once each', () => {
    const rows = flowShelf(scheme);
    expect(rows.map((each) => each.id).sort()).toEqual(Object.keys(scheme.flows).sort());
    expect(new Set(rows.map((each) => each.id)).size).toBe(rows.length);
  });

  it('says how many nodes are inside, which is what a primitive cannot', () => {
    const folded = flowShelf(scheme).find((each) => each.id === 'folded')!;
    expect(folded.size).toBe(scheme.flows.folded.circuit.nodes.length);
    expect(folded.about).toMatch(/^\d+ nodes/);
    expect(folded.about).toContain('reads the set');
    // `The lot` is three flows in a trench coat, and the row has to warn you.
    expect(flowShelf(scheme).find((each) => each.id === 'lot')!.about).toContain('flows inside');
  });

  it('answers the same search box the nodes do', () => {
    // Pulling flows out of the node palette would have made them harder to find
    // than they were, which is the opposite of the point, so one box reaches
    // both shelves.
    expect(matchingFlows(flowShelf(scheme), 'outl').map((each) => each.id)).toEqual(['outline']);
    expect(matchingFlows(flowShelf(scheme), 'trombone')).toEqual([]);
    expect(matchingFlows(flowShelf(scheme), '')).toHaveLength(Object.keys(scheme.flows).length);
  });

  it('becomes a flow node when placed, pointing at itself by id', () => {
    const row = flowShelf(scheme).find((each) => each.id === 'outline')!;
    const dropped = drop(bareCircuit(), pickOf(row)).nodes.at(-1)!;
    expect(dropped.kind).toBe('flow');
    expect(dropped.op).toBe('outline');
  });
});

describe('finding one', () => {
  it('finds a preset by its own name, and keeps only that one', () => {
    // Typing `spark` has to give one row rather than a `source` you then have
    // to go looking inside — the presets being folded away is only affordable
    // because search reaches through them.
    const hit = matching(browser(), 'spark');
    expect(hit).toHaveLength(1);
    expect(hit[0].node.kind).toBe('source');
    expect(hit[0].presets.map((each) => each.op)).toEqual(['sparks']);
  });

  it('finds a preset by the compound name it used to be listed under', () => {
    // The rows read `sine` and `key` now that they sit under `lfo` and `song`,
    // but everyone who has used this once types the old two-word name — and
    // `sine wave` has to go on working now that the `wave` node is an lfo.
    expect(matching(browser(), 'sine wave')[0].presets[0].op).toBe('sine');
    expect(matching(browser(), 'song key')[0].presets[0].op).toBe('key');
  });

  it('narrows to what a cord in your hand can reach', () => {
    // The other half of finding a node, and the half nothing could ask before:
    // the search box answers "what is it called" and this answers "what will
    // connect". Holding a `p` outlet and wanting somewhere to put it is a
    // question about ports rather than about names.
    const takesPoint = matching(browser(), '', { takes: ['p'], gives: [] });
    expect(takesPoint.every((each) => each.node.ports.takes.includes('p'))).toBe(true);
    expect(takesPoint.some((each) => each.node.kind === 'source')).toBe(true);
    expect(takesPoint.some((each) => each.node.kind === 'math')).toBe(false);

    // Selected signals are required rather than allowed, so two ticks narrow.
    const both = matching(browser(), '', { takes: ['p'], gives: ['n'] });
    expect(both.map((each) => each.node.kind)).toContain('polar');
    expect(both.map((each) => each.node.kind)).not.toContain('source');
  });

  it('reads the search box and the filter together', () => {
    const hits = matching(browser(), 'lens', { takes: ['p'], gives: [] });
    expect(hits.map((each) => each.node.kind)).toEqual(['form', 'lens']);
    expect(hits[0].presets.map((each) => each.op)).toEqual(['iris']);
    // Both `lens` and the lens-shaped iris form give a colour and no number, so
    // asking for a number outlet narrows both away even though the word matches.
    expect(matching(browser(), 'lens', { takes: ['p'], gives: ['n'] })).toEqual([]);
  });

  it('keeps flows on the shelf only when the filter can reach one', () => {
    // A flow compiles to a `flow` node, so it has that node's ports. One set of
    // controls over two shelves, or the controls are lying about their reach.
    const rows = flowShelf(scheme);
    expect(matchingFlows(rows, '', { takes: ['p'], gives: ['c'] })).toHaveLength(rows.length);
    expect(matchingFlows(rows, '', { takes: ['n'], gives: [] })).toEqual([]);
  });

  it('lets everything through when nothing is asked', () => {
    expect(passes(portsOf('math'), { takes: [], gives: [] })).toBe(true);
    expect(passes(portsOf('math'), { takes: ['c'], gives: [] })).toBe(false);
  });

  it('keeps everything under a node when the node itself matches', () => {
    const hit = matching(browser(), 'effect');
    expect(hit).toHaveLength(1);
    expect(hit[0].presets.map((each) => each.op)).toContain('kaleido');
  });

  it('says nothing rather than everything when nothing matches', () => {
    expect(matching(browser(), 'trombone')).toEqual([]);
  });
});

describe('hot-swapping one', () => {
  it('offers a track reading once rather than repeating every track target', () => {
    const entry = swapEntry('track')!;
    expect(entry.node.label).toBe('track');
    expect(entry.presets.map((each) => each.op)).toEqual(['level', 'fader', 'playing']);
    expect(entry.presets.every((each) => each.of === undefined)).toBe(true);
  });

  it('offers the modes deliberately folded out of the add browser', () => {
    expect(swapEntry('tracks')?.presets.map((each) => each.op)).toContain('plasma');
  });

  it('keeps a preset value with the mode that owns it', () => {
    const poster = swapEntry('grade')?.presets.find((each) => each.op === 'posterize');
    expect(poster?.values?.steps).toBeGreaterThan(0.5);
  });

  it('has nothing to swap on a kind with no modes', () => {
    expect(swapEntry('point')).toBeNull();
  });
});

describe('dropping one', () => {
  it('gives a bare node its defaults and a preset its values', () => {
    // A preset is a mode *and* the values that make that mode read. Posterize
    // at the middle of its one number is eight steps, which on a projector is
    // invisible — an effect you drop should do the thing it is named after.
    const grade = find(browser(), 'grade')!;
    const plain = drop(bareCircuit(), grade.node).nodes.at(-1)!;
    // Spelled out rather than implied, so the face and its dropdown agree.
    expect(plain.op).toBe(GRADE_MODES[0]);
    expect(plain.values).toBeUndefined();

    const poster = grade.presets.find((each) => each.op === 'posterize')!;
    const dropped = drop(bareCircuit(), poster).nodes.at(-1)!;
    expect(dropped.op).toBe('posterize');
    expect(dropped.values?.steps).toBeGreaterThan(0.5);
  });

  it('gives each dropped preset its own values', () => {
    // Two nodes off one preset sharing a map is one control turning both of them,
    // which reads as the canvas editing a node nobody has touched.
    const poster = find(browser(), 'grade')!.presets.find((each) => each.op === 'posterize')!;
    const once = drop(bareCircuit(), poster);
    const twice = drop(once, poster);
    const [a, b] = twice.nodes.filter((node) => node.kind === 'grade');
    expect(a.values).not.toBe(b.values);
  });
});

describe('dropping a node on the canvas', () => {
  const boxes = (circuit: { nodes: { x: number; y: number }[] }) => circuit.nodes;
  const overlapping = (circuit: { nodes: { x: number; y: number }[] }) => {
    // The same box the placement uses: 176 wide, and the tallest a node gets.
    const hits: string[] = [];
    const n = boxes(circuit);
    for (let i = 0; i < n.length; i++)
      for (let j = i + 1; j < n.length; j++)
        if (
          n[i].x < n[j].x + 176 &&
          n[i].x + 176 > n[j].x &&
          n[i].y < n[j].y + 224 &&
          n[i].y + 224 > n[j].y
        )
          hits.push(`${i}∩${j}`);
    return hits;
  };

  const add = (circuit: { nodes: unknown[]; cords: unknown[] }, times: number) => {
    let held = circuit;
    for (let i = 0; i < times; i++) held = drop(held as never, { kind: 'source', op: 'plasma', label: 'plasma' } as never);
    return held;
  };

  it('never lands a node on one that is already there', () => {
    const grown = add({ nodes: [], cords: [] }, 12) as never as { nodes: { x: number; y: number }[] };
    expect(overlapping(grown)).toEqual([]);
    expect(grown.nodes).toHaveLength(12);
  });

  it('steps past a slot somebody has dragged a node into', () => {
    // The old rule was the node count laid out four to a row, which is only
    // free on a canvas nobody has touched. One node parked on the second slot
    // used to be enough to have the next drop land under it.
    const parked = { nodes: [{ id: 'a', kind: 'source', x: 260, y: 60 }], cords: [] };
    const after = drop(parked as never, { kind: 'source', op: 'plasma', label: 'plasma' } as never);
    const placed = after.nodes[after.nodes.length - 1];
    expect(overlapping(after as never as { nodes: { x: number; y: number }[] })).toEqual([]);
    expect({ x: placed.x, y: placed.y }).not.toEqual({ x: 260, y: 60 });
  });

  it('still places somewhere rather than giving up', () => {
    // A palette click that does nothing is worse than a node to drag.
    const crowded = { nodes: Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, kind: 'source', x: 60 + (i % 4) * 200, y: 60 + Math.floor(i / 4) * 240 })), cords: [] };
    const after = drop(crowded as never, { kind: 'source', op: 'plasma', label: 'plasma' } as never);
    expect(after.nodes).toHaveLength(41);
  });
});
