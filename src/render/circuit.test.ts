import { describe, expect, it } from 'vitest';
import type { Circuit } from '../../protocol.ts';
import { compileCircuit, knobsOf, signalOf, starterCircuit } from './circuit.ts';

/**
 * The circuit compiler.
 *
 * A shader that fails to compile is a black layer with a driver message behind
 * it, so the interesting cases are all the ones where a half-finished graph
 * still has to produce something drawable. Building one of these means dropping
 * a node and looking at it — a compiler that treated an unfinished graph as an
 * error would make the canvas unusable for exactly the way it gets used.
 */

const wire = (nodes: Circuit['nodes'], cords: Circuit['cords']): Circuit => ({
  nodes,
  cords,
});

/** Just `main`, so an assertion about what runs isn't fooled by a declaration. */
const bodyOf = (source: string) => source.slice(source.indexOf('void main()'));

describe('compiling a circuit', () => {
  it('compiles what a new effect starts as', () => {
    const built = compileCircuit(starterCircuit());
    expect(built.error).toBeNull();
    expect(built.source).toContain('void main()');
    expect(built.source).toContain('MIXED(');
  });

  it('gives a new effect one knob, already named', () => {
    const knobs = knobsOf(starterCircuit());
    expect(knobs).toHaveLength(1);
    expect(knobs[0]).toMatchObject({ label: 'sides', index: 0 });
  });

  it('draws the frame it was given when nothing is wired to out', () => {
    // Not an error. A canvas with one node on it should show the picture
    // arriving rather than a black rectangle.
    const built = compileCircuit(wire([{ id: 'o', kind: 'out', x: 0, y: 0 }], []));
    expect(built.error).toBeNull();
    expect(built.source).toContain('MIXED(texture(uTex, vUv))');
  });

  it('falls back on an unconnected inlet rather than refusing', () => {
    const built = compileCircuit(
      wire(
        [
          { id: 'f', kind: 'fold', x: 0, y: 0 },
          { id: 's', kind: 'sample', x: 0, y: 0 },
          { id: 'o', kind: 'out', x: 0, y: 0 },
        ],
        [
          { from: 'f/p', to: 's/p' },
          { from: 's/c', to: 'o/c' },
        ],
      ),
    );
    expect(built.error).toBeNull();
    // fold's point inlet is unwired, so it reads the fragment's own.
    expect(built.source).toContain('cFold(centred()');
  });

  it('refuses a circuit with no out at all', () => {
    const built = compileCircuit(wire([{ id: 'p', kind: 'point', x: 0, y: 0 }], []));
    expect(built.source).toBeNull();
    expect(built.error).toMatch(/out/);
  });

  it('refuses a loop instead of hanging in one', () => {
    const built = compileCircuit(
      wire(
        [
          { id: 'a', kind: 'zoom', x: 0, y: 0 },
          { id: 'b', kind: 'swirl', x: 0, y: 0 },
          { id: 's', kind: 'sample', x: 0, y: 0 },
          { id: 'o', kind: 'out', x: 0, y: 0 },
        ],
        [
          { from: 'a/p', to: 'b/p' },
          { from: 'b/p', to: 'a/p' },
          { from: 'b/p', to: 's/p' },
          { from: 's/c', to: 'o/c' },
        ],
      ),
    );
    expect(built.source).toBeNull();
    expect(built.error).toMatch(/loop/);
  });

  it('computes a shared node once, however many read it', () => {
    // A point feeding three geometry nodes is one `centred()`, not three.
    const built = compileCircuit(
      wire(
        [
          { id: 'p', kind: 'point', x: 0, y: 0 },
          { id: 'r', kind: 'polar', x: 0, y: 0 },
          { id: 'k', kind: 'paint', x: 0, y: 0 },
          { id: 'o', kind: 'out', x: 0, y: 0 },
        ],
        [
          { from: 'p/p', to: 'r/p' },
          { from: 'r/radius', to: 'k/amount' },
          { from: 'k/c', to: 'o/c' },
        ],
      ),
    );
    expect(built.error).toBeNull();
    expect(built.source!.match(/= centred\(\);/g)).toHaveLength(1);
  });

  it('leaves out a node that out cannot reach', () => {
    // Dead nodes cost nothing, which is what lets you park one on the canvas
    // while you decide where it goes.
    const built = compileCircuit(
      wire(
        [
          { id: 'w', kind: 'wobble', x: 0, y: 0 },
          { id: 'o', kind: 'out', x: 0, y: 0 },
        ],
        [],
      ),
    );
    expect(built.error).toBeNull();
    // The helper is always declared; what matters is that nothing calls it.
    expect(bodyOf(built.source!)).not.toContain('cWobble');
  });

  it('gives each knob its own slot, in the order they were added', () => {
    const built = compileCircuit(
      wire(
        [
          { id: 'k1', kind: 'value', x: 0, y: 0, value: 0.2, label: 'one' },
          { id: 'k2', kind: 'value', x: 0, y: 0, value: 0.8, label: 'two' },
          { id: 'm', kind: 'math', x: 0, y: 0, op: 'multiply' },
          { id: 'k', kind: 'paint', x: 0, y: 0 },
          { id: 'o', kind: 'out', x: 0, y: 0 },
        ],
        [
          { from: 'k1/n', to: 'm/a' },
          { from: 'k2/n', to: 'm/b' },
          { from: 'm/n', to: 'k/amount' },
          { from: 'k/c', to: 'o/c' },
        ],
      ),
    );
    expect(built.error).toBeNull();
    expect(built.source).toContain('uParams[0]');
    expect(built.source).toContain('uParams[1]');
    expect(built.knobs.map((k) => k.label)).toEqual(['one', 'two']);
  });

  it('refuses more knobs than the uniform bank holds', () => {
    const nodes = Array.from({ length: 9 }, (_, i) => ({
      id: `k${i}`,
      kind: 'value' as const,
      x: 0,
      y: 0,
    }));
    const built = compileCircuit(wire([...nodes, { id: 'o', kind: 'out', x: 0, y: 0 }], []));
    expect(built.source).toBeNull();
    expect(built.error).toMatch(/knobs/);
  });
});

describe('what a port carries', () => {
  it('knows every port on every node it has', () => {
    const circuit = starterCircuit();
    expect(signalOf(circuit, 'p/p')).toBe('p');
    expect(signalOf(circuit, 'k/n')).toBe('n');
    expect(signalOf(circuit, 's/c')).toBe('c');
    expect(signalOf(circuit, 'f/sides')).toBe('n');
  });

  it('says nothing about a port that is not there', () => {
    // The editor refuses a cord it cannot type, so this has to be honest
    // rather than optimistic.
    expect(signalOf(starterCircuit(), 'nope/n')).toBeNull();
    expect(signalOf(starterCircuit(), 'p/nope')).toBeNull();
  });
});
