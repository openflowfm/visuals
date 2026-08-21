import { describe, expect, it } from 'vitest';
import type { Scheme } from '../../protocol.ts';
import { EFFECTS, NODE_FAMILIES } from '../../protocol.ts';
import { BUILT_IN } from '../../server/scheme.ts';
import { bareCircuit } from '../render/circuit.ts';
import { drop, matching, palette, type Entry } from './nodes.ts';

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
const browser = (tracks: readonly string[] = ['Bass', 'Drums', 'master']) =>
  palette(scheme, tracks);
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
    expect(named.map((each) => each.node.op)).toEqual(['Bass', 'MIDI', 'master']);
  });

  it('gives every row a key nothing else in the browser shares', () => {
    // The browser renders one child per row, and React keys them by kind and
    // mode. A duplicate is not cosmetic: children under one key may be
    // duplicated or omitted, which is a node you cannot drop.
    const keys = browser(['Bass', 'MIDI', 'MIDI', 'master']).map(
      (each) => `${each.node.kind}:${each.node.op ?? ''}`,
    );
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

  it('leaves a track and a look expanded, because those are targets', () => {
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
    const looks = browser().filter((each) => each.node.kind === 'look');
    expect(looks.length).toBe(Object.keys(scheme.looks).length);
  });

  it('offers every kind in the vocabulary except the one that is a trap', () => {
    // The browser is built from the vocabulary, so a kind that fell out of it
    // in a restructure is a node nobody can reach and nothing else would say.
    const reachable = new Set(browser().map((each) => each.node.kind));
    for (const family of NODE_FAMILIES) {
      for (const kind of family.kinds) {
        expect(reachable.has(kind), kind).toBe(kind !== 'out');
      }
    }
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
    expect(hit.map((each) => each.node.op)).toEqual(['Bass']);
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

describe('dropping one', () => {
  it('gives a bare node its defaults and a preset its values', () => {
    // A preset is a mode *and* the values that make that mode read. Posterize
    // at the middle of its knob is eight steps, which on a projector is
    // invisible — an effect you drop should do the thing it is named after.
    const effect = find(browser(), 'effect')!;
    const plain = drop(bareCircuit(), effect.node).nodes.at(-1)!;
    // Spelled out rather than implied, so the face and its dropdown agree.
    expect(plain.op).toBe(EFFECTS[0]);
    expect(plain.knobs).toBeUndefined();

    const poster = effect.presets.find((each) => each.op === 'posterize')!;
    const dropped = drop(bareCircuit(), poster).nodes.at(-1)!;
    expect(dropped.op).toBe('posterize');
    expect(dropped.knobs?.levels).toBeGreaterThan(0.5);
  });

  it('gives each dropped preset its own values', () => {
    // Two nodes off one preset sharing a map is one knob turning both of them,
    // which reads as the canvas editing a node nobody has touched.
    const poster = find(browser(), 'effect')!.presets.find((each) => each.op === 'posterize')!;
    const once = drop(bareCircuit(), poster);
    const twice = drop(once, poster);
    const [a, b] = twice.nodes.filter((node) => node.kind === 'effect');
    expect(a.knobs).not.toBe(b.knobs);
  });
});
