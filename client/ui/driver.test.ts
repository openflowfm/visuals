import { describe, expect, it } from 'vitest';
import type { Circuit } from '../../protocol.ts';
import { driverOf } from './Circuit.tsx';

/**
 * What a driven inlet reads out instead of its number.
 *
 * The control stays on the face when a cord lands — that is the whole point of
 * not reflowing — so it has to say something true. Showing the stored number
 * would be the near miss: a control that looks readable but no longer owns the
 * value. It shows what is driving it instead, and these pin the two ways that
 * name can go wrong.
 */

const wire = (nodes: Circuit['nodes'], cords: Circuit['cords']): Circuit => ({ nodes, cords });

describe('naming what drives an inlet', () => {
  it('is undefined when nothing is wired, which is what leaves the control live', () => {
    const circuit = wire([{ id: 'l', kind: 'lens', op: 'ripple', x: 0, y: 0 }], []);
    expect(driverOf(circuit, 'l/depth')).toBeUndefined();
  });

  it('names the source the way its own faceplate does, not by id', () => {
    // Modes are the title now, so a track's level reads exactly as the title
    // upstream does. `track1` would be a lookup rather than a sentence.
    const circuit = wire(
      [
        { id: 'track1', kind: 'track', of: 'Drums', op: 'level', x: 0, y: 0 },
        { id: 'l', kind: 'lens', op: 'ripple', x: 1, y: 0 },
      ],
      [{ from: 'track1/n', to: 'l/depth' }],
    );
    expect(driverOf(circuit, 'l/depth')).toBe('level');
  });

  it('uses the mode for every fixed-mode kind', () => {
    // The kind sits beside the title now, so the title itself can say the
    // chosen answer consistently even when another kind has one spelled alike.
    const circuit = wire(
      [
        { id: 'wave1', kind: 'lfo', op: 'pulse', x: 0, y: 0 },
        { id: 'l', kind: 'lens', op: 'ripple', x: 1, y: 0 },
      ],
      [{ from: 'wave1/n', to: 'l/depth' }],
    );
    expect(driverOf(circuit, 'l/depth')).toBe('pulse');
  });

  it('adds the outlet only when the source has more than one', () => {
    // `polar` is one of exactly two kinds where which port a cord left by is a
    // real question. Printing `·n` on every single-outlet node would be noise
    // on a face with no room for it.
    const circuit = wire(
      [
        { id: 'pol', kind: 'polar', x: 0, y: 0 },
        { id: 'l', kind: 'lens', op: 'ripple', x: 1, y: 0 },
      ],
      [{ from: 'pol/angle', to: 'l/depth' }],
    );
    expect(driverOf(circuit, 'l/depth')).toBe('polar·angle');
  });

  it('splits on the last slash, so a flattened id keeps its own', () => {
    // The flattener parks a nested flow's nodes under ids carrying slashes.
    // Splitting on the first one would look up a node that does not exist and
    // read out a fragment of an id.
    const circuit = wire(
      [
        { id: 'deep/src1', kind: 'source', op: 'plasma', x: 0, y: 0 },
        { id: 'l', kind: 'lens', op: 'ripple', x: 1, y: 0 },
      ],
      [{ from: 'deep/src1/c', to: 'l/c' }],
    );
    expect(driverOf(circuit, 'l/c')).toBe('plasma');
  });
});
