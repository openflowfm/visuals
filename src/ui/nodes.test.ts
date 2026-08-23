import { describe, expect, it } from 'vitest';
import type { Scheme } from '../../protocol.ts';
import { GRADE_MODES, NODE_FAMILIES } from '../../protocol.ts';
import { BUILT_IN } from '../../server/scheme.ts';
import { bareCircuit } from '../render/circuit.ts';
import {
  drop,
  flowShelf,
  keyOf,
  matching,
  matchingFlows,
  palette,
  pickOf,
  signatureOf,
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

const scheme = BUILT_IN as Scheme;
const browser = (tracks: readonly string[] = ['Bass', 'Drums', 'master']) => palette(tracks);
const find = (entries: readonly Entry[], kind: string, op?: string) =>
  entries.find((each) => each.node.kind === kind && (op === undefined || each.node.op === op));

describe('what the browser lists', () => {
  it('lists a track name once however many tracks carry it', () => {
    // A real set has five tracks called `MIDI`. A `track` node addresses a
    // track by name, so five of them are one target — and five rows meant five
    // chips that did the same thing under the same React key, which warned
    // about once a second for as long as the designer was open.
    const entries = browser(['Bass', 'MIDI', 'MIDI', 'MIDI', 'master']);
    const named = entries.filter((each) => each.node.kind === 'track');
    expect(named.map((each) => each.node.of)).toEqual(['Bass', 'MIDI', 'master']);
  });

  it('gives every row a key nothing else in the browser shares', () => {
    // The browser renders one child per row, and React keys them by `keyOf`.
    // A duplicate is not cosmetic: children under one key may be duplicated or
    // omitted, which is a node you cannot drop. It caught the merge that gave
    // every `track` row the same mode — three rows spelling `track:level`.
    const keys = browser(['Bass', 'MIDI', 'MIDI', 'master']).map((each) => keyOf(each.node));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('lists the node once, with its modes as presets under it', () => {
    // It used to list eleven pictures and never mention the node they were, so
    // what you got on the canvas was a node you had not chosen with a mode
    // already set — a browser of presets pretending to be a browser of things.
    const sources = browser().filter((each) => each.node.kind === 'source');
    expect(sources).toHaveLength(1);
    expect(sources[0].node.op).toBeUndefined();
    expect(sources[0].presets.map((each) => each.op)).toContain('plasma');
    expect(sources[0].presets.length).toBeGreaterThan(10);
  });

  it('leaves a track expanded, because a track name is a target', () => {
    // Collapsing "Bass meter" under a generic `track` node is the same mistake
    // in reverse: a track name is an instance of something in the set rather
    // than a way of being a node, and it is the one thing in this browser that
    // nobody could guess.
    const tracks = browser().filter((each) => each.node.kind === 'track');
    expect(tracks.map((each) => each.node.label)).toEqual([
      'Bass meter',
      'Drums meter',
      'master meter',
    ]);
    for (const each of tracks) expect(each.presets).toEqual([]);
  });

  it('lists no flows, because a flow is not one of these', () => {
    // Every flow in the library used to be a row here, under `draw`, in the
    // same chip as `source` and `paint` — so a graph of sixteen nodes and a
    // shipped shader were the same object to anyone reading the column. That is
    // the whole of what this browser got wrong, and it is why `The set`, a flow
    // that was one `tracks` node, read as a kind of node.
    expect(browser().filter((each) => each.node.kind === 'flow')).toEqual([]);
  });

  it('says what each node takes and gives, so a cord can be aimed', () => {
    // The metadata column, and it is this rather than a category because it is
    // the question you have *before* you drop something.
    expect(signatureOf('point')).toBe('→ p');
    expect(signatureOf('source')).toBe('p n → c');
    expect(signatureOf('math')).toBe('n → n');
    expect(signatureOf('out')).toBe('c →');
    // The flattener's own inlet is hidden here exactly as the canvas hides it.
    expect(signatureOf('flow')).toBe('p → c');
  });

  it('offers every kind in the vocabulary except the two that are not rows', () => {
    // The browser is built from the vocabulary, so a kind that fell out of it
    // in a restructure is a node nobody can reach and nothing else would say.
    // `out` arrives with the flow and cannot be deleted; `flow` has a shelf.
    const reachable = new Set(browser().map((each) => each.node.kind));
    const shelved = new Set(['out', 'flow']);
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
    // The rows read `sine` and `key` now that they sit under `wave` and `song`,
    // but everyone who has used this once types the old two-word name.
    expect(matching(browser(), 'sine wave')[0].presets[0].op).toBe('sine');
    expect(matching(browser(), 'song key')[0].presets[0].op).toBe('key');
  });

  it('finds a track by its name in the set', () => {
    const hit = matching(browser(), 'bass');
    expect(hit.map((each) => each.node.of)).toEqual(['Bass']);
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
