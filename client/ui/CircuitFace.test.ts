import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Circuit, CircuitNode, MediaAsset } from '../../protocol.ts';
import { NodeFace, rowsHeldOpen, type NumberReading } from './Circuit.tsx';
import { readingsOf, sameDisplayedReadings } from './Designer.tsx';

const noop = () => {};

function face(
  node: CircuitNode,
  circuit: Circuit = { nodes: [node], cords: [] },
  numberReadings: Readonly<Record<string, NumberReading>> = {},
  media: readonly MediaAsset[] = [],
): string {
  return renderToStaticMarkup(
    h(NodeFace, {
      node,
      circuit,
      tracks: [],
      flows: [],
      media,
      energy: 0.62,
      beat: () => 0.5,
      numberReadings,
      onSwap: noop,
      onChange: noop,
      onTurn: noop,
      onRange: noop,
      onFree: noop,
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
    expect(html).toContain('How strongly the room drives this movement or brightness.');
  });

  it('draws a live number as a fader you can catch, never a meter you cannot', () => {
    // The row under the ports used to be a `Meter`: drawn exactly like the
    // sliders beneath it, taking no gesture, and a press on it dragged the
    // whole node. It is the same `Slider` as every other number row now —
    // running, it shows the signal moving; caught, it holds where you put it.
    const running = face({ id: 's', kind: 'source', op: 'plasma', x: 0, y: 0 });
    expect(running).not.toContain('wdg-meter');
    expect(running).toContain('data-running');
    // The helper's room energy, 0.62, is the value the fader is showing.
    expect(running).toContain('aria-valuenow="62');
    expect(running).toContain('live; drag to hold it at a number');

    // `solid`, because it is the one source with no follower rows — plasma's
    // `weave` would still be running beside the held energy, which is right.
    const held = face({
      id: 's',
      kind: 'source',
      op: 'solid',
      values: { energy: 0.3 },
      x: 0,
      y: 0,
    });
    expect(held).not.toContain('data-running');
    expect(held).toContain('aria-valuenow="30');
    // The way back to the signal, spelled on the face rather than remembered.
    expect(held).toContain('Let energy run live');
    expect(held).toContain('double-click to let it run live again');
  });

  it('shows a selector only when choosing among several outlets means something', () => {
    const polar = face({ id: 'p', kind: 'polar', previewOutlet: 'angle', x: 0, y: 0 });
    expect(polar).toContain(
      'title="Show radius in this node&#x27;s picture — The distance from the centre, from zero to one."',
    );
    expect(polar).toContain(
      'title="Show angle in this node&#x27;s picture — The direction around the centre, wrapped from zero to one."',
    );
    // The picked one carries the mark, and it is on the button rather than a
    // wrapper: an outlet is a row like any other now, so there is nothing left
    // between the row and its name to hang a state on.
    expect(polar).toContain('aria-pressed="true" data-on=""');

    const source = face({ id: 's', kind: 'source', op: 'plasma', x: 0, y: 0 });
    expect(source).not.toContain('node-outlet-preview');
    // With one outlet the name is still printed, just not as something to press.
    expect(source).toContain('class="node-outlet-name" title="The generated picture.">c</span>');
  });

  it('leaves a driven number row live, because the number under a cord is its floor', () => {
    const circuit: Circuit = {
      nodes: [
        { id: 'w', kind: 'lfo', op: 'pulse', x: 0, y: 0 },
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
    // The reading, and only the reading. `pulse · 73 %` used to go here and
    // ellipsised to `pulse…`, spending the number to name a cord you can see.
    expect(html).toContain('<span class="wdg-readout">73 %</span>');
    expect(html).toContain('depth ← pulse');
    // The row still holds the floor, which is what a drag on it sets.
    expect(html).toContain('aria-valuenow="81"');
    expect(html).toContain('aria-label="depth"');
  });

  it('draws a range only where a cord could use one', () => {
    const wired: Circuit = {
      nodes: [
        { id: 'w', kind: 'lfo', op: 'pulse', x: 0, y: 0 },
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
    // `polar` is per-fragment, so no CPU reading exists. The readout says so
    // with a dash rather than inventing a number or falling back to the floor,
    // which would read as the live value and be wrong.
    expect(html).toContain('<span class="wdg-readout">—</span>');
    expect(html).toContain('a ← polar·angle');
    expect(html).toContain('aria-valuenow="81"');
  });

  it('puts a fixed mode on the title and offers hot-swap there', () => {
    const mode = face({ id: 'w', kind: 'lfo', op: 'sine', x: 0, y: 0 });
    expect(mode).toContain('<span class="wdg-device-name">sine</span>');
    expect(mode).toContain('Swap sine preset');

    const plain = face({ id: 'p', kind: 'point', x: 0, y: 0 });
    expect(plain).not.toContain('wdg-device-swap');
  });

  it('disables a transform in place without offering a fake bypass on a source', () => {
    // On and off live on the dot every device in the library already has,
    // rather than on a word in a header that was already carrying three. The
    // rule it enforces is unchanged: a node with nothing to pass through is not
    // offered the choice, and its dot is an indicator rather than a control.
    const active = face({ id: 'e', kind: 'grade', op: 'hue', x: 0, y: 0 });
    expect(active).toContain('<button type="button" class="wdg-device-power"');
    expect(active).toContain('aria-label="hue active"');
    expect(active).toContain('aria-pressed="true"');

    const bypassed = face({ id: 'e', kind: 'grade', op: 'hue', bypassed: true, x: 0, y: 0 });
    expect(bypassed).toContain('is-bypassed');
    expect(bypassed).toContain('aria-pressed="false"');

    // A source has no inlet to pass through, so there is no honest "off" for
    // it — and the dot must not invite a press that would do nothing.
    const source = face({ id: 's', kind: 'source', op: 'plasma', x: 0, y: 0 });
    expect(source).not.toContain('aria-label="plasma active"');
    expect(source).toContain('<span class="wdg-device-power"');
  });

  it('gives an LFO a real sync toggle and domain-aware rate and phase readings', () => {
    const html = face(
      {
        id: 'l',
        kind: 'lfo',
        op: 'triangle',
        values: { rate: 0.5, sync: 1, phase: 0.25 },
        x: 0,
        y: 0,
      },
      undefined,
      {
        'l/rate': { value: 0.5, display: '1/4' },
        'l/sync': { value: 1, display: '100 %' },
        'l/phase': { value: 0.25, display: '90°' },
      },
    );
    expect(html).toContain('class="wdg wdg-toggle"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('>sync</button>');
    expect(html).toContain('<span class="wdg-readout">1/4</span>');
    expect(html).toContain('<span class="wdg-readout">90°</span>');
  });

  it('offers only server-approved media ids on a video face', () => {
    const html = face(
      { id: 'v', kind: 'video', op: 'loop', asset: 'loops/one.mp4', x: 0, y: 0 },
      undefined,
      undefined,
      [
        { id: 'loops/one.mp4', name: 'one.mp4', bytes: 10, type: 'video' },
        { id: 'two.webm', name: 'two.webm', bytes: 20, type: 'video' },
        { id: 'poster.png', name: 'poster.png', bytes: 30, type: 'image' },
      ],
    );
    expect(html).toContain('aria-label="Video file"');
    expect(html).toContain('loops/one.mp4');
    expect(html).toContain('two.webm');
    expect(html).not.toContain('poster.png');
    expect(html).not.toContain('/Users/');
  });

  it('offers only server-approved stills on an image face', () => {
    const html = face(
      { id: 'i', kind: 'image', op: 'contain', asset: 'art/poster.png', x: 0, y: 0 },
      undefined,
      undefined,
      [
        { id: 'art/poster.png', name: 'poster.png', bytes: 10, type: 'image' },
        { id: 'loop.mp4', name: 'loop.mp4', bytes: 20, type: 'video' },
      ],
    );
    expect(html).toContain('aria-label="Image file"');
    expect(html).toContain('art/poster.png');
    expect(html).not.toContain('loop.mp4');
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
