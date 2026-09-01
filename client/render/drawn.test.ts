import { describe, expect, it } from 'vitest';
import type { Circuit } from '../../protocol.ts';
import { ARRAY_MODES, FIGURE_MODES, FORM_MODES, GLOW_MODES, SHADE_MODES } from '../../protocol.ts';
import { compileCircuit, MAX_SHADER_WORK } from './circuit.ts';
import { FIGURE_SAMPLES } from './glsl/figure.ts';
import { FORM_WORK } from './glsl/form.ts';
import { OVERBRIGHT as PREAMBLE_OVERBRIGHT } from './glsl/common.ts';

/**
 * The five nodes that let the vocabulary draw a lit line.
 *
 * Between them they close the one direction the three signals could not travel:
 * a picture could become a number through `read`, and a point could become
 * numbers through `polar`, but no number could become a picture without going
 * through a whole `source`. `figure` measures a shape, `array` repeats the
 * space one is measured in, `glow` and `shade` turn the measurement back into
 * light, and `form` does the same thing along a ray instead of across a frame.
 */

const out = { id: 'o', kind: 'out' as const, x: 900, y: 0 };
const body = (source: string) => source.slice(source.indexOf('void main()'));
const built = (circuit: Circuit) => compileCircuit(circuit);

describe('a number becoming light', () => {
  it('draws a lamp when nothing is wired to it, rather than a black frame', () => {
    // Every unwired inlet in this vocabulary answers something. A draw node
    // whose resting answer is "nothing" reads as one that came unhooked, so
    // the distance falls back to the distance from the middle of the frame.
    const made = built({
      nodes: [{ id: 'g', kind: 'glow', op: 'neon', x: 0, y: 0 }, out],
      cords: [{ from: 'g/c', to: 'o/c' }],
    });
    expect(made.error).toBeNull();
    expect(body(made.source!)).toContain('glow_neon(length(centred())');
  });

  it('offers every falloff and every shade the protocol names', () => {
    for (const op of GLOW_MODES) {
      const made = built({
        nodes: [{ id: 'g', kind: 'glow', op, x: 0, y: 0 }, out],
        cords: [{ from: 'g/c', to: 'o/c' }],
      });
      expect(made.error).toBeNull();
      expect(body(made.source!)).toContain(`glow_${op}(`);
    }
    for (const op of SHADE_MODES) {
      const made = built({
        nodes: [{ id: 'r', kind: 'shade', op, x: 0, y: 0 }, out],
        cords: [{ from: 'r/c', to: 'o/c' }],
      });
      expect(made.error).toBeNull();
      expect(body(made.source!)).toContain(`shade_${op}(`);
    }
  });

  it('costs what arithmetic costs, so it may be bloomed like any other picture', () => {
    const made = built({
      nodes: [
        { id: 'f', kind: 'figure', op: 'circle', x: 0, y: 0 },
        { id: 'g', kind: 'glow', op: 'neon', x: 300, y: 0 },
        { id: 's', kind: 'spread', op: 'bloom', x: 600, y: 0 },
        out,
      ],
      cords: [
        { from: 'f/d', to: 'g/d' },
        { from: 'g/c', to: 's/c' },
        { from: 's/c', to: 'o/c' },
      ],
    });
    expect(made.error).toBeNull();
    expect(made.work).toBe(0);
  });
});

describe('a shape measured rather than drawn', () => {
  it('gives back a number and never a colour', () => {
    const made = built({
      nodes: [
        { id: 'f', kind: 'figure', op: 'rose', x: 0, y: 0 },
        { id: 'g', kind: 'glow', op: 'neon', x: 300, y: 0 },
        out,
      ],
      cords: [
        { from: 'f/d', to: 'g/d' },
        { from: 'g/c', to: 'o/c' },
      ],
    });
    expect(made.error).toBeNull();
    expect(body(made.source!)).toContain('float');
    expect(body(made.source!)).toContain('figure_rose(');
  });

  it('emits only the outlet that was asked for', () => {
    // There is no vec2 to hold a shared measurement in, so asking for the
    // distance must not also declare the position along the shape.
    const distanceOnly = built({
      nodes: [
        { id: 'f', kind: 'figure', op: 'circle', x: 0, y: 0 },
        { id: 'g', kind: 'glow', op: 'neon', x: 300, y: 0 },
        out,
      ],
      cords: [
        { from: 'f/d', to: 'g/d' },
        { from: 'g/c', to: 'o/c' },
      ],
    });
    expect((body(distanceOnly.source!).match(/figure_circle\(/g) ?? []).length).toBe(1);
    expect(body(distanceOnly.source!)).toContain('.x');
    expect(body(distanceOnly.source!)).not.toContain('.y;');
  });

  it('charges the walked curve and nothing else', () => {
    const walked = built({
      nodes: [
        { id: 'f', kind: 'figure', op: 'lissajous', x: 0, y: 0 },
        { id: 'g', kind: 'glow', op: 'neon', x: 300, y: 0 },
        out,
      ],
      cords: [
        { from: 'f/d', to: 'g/d' },
        { from: 'g/c', to: 'o/c' },
      ],
    });
    expect(walked.work).toBe(FIGURE_SAMPLES);
    for (const op of FIGURE_MODES.filter((mode) => mode !== 'lissajous')) {
      const closed = built({
        nodes: [
          { id: 'f', kind: 'figure', op, x: 0, y: 0 },
          { id: 'g', kind: 'glow', op: 'neon', x: 300, y: 0 },
          out,
        ],
        cords: [
          { from: 'f/d', to: 'g/d' },
          { from: 'g/c', to: 'o/c' },
        ],
      });
      expect(closed.work).toBe(0);
    }
  });
});

describe('a space repeated, and which copy you are in', () => {
  it('hands back both the local point and the copy it belongs to', () => {
    // The copy number is the whole reason this is not `lens/tile`: it is what
    // turns a repeat into an arrangement.
    const made = built({
      nodes: [
        { id: 'a', kind: 'array', op: 'ring', x: 0, y: 0 },
        { id: 'f', kind: 'figure', op: 'arc', x: 300, y: 0 },
        { id: 'g', kind: 'glow', op: 'neon', x: 600, y: 0 },
        out,
      ],
      cords: [
        { from: 'a/p', to: 'f/p' },
        { from: 'a/which', to: 'f/sweep' },
        { from: 'f/d', to: 'g/d' },
        { from: 'g/c', to: 'o/c' },
      ],
    });
    expect(made.error).toBeNull();
    expect(body(made.source!)).toContain('array_ring(');
    expect(body(made.source!)).toContain('.xy');
    expect(body(made.source!)).toContain('.z');
  });

  it('compiles every arrangement', () => {
    for (const op of ARRAY_MODES) {
      const made = built({
        nodes: [
          { id: 'a', kind: 'array', op, x: 0, y: 0 },
          { id: 'f', kind: 'figure', op: 'circle', x: 300, y: 0 },
          { id: 'g', kind: 'glow', op: 'neon', x: 600, y: 0 },
          out,
        ],
        cords: [
          { from: 'a/p', to: 'f/p' },
          { from: 'f/d', to: 'g/d' },
          { from: 'g/c', to: 'o/c' },
        ],
      });
      expect(made.error).toBeNull();
      expect(body(made.source!)).toContain(`array_${op}(`);
    }
  });
});

describe('the finish these pictures are drawn for', () => {
  const lit = (finish: { id: string; kind: 'spread' | 'grade'; op: string }) =>
    built({
      nodes: [
        { id: 'f', kind: 'figure', op: 'rose', x: 0, y: 0 },
        { id: 'g', kind: 'glow', op: 'neon', x: 300, y: 0 },
        { ...finish, x: 600, y: 0 },
        out,
      ],
      cords: [
        { from: 'f/d', to: 'g/d' },
        { from: 'g/c', to: `${finish.id}/c` },
        { from: `${finish.id}/c`, to: 'o/c' },
      ],
    });

  it('smears the streak along one axis and corrects it for the frame', () => {
    const made = lit({ id: 'x', kind: 'spread', op: 'streak' });
    expect(made.error).toBeNull();
    const source = body(made.source!);
    // Horizontal only — a streak with any vertical component is a blur.
    expect(source).toContain('uRes.x / uRes.y, 0.0)');
    // Twelve taps and the picture itself: six arms each way.
    expect((source.match(/figure_rose\(/g) ?? []).length).toBe(13);
  });

  it('walks the spectrum out from the centre, evenly and both ways', () => {
    // The one claim that separates this from `shift`, which is three whole
    // channels shoved sideways and reads as a broken signal. This is an optic:
    // the taps are a *scale about the centre*, so nothing moves in the middle
    // and the fringe is red on one side of a shape and blue on the other
    // because it is the same lens on both. Offsets that stopped being
    // symmetric would tint one edge of every bright thing in the frame.
    const made = lit({ id: 'x', kind: 'spread', op: 'disperse' });
    expect(made.error).toBeNull();
    const source = body(made.source!);
    expect((source.match(/figure_rose\(/g) ?? []).length).toBe(6);

    const along = [...source.matchAll(/\(1\.0 \+ (-?[0-9.]+) \*/g)].map((each) =>
      Number(each[1]),
    );
    expect(along).toHaveLength(6);
    // Spanning the whole split, and mirrored about zero.
    expect(Math.min(...along)).toBeCloseTo(-1, 6);
    expect(Math.max(...along)).toBeCloseTo(1, 6);
    for (let i = 0; i < along.length; i++) {
      expect(along[i]!).toBeCloseTo(-along[along.length - 1 - i]!, 6);
    }
    // A scale about the centre rather than a translation: every tap multiplies
    // the point, and none of them adds a fixed offset to it.
    expect(source).not.toMatch(/disperse[^;]*\+ vec2\(/);
  });

  it('rolls the highlights without reading the picture twice', () => {
    const made = lit({ id: 'x', kind: 'grade', op: 'highlights' });
    expect(made.error).toBeNull();
    expect(body(made.source!)).toContain('fxHighlights(');
    // A grade is the colour where it already is: one read, no multiplication.
    expect((body(made.source!).match(/figure_rose\(/g) ?? []).length).toBe(1);
    expect(made.work).toBe(0);
  });
});

describe('the one node with a third coordinate in it', () => {
  it('keeps the space to itself: what leaves is a picture like any other', () => {
    for (const op of FORM_MODES) {
      const made = built({
        nodes: [{ id: 'f', kind: 'form', op, x: 0, y: 0 }, out],
        cords: [{ from: 'f/c', to: 'o/c' }],
      });
      expect(made.error).toBeNull();
      expect(made.work).toBe(FORM_WORK);
      expect(body(made.source!)).toContain(`form_march(centred(), uEnergy, ${FORM_MODES.indexOf(op)},`);
    }
  });

  it('orbits on the beat when nothing is wired to it', () => {
    const made = built({
      nodes: [{ id: 'f', kind: 'form', op: 'rings', x: 0, y: 0 }, out],
      cords: [{ from: 'f/c', to: 'o/c' }],
    });
    expect(body(made.source!)).toContain('(uBeat * 0.03)');
  });

  it('lets two be blended and refuses to be sampled nine times', () => {
    // The budget is two full marches, exactly as it is two full fractals.
    const pair = built({
      nodes: [
        { id: 'a', kind: 'form', op: 'rings', x: 0, y: 0 },
        { id: 'b', kind: 'form', op: 'frame', x: 0, y: 200 },
        { id: 'm', kind: 'blend', op: 'add', x: 300, y: 0 },
        out,
      ],
      cords: [
        { from: 'a/c', to: 'm/base' },
        { from: 'b/c', to: 'm/top' },
        { from: 'm/c', to: 'o/c' },
      ],
    });
    expect(pair.error).toBeNull();
    expect(pair.work).toBe(FORM_WORK * 2);
    expect(pair.work).toBeLessThanOrEqual(MAX_SHADER_WORK);

    // And a bloom over one is nine marches, which is refused by name rather
    // than handed to the driver. It does not need one: the march accumulates
    // its glow in the scene as it goes.
    const bloomed = built({
      nodes: [
        { id: 'f', kind: 'form', op: 'rings', x: 0, y: 0 },
        { id: 's', kind: 'spread', op: 'bloom', x: 300, y: 0 },
        out,
      ],
      cords: [
        { from: 'f/c', to: 's/c' },
        { from: 's/c', to: 'o/c' },
      ],
    });
    expect(bloomed.error).toContain('too expensive to draw');
  });
});

describe('light with somewhere above white to go', () => {
  it('lets a filament out of the range the display can show', () => {
    // A glow that could only reach one had nowhere to put the difference
    // between "lit" and "blown", so every stroke in the library came out the
    // same pale wash of the colourway. The excess is invisible on its own —
    // the display clips — and exists so a bloom downstream has something to
    // find. See OVERBRIGHT.
    const made = built({
      nodes: [{ id: 'g', kind: 'glow', op: 'neon', x: 0, y: 0 }, out],
      cords: [{ from: 'g/c', to: 'o/c' }],
    });
    expect(made.error).toBeNull();
    expect(body(made.source ?? '')).toContain('glow_neon(');
    expect(PREAMBLE_OVERBRIGHT).toBeGreaterThan(1);
  });

  it('charges a bloom for every tap it takes of what is under it', () => {
    // Eight taps, and each one re-evaluates the whole picture upstream. Over a
    // march that is eight marches, which is the compiler's business to refuse
    // rather than the driver's to discover.
    const overForm = built({
      nodes: [
        { id: 'f', kind: 'form', op: 'rings', x: 0, y: 0 },
        { id: 's', kind: 'spread', op: 'bloom', x: 300, y: 0 },
        out,
      ],
      cords: [
        { from: 'f/c', to: 's/c' },
        { from: 's/c', to: 'o/c' },
      ],
    });
    expect(overForm.error).toMatch(/too expensive to draw/);

    const overFigure = built({
      nodes: [
        { id: 'g', kind: 'glow', op: 'neon', x: 0, y: 0 },
        { id: 's', kind: 'spread', op: 'bloom', x: 300, y: 0 },
        out,
      ],
      cords: [
        { from: 'g/c', to: 's/c' },
        { from: 's/c', to: 'o/c' },
      ],
    });
    expect(overFigure.error).toBeNull();
    expect(overFigure.work).toBeLessThanOrEqual(MAX_SHADER_WORK);
  });

  it('bends a number without moving either end of it', () => {
    // `math/curve` exists because there was no way to write an exponent, so
    // flows reached for `multiply` with both inlets fed from one cord to get a
    // square. Its midpoint has to be the identity or wiring nothing to the
    // amount would change the picture.
    const exponent = (b: number) => 2 ** ((Math.max(0, Math.min(1, b)) - 0.5) * 4);
    expect(exponent(0.5)).toBeCloseTo(1, 12);
    expect(exponent(1)).toBeCloseTo(4, 12);
    expect(exponent(0)).toBeCloseTo(0.25, 12);
    for (const at of [0.1, 0.4, 0.9]) {
      expect(at ** exponent(0.85)).toBeLessThan(at);
      expect(at ** exponent(0.15)).toBeGreaterThan(at);
    }
    const made = built({
      nodes: [
        { id: 'm', kind: 'math', op: 'curve', x: 0, y: 0 },
        { id: 'g', kind: 'glow', op: 'neon', x: 300, y: 0 },
        out,
      ],
      cords: [
        { from: 'm/n', to: 'g/core' },
        { from: 'g/c', to: 'o/c' },
      ],
    });
    expect(made.error).toBeNull();
    expect(body(made.source ?? '')).toContain('pow(');
  });
});
