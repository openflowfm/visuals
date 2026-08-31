import { FORM_MODES } from '../../../protocol.ts';
import type { NodeSpec } from '../../render/circuit.ts';
import { FORM_WORK } from '../../render/glsl/form.ts';
import {
  colourPort,
  energyPort,
  livePort,
  numberPort,
  pointPort,
  type PortSpec,
} from '../../render/ports.ts';
import { modeOfNode } from '../mode.ts';

type Mode = (typeof FORM_MODES)[number];

const descriptions: Record<Mode, string> = {
  torus: 'One ring of tube, seen from wherever the eye is.',
  rings: 'Three rings on their own axes, precessing through each other on the beat.',
  frame: 'The twelve edges of a cube, drawn as rounded tubes.',
  lattice: 'That cube repeated through space, so the eye flies through a scaffold of it.',
  tube: 'A helix winding away down a corridor the eye is inside.',
};

const values: Record<Mode, readonly PortSpec[]> = {
  torus: [],
  rings: [numberPort('apart', 'How far the rings spread out of each other.', 0.4)],
  frame: [numberPort('size', 'How large the cube is around the eye.', 0.45)],
  lattice: [numberPort('apart', 'How far apart the cells of the scaffold sit.', 0.4)],
  tube: [numberPort('coil', 'How tightly the helix winds as it goes away.', 0.35)],
};

/**
 * The one node with a third coordinate in it, and it keeps it to itself.
 *
 * The camera is four numbers rather than a rig: where it stands around the
 * form, how high, how far off, and that is all. A form is a thing you turn
 * rather than a scene you shoot, and every control that would make it a scene
 * — a target, a roll, a lens length — is a control nobody would find a use for
 * on a wall behind a band.
 */
export const FORM_NODE_SPEC = {
  name: 'form',
  description: 'A shape standing in space, lit by its own glow and drawn from a moving eye.',
  inlets: (node) => [
    pointPort('p', 'Where in the frame the ray is cast from.'),
    // Unwired, the eye drifts round about once every thirty-three beats. A
    // still 3D object reads as a photograph of one; the orbit is what says the
    // thing has a far side. Slow enough not to be the motion anyone notices.
    livePort('turn', 'Where the eye stands around the form.', '(uBeat * 0.03)'),
    numberPort('tilt', 'How high the eye stands above the form.', 0.7),
    numberPort('dolly', 'How far back the eye stands.', 0.4),
    numberPort('thick', 'How thick the tube the form is drawn out of is.', 0.3),
    numberPort('flare', 'How far the light bleeds off the tubes as the ray passes them.', 0.4),
    numberPort('chrome', 'How much the surface reflects the room instead of glowing.', 0),
    energyPort(),
    ...values[modeOfNode(node, FORM_MODES)],
  ],
  outlets: [colourPort('c', 'The form, as a picture.')],
  modes: FORM_MODES.map((name) => ({ name, description: descriptions[name] })),
  // Charged at the step ceiling rather than at where the controls happen to
  // sit, for the reason `fractal` is: the controls are uniforms and may move
  // without recompiling, and a graph that is only safe while a number is low
  // is not safe.
  work: FORM_WORK,
  emit: (ctx) => {
    const op = modeOfNode(ctx.node, FORM_MODES);
    const e = ctx.read('energy');
    const extra = values[op][0] ? ctx.read(values[op][0].name) : '0.0';
    const args = [
      ctx.read('p'),
      e,
      String(FORM_MODES.indexOf(op)),
      ctx.read('turn'),
      ctx.read('tilt'),
      ctx.read('dolly'),
      ctx.read('thick'),
      ctx.read('flare'),
      ctx.read('chrome'),
      extra,
    ];
    return { c: `laid(form_march(${args.join(', ')}), ${e})` };
  },
} satisfies NodeSpec;
