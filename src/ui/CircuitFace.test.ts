import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Circuit, CircuitNode } from '../../protocol.ts';
import { NodeFace, rowsHeldOpen, type NumberReading } from './Circuit.tsx';
import { readingsOf, sameDisplayedReadings } from './Designer.tsx';

const noop = () => {};

function face(
  node: CircuitNode,
  circuit: Circuit = { nodes: [node], cords: [] },
  numberReadings: Readonly<Record<string, NumberReading>> = {},
): string {
  return renderToStaticMarkup(
    h(NodeFace, {
      node,
      circuit,
      tracks: [],
      looks: [],
      energy: 0.62,
      beat: () => 0.5,
      numberReadings,
      onSwap: noop,
      onChange: noop,
      onTurn: noop,
      onRange: noop,
      onCut: noop,
      onDrop: noop,
    }),
  );
}

describe('the node face anatomy', () => {
  it('uses the row layout and keeps an inlet name out of the port caption', () => {
    const html = face({ id: 's', kind: 'source', op: 'plasma', x: 0, y: 0 });
    expect(html).toContain('data-port-layout="rows"');
    expect(html).toContain('aria-label="energy"');
    expect(html).not.toContain('<span class="wdg-port-label">energy</span>');
    expect(html).toContain('class="wdg-caption">energy</span>');
  });

  it('shows a selector only when choosing among several outlets means something', () => {
    const polar = face({ id: 'p', kind: 'polar', previewOutlet: 'angle', x: 0, y: 0 });
    expect(polar).toContain('title="Show radius in this node&#x27;s picture"');
    expect(polar).toContain('title="Show angle in this node&#x27;s picture"');
    // The picked one carries the mark, and it is on the button rather than a
    // wrapper: an outlet is a row like any other now, so there is nothing left
    // between the row and its name to hang a state on.
    expect(polar).toContain('aria-pressed="true" data-on=""');

    const source = face({ id: 's', kind: 'source', op: 'plasma', x: 0, y: 0 });
    expect(source).not.toContain('node-outlet-preview');
    // With one outlet the name is still printed, just not as something to press.
    expect(source).toContain('class="node-outlet-name">c</span>');
  });

  it('leaves a driven number row live, because the number under a cord is its floor', () => {
    const circuit: Circuit = {
      nodes: [
        { id: 'w', kind: 'wave', op: 'pulse', x: 0, y: 0 },
        { id: 'l', kind: 'lens', op: 'ripple', values: { depth: 0.81 }, x: 1, y: 0 },
      ],
      cords: [{ from: 'w/n', to: 'l/depth' }],
    };
    const html = face(circuit.nodes[1], circuit, {
      'l/depth': { value: 0.73, display: '73 %' },
    });
    // Not disabled. A cord used to replace the number under it, which made the
    // row a control for something nobody could see; it carries the inlet *from*
    // that number now, so the row is where you set the floor and the range.
    expect(html).not.toContain('data-disabled=""');
    expect(html).toContain('<span class="wdg-readout">pulse · 73 %</span>');
    // The floor it holds, not the live reading — that has the readout.
    expect(html).toContain('aria-valuenow="81"');
    expect(html).toContain('aria-label="depth"');
  });

  it('draws a range only where a cord could use one', () => {
    const wired: Circuit = {
      nodes: [
        { id: 'w', kind: 'wave', op: 'pulse', x: 0, y: 0 },
        { id: 'l', kind: 'lens', op: 'ripple', values: { depth: 0.2 }, depths: { depth: 0.3 }, x: 1, y: 0 },
      ],
      cords: [{ from: 'w/n', to: 'l/depth' }],
    };
    expect(face(wired.nodes[1], wired)).toContain('wdg-slider-span');

    // The same node with nothing wired in has no span and no mark: a range is
    // a thing a signal is carried through, and there is no signal.
    const bare: Circuit = { nodes: [wired.nodes[1]], cords: [] };
    expect(face(bare.nodes[0], bare)).not.toContain('wdg-slider-span');
  });

  it('keeps a per-fragment driver honest without inventing a value or fill', () => {
    const circuit: Circuit = {
      nodes: [
        { id: 'p', kind: 'polar', x: 0, y: 0 },
        { id: 'm', kind: 'math', op: 'add', values: { a: 0.81 }, x: 1, y: 0 },
      ],
      cords: [{ from: 'p/angle', to: 'm/a' }],
    };
    const html = face(circuit.nodes[1], circuit, { 'm/a': {} });
    // `polar` is per-fragment, so no CPU reading exists. The readout names the
    // driver and stops there rather than inventing a number, and the row still
    // shows the floor, which is a number that genuinely is set.
    expect(html).toContain('<span class="wdg-readout">polar·angle</span>');
    expect(html).not.toContain('polar·angle ·');
    expect(html).toContain('aria-valuenow="81"');
  });

  it('puts a fixed mode on the title and offers hot-swap there', () => {
    const mode = face({ id: 'w', kind: 'wave', op: 'sine', x: 0, y: 0 });
    expect(mode).toContain('<span class="wdg-device-name">sine</span>');
    expect(mode).toContain('Swap sine preset');

    const plain = face({ id: 'p', kind: 'point', x: 0, y: 0 });
    expect(plain).not.toContain('wdg-device-swap');
  });
});

describe('display-clock readings', () => {
  it('asks the evaluator for every number inlet by its port id', () => {
    const circuit: Circuit = {
      nodes: [{ id: 'm', kind: 'math', op: 'add', x: 0, y: 0 }],
      cords: [],
    };
    const asked: string[] = [];
    const readings = readingsOf(circuit, {
      outlet: () => undefined,
      inlet: (id) => {
        asked.push(id);
        return id === 'm/a' ? 0.624 : undefined;
      },
    });

    expect(asked).toEqual(['m/a', 'm/b']);
    expect(readings).toEqual({
      'm/a': { value: 0.624, display: '62 %' },
      'm/b': {},
    });
  });

  it('diffs the formatted readings before waking React', () => {
    expect(
      sameDisplayedReadings(
        { 'm/a': { value: 0.621, display: '62 %' } },
        { 'm/a': { value: 0.624, display: '62 %' } },
      ),
    ).toBe(true);
    expect(
      sameDisplayedReadings(
        { 'm/a': { value: 0.624, display: '62 %' } },
        { 'm/a': { value: 0.626, display: '63 %' } },
      ),
    ).toBe(false);
  });
});

describe('how much room a face holds open', () => {
  it('reserves the widest mode of this kind, so a mode change never reflows', () => {
    // `zoom` takes one number and `ripple` takes three, plus the point, the
    // colour and an energy. Both faces hold the taller shape open, so flicking
    // the dropdown moves nothing on the canvas.
    const zoom = rowsHeldOpen({ id: 'l', kind: 'lens', op: 'zoom', x: 0, y: 0 });
    const ripple = rowsHeldOpen({ id: 'l', kind: 'lens', op: 'ripple', x: 0, y: 0 });
    expect(zoom).toEqual(ripple);
    expect(zoom.ports).toBeGreaterThan(3);
  });

  it('does not make a small node as tall as the biggest one on the canvas', () => {
    // The whole reason this is per kind. `point` has no inlets and one outlet,
    // so it is one line; holding a lens's six open on it would be most of a
    // node of empty frame.
    const point = rowsHeldOpen({ id: 'p', kind: 'point', x: 0, y: 0 });
    const lens = rowsHeldOpen({ id: 'l', kind: 'lens', op: 'ripple', x: 0, y: 0 });
    expect(point.ports).toBe(1);
    expect(point.ports).toBeLessThan(lens.ports);
  });

  it('counts the row a kind draws for itself', () => {
    // A `value` has no inlets and still draws one control: its own amount. It
    // shares that line with its one outlet, so the face is a single row.
    expect(rowsHeldOpen({ id: 'v', kind: 'value', x: 0, y: 0 }).ports).toBe(1);
  });

  it('is as tall as its longer side when the outlets outnumber the inlets', () => {
    // `polar` takes one point and gives back two numbers. Pairing the rows
    // means the face is two lines, and the second has an outlet with nothing
    // opposite it.
    expect(rowsHeldOpen({ id: 'p', kind: 'polar', x: 0, y: 0 }).ports).toBe(2);
  });
});
