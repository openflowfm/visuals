import { describe, expect, it } from 'vitest';
import type { Circuit } from '../../protocol.ts';
import { previewOutletOf, probeAt } from './probe.ts';

/**
 * The graph as it stands at one node's outlet.
 *
 * What is worth pinning here is **which** outlet, because a node with two of
 * them has no obvious answer and the wrong answer is invisible: the face draws
 * a picture, the picture is of something, and nothing on it says it is the
 * other port. `polar` has had two outlets all along.
 */

const wire = (nodes: Circuit['nodes'], cords: Circuit['cords']): Circuit => ({ nodes, cords });

/** The node feeding the probe's own `out`, which is what the face is a picture of. */
function shownBy(circuit: Circuit, nodeId: string): string | undefined {
  const probed = probeAt(circuit, nodeId);
  const end = probed?.nodes.find((node) => node.kind === 'out');
  const into = probed?.cords.find((cord) => cord.to === `${end?.id}/c`);
  return into?.from;
}

describe('which outlet a face is a picture of', () => {
  it('takes the one that is wired, not the one declared first', () => {
    // `polar` gives a radius and an angle. A face that always drew the radius
    // was drawing the wrong number for every graph that used the angle, with
    // nothing on the picture to say so.
    const circuit = wire(
      [
        { id: 'pt', kind: 'point', x: 0, y: 0 },
        { id: 'pol', kind: 'polar', x: 1, y: 0 },
        { id: 'pa', kind: 'paint', x: 2, y: 0 },
        { id: 'o', kind: 'out', x: 3, y: 0 },
      ],
      [
        { from: 'pt/p', to: 'pol/p' },
        { from: 'pol/angle', to: 'pa/amount' },
        { from: 'pa/c', to: 'o/c' },
      ],
    );
    // Through `paint`, because a number has no picture of its own — but of the
    // angle rather than the radius.
    expect(shownBy(circuit, 'pol')).toBe('~probe-bridge/c');
    expect(probeAt(circuit, 'pol')?.cords).toContainEqual({
      from: 'pol/angle',
      to: '~probe-bridge/amount',
    });
  });

  it('takes an explicit polar outlet even when the other one is wired', () => {
    const circuit = wire(
      [
        { id: 'pol', kind: 'polar', previewOutlet: 'radius', x: 0, y: 0 },
        { id: 'pa', kind: 'paint', x: 1, y: 0 },
        { id: 'o', kind: 'out', x: 2, y: 0 },
      ],
      [
        { from: 'pol/angle', to: 'pa/amount' },
        { from: 'pa/c', to: 'o/c' },
      ],
    );
    expect(previewOutletOf(circuit, 'pol')?.name).toBe('radius');
    expect(probeAt(circuit, 'pol')?.cords).toContainEqual({
      from: 'pol/radius',
      to: '~probe-bridge/amount',
    });
  });

  it('takes an explicit lens point even when its colour is wired', () => {
    const circuit = wire(
      [
        { id: 's', kind: 'source', op: 'plasma', x: 0, y: 0 },
        { id: 'l', kind: 'lens', op: 'zoom', previewOutlet: 'p', x: 1, y: 0 },
        { id: 'o', kind: 'out', x: 2, y: 0 },
      ],
      [
        { from: 's/c', to: 'l/c' },
        { from: 'l/c', to: 'o/c' },
      ],
    );
    expect(previewOutletOf(circuit, 'l')).toMatchObject({ name: 'p', kind: 'p' });
    expect(probeAt(circuit, 'l')?.cords).toContainEqual({
      from: 'l/p',
      to: '~probe-bridge/p',
    });
  });

  it('prefers a wired colour when more than one outlet is in use', () => {
    const circuit = wire(
      [
        { id: 'l', kind: 'lens', op: 'zoom', x: 0, y: 0 },
        { id: 's', kind: 'source', op: 'plasma', x: 1, y: 0 },
        { id: 'o', kind: 'out', x: 2, y: 0 },
      ],
      [
        { from: 'l/p', to: 's/p' },
        { from: 'l/c', to: 'o/c' },
      ],
    );
    expect(previewOutletOf(circuit, 'l')).toMatchObject({ name: 'c', kind: 'c' });
  });

  it('falls back harmlessly from an invalid explicit outlet', () => {
    const circuit = wire(
      [
        { id: 'pol', kind: 'polar', previewOutlet: 'depth', x: 0, y: 0 },
        { id: 'pa', kind: 'paint', x: 1, y: 0 },
        { id: 'o', kind: 'out', x: 2, y: 0 },
      ],
      [
        { from: 'pol/angle', to: 'pa/amount' },
        { from: 'pa/c', to: 'o/c' },
      ],
    );
    expect(previewOutletOf(circuit, 'pol')?.name).toBe('angle');
    expect(probeAt(circuit, 'pol')?.cords).toContainEqual({
      from: 'pol/angle',
      to: '~probe-bridge/amount',
    });
  });

  it('holds the bridge paint at a fixed energy', () => {
    // The bridge exists to show the probed signal. Left unwired, `paint`'s
    // energy inlet rides the room, and the face throbbed with the bench's
    // stand-in energy on top of the number it was captioned as showing.
    const circuit = wire(
      [
        { id: 'pol', kind: 'polar', x: 0, y: 0 },
        { id: 'o', kind: 'out', x: 1, y: 0 },
      ],
      [],
    );
    const bridge = probeAt(circuit, 'pol')?.nodes.find((node) => node.id === '~probe-bridge');

    expect(bridge?.values).toEqual({ energy: 0.5 });
  });

  it('falls back to the first outlet when nothing is wired yet', () => {
    // A node dropped and not yet connected still has to show something, and the
    // first outlet is as good an answer as exists.
    const circuit = wire(
      [
        { id: 'pol', kind: 'polar', x: 0, y: 0 },
        { id: 'o', kind: 'out', x: 1, y: 0 },
      ],
      [],
    );
    expect(probeAt(circuit, 'pol')?.cords).toContainEqual({
      from: 'pol/radius',
      to: '~probe-bridge/amount',
    });
  });
});
