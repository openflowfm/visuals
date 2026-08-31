import { FIGURE_MODES } from '../../../protocol.ts';
import type { NodeSpec } from '../../render/circuit.ts';
import { FIGURE_SAMPLES } from '../../render/glsl/figure.ts';
import { numberPort, pointPort, type PortSpec } from '../../render/ports.ts';
import { modeOfNode } from '../mode.ts';

type Mode = (typeof FIGURE_MODES)[number];

const descriptions: Record<Mode, string> = {
  circle: 'A ring at a radius from the centre.',
  box: 'The outline of a square, with its corners as round as you want them.',
  line: 'A straight segment through the centre, at an angle.',
  arc: 'Part of a circle, opened about straight up.',
  polygon: 'The outline of a regular polygon, from a triangle to a twelve-sided figure.',
  star: 'A star whose radius falls from each point to the valley beside it.',
  rose: 'A rhodonea: petals wound out of the centre by a cosine of the angle.',
  lissajous: 'A closed figure traced by two crossing oscillations, walked segment by segment.',
};

const size = () => numberPort('size', 'How far the shape reaches from the centre.', 0.45);
const turn = () => numberPort('turn', 'How far the shape is turned around the centre.', 0);

const values: Record<Mode, readonly PortSpec[]> = {
  circle: [size()],
  box: [size(), numberPort('corner', 'How rounded the corners of the square are.', 0.2)],
  line: [turn(), numberPort('span', 'How far the segment runs either side of the centre.', 0.5)],
  arc: [size(), numberPort('sweep', 'How much of the circle the arc covers.', 0.35)],
  polygon: [size(), numberPort('sides', 'How many sides the polygon has, from three to twelve.', 0.2)],
  star: [
    size(),
    numberPort('points', 'How many points the star has, from three to twelve.', 0.25),
    numberPort('spike', 'How deep the valleys between the points cut.', 0.5),
  ],
  rose: [size(), numberPort('petals', 'How many petals wind out of the centre.', 0.3)],
  lissajous: [
    size(),
    numberPort('ratio', 'How the two oscillations divide against each other.', 0.35),
    turn(),
  ],
};

/**
 * The node that measures a point against a shape.
 *
 * Two outlets, and the second is not an afterthought: how far *along* the shape
 * the nearest part of it lies is what lets a stroke be coloured, faded or
 * animated by position rather than uniformly. A curve whose colour runs along
 * it is a drawn thing; one painted a single colour is a shape.
 */
export const FIGURE_NODE_SPEC = {
  name: 'figure',
  description: 'How far this point is from a shape, and how far along that shape it lies.',
  inlets: (node) => [
    pointPort('p', 'The position to measure from the shape.'),
    ...values[modeOfNode(node, FIGURE_MODES)],
  ],
  outlets: [
    numberPort('d', 'The distance from the shape, at zero on it.'),
    numberPort('along', 'How far around or along the shape the nearest part of it lies.'),
  ],
  modes: FIGURE_MODES.map((name) => ({ name, description: descriptions[name] })),
  // Only the walked one costs anything. Charged at its sample ceiling rather
  // than at whatever its controls happen to say, for the reason `fractal` is.
  work: (node) => (modeOfNode(node, FIGURE_MODES) === 'lissajous' ? FIGURE_SAMPLES : 0),
  emit: (ctx) => {
    const op = modeOfNode(ctx.node, FIGURE_MODES);
    const args = [ctx.read('p'), ...values[op].map((port) => ctx.read(port.name))];
    const measured = `figure_${op}(${args.join(', ')})`;
    // Only the outlet that was asked for. There is no vec2 to hold a shared
    // measurement in — every emitted expression is one of the three signals —
    // so a graph reading both numbers measures twice, and one reading only the
    // distance should not pay for the position as well.
    const one: Record<string, string> =
      ctx.outlet === 'along' ? { along: `${measured}.y` } : { d: `${measured}.x` };
    return one;
  },
} satisfies NodeSpec;
