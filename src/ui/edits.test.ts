import { describe, expect, it } from 'vitest';
import type { Circuit, Scheme } from '../../protocol.ts';
import { BUILT_IN } from '../../server/scheme.ts';
import { inletsOf, starterCircuit } from '../render/circuit.ts';
import { dropNode, forkLook, setKnob, setNode } from './edits.ts';
import { palette } from './nodes.ts';

/**
 * What a gesture on the canvas does to a graph.
 *
 * These are the edits, and the reason they are worth tests of their own is that
 * every one of them is invisible: nothing here renders, so a cord left pointing
 * at nothing or a node quietly removed does not fail — it just makes the picture
 * wrong later, on a machine with a projector attached to it.
 */

const wire = (nodes: Circuit['nodes'], cords: Circuit['cords']): Circuit => ({ nodes, cords });

describe('changing a node’s mode', () => {
  const rippled = () =>
    wire(
      [
        { id: 'g', kind: 'source', op: 'plasma', x: 0, y: 0 },
        { id: 'k', kind: 'value', x: 0, y: 1, value: 0.5 },
        { id: 'e', kind: 'lens', op: 'ripple', x: 1, y: 0 },
        { id: 'o', kind: 'out', x: 2, y: 0 },
      ],
      [
        { from: 'g/c', to: 'e/c' },
        { from: 'k/n', to: 'e/waves' },
        { from: 'e/c', to: 'o/c' },
      ],
    );

  it('cuts the cords the new mode has nowhere to put', () => {
    // What this looked like from the front of house: switch a `ripple` to a
    // `posterize` and the knob's outlet stays lit with no wire leaving it,
    // because the canvas cannot draw a cord to a port that is not mounted and
    // the compiler ignores one addressed to an inlet that is not there. Switch
    // back and the wire returns, which makes it look like the editor is broken
    // rather than the graph.
    const next = setNode(rippled(), 'e', { op: 'zoom' });
    expect(next.cords.map((cord) => cord.to)).toEqual(['e/c', 'o/c']);
  });

  it('keeps a cord on an inlet the new mode has as well', () => {
    // `bloom` and `smear` both have a `reach`, and it is the same knob in both.
    const bloomed = setNode(rippled(), 'e', { kind: 'spread', op: 'bloom' });
    const rewired = setNode(
      { ...bloomed, cords: [...bloomed.cords, { from: 'k/n', to: 'e/reach' }] },
      'e',
      { op: 'smear' },
    );
    expect(rewired.cords).toContainEqual({ from: 'k/n', to: 'e/reach' });
  });

  it('cannot cross a family, because a mode belongs to one kind now', () => {
    // `bloom` was a mode of the same node as `ripple` when both were `effect`,
    // so a dropdown could turn a remap that costs one read into a tap that
    // costs nine. It cannot: the mode is not one this kind has, so the node
    // holds the first one it does rather than compiling something nobody asked
    // for. Changing the cost of a look is a different node now.
    const next = setNode(rippled(), 'e', { op: 'bloom' });
    const node = next.nodes.find((each) => each.id === 'e')!;
    expect(inletsOf(node).map((port) => port.name)).not.toContain('reach');
  });

  it('does not walk the cords when a node is only being dragged', () => {
    const dragged = setNode(rippled(), 'e', { x: 40, y: 90 });
    expect(dragged.cords).toEqual(rippled().cords);
  });
});

describe('out is the one node that is not optional', () => {
  it('refuses to take it off the canvas', () => {
    // A look without an `out` does not draw a smaller picture; it refuses to
    // compile, and the message is about a file rather than about the thing that
    // was just clicked. The faceplate has no delete button for the same reason,
    // and this is the half that means the rule is the model's.
    const held = starterCircuit();
    expect(dropNode(held, 'o')).toEqual(held);
    expect(dropNode(held, 'wash').nodes.some((node) => node.kind === 'out')).toBe(true);
  });

  it('is not something the node browser offers', () => {
    // It was, and dropping a second one is the one thing in the vocabulary that
    // makes a look stop compiling — a trap rather than a feature.
    const scheme = BUILT_IN as Scheme;
    const entries = palette(scheme, ['Bass', 'master']);
    expect(entries.some((entry) => entry.node.kind === 'out')).toBe(false);
    // And the rest of the vocabulary is still all there to be found.
    expect(entries.some((entry) => entry.node.kind === 'tracks')).toBe(true);
    expect(
      entries.some((entry) => entry.presets.some((preset) => preset.op === 'kaleido')),
    ).toBe(true);
  });
});

describe('a value set on an inlet', () => {
  const posterized = () =>
    wire(
      [
        { id: 'g', kind: 'source', op: 'plasma', x: 0, y: 0 },
        { id: 'e', kind: 'lens', op: 'ripple', x: 1, y: 0, knobs: { waves: 0.8, depth: 0.2 } },
        { id: 'o', kind: 'out', x: 2, y: 0 },
      ],
      [
        { from: 'g/c', to: 'e/c' },
        { from: 'e/c', to: 'o/c' },
      ],
    );

  it('turns without touching anything else on the node', () => {
    const next = setKnob(posterized(), 'e', 'waves', 0.4);
    expect(next.nodes.find((node) => node.id === 'e')?.knobs).toEqual({ waves: 0.4, depth: 0.2 });
    expect(next.cords).toEqual(posterized().cords);
  });

  it('keeps the ones the new mode has as well, and drops the rest', () => {
    // The quiet half of the cord rule. A `ripple` has `waves` and `depth`; a
    // `smear` has `reach` and `drive`. Nothing cut the values, so switching a
    // mode and switching back brought a number nobody could see back with it —
    // the picture changed and the only thing that had happened was a dropdown.
    const next = setNode(posterized(), 'e', { op: 'zoom' });
    expect(next.nodes.find((node) => node.id === 'e')?.knobs).toBeUndefined();
    // `bloom` and `smear` both have a `reach`, and it is the same knob in both.
    const bloomed = posterized();
    const at = bloomed.nodes.findIndex((node) => node.id === 'e');
    bloomed.nodes[at] = { ...bloomed.nodes[at], kind: 'spread', op: 'bloom', knobs: { reach: 0.9 } };
    const kept = setNode(bloomed, 'e', { op: 'smear' });
    expect(kept.nodes.find((node) => node.id === 'e')?.knobs).toEqual({ reach: 0.9 });
  });

  it('belongs to the copy rather than to both looks', () => {
    // A spread is one level deep, so the two graphs shared one map: turning a
    // knob on the fork turned it on the look it came from, which reads as the
    // original having been edited by a copy nobody had opened yet.
    const one = { ...(BUILT_IN as Scheme), looks: { one: { name: 'One', circuit: posterized() } } };
    const made = forkLook(one, 'one');
    const copy = made.scheme.looks[made.id].circuit;
    const turned = setKnob(copy, 'e', 'waves', 0.1);
    expect(turned.nodes.find((n) => n.id === 'e')?.knobs?.waves).toBe(0.1);
    expect(made.scheme.looks.one.circuit.nodes.find((n) => n.id === 'e')?.knobs?.waves).toBe(0.8);
  });
});
