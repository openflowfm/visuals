import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Circuit, CircuitNode } from '../../protocol.ts';
import { NodeFace, type NumberReading } from './Circuit.tsx';
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
    expect(polar).toContain('class="node-outlet-choice" data-on=""');

    const source = face({ id: 's', kind: 'source', op: 'plasma', x: 0, y: 0 });
    expect(source).not.toContain('node-outlet-preview');
  });

  it('keeps a driven number row and names its driver instead of its dormant value', () => {
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
    expect(html).toContain('data-disabled=""');
    expect(html).toContain('<span class="wdg-readout">pulse · 73 %</span>');
    expect(html).toContain('aria-label="depth"');
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
    expect(html).toContain('node-number-unreadable');
    expect(html).toContain('<span class="wdg-readout">polar·angle</span>');
    expect(html).not.toContain('polar·angle ·');
    expect(html).not.toContain('81 %');
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
