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
  weave: 'Rounded rectangular loops layered through three planes and tumbled as one object.',
  loom: 'Bundles of rounded loops repeated through space while the eye travels inside them.',
  orbits: 'Nested rings on fixed crossing planes, enclosed by one large orbit.',
  relief: 'A wall of bevelled frames, U modules, hooks and paired arcs while the eye travels over it.',
  iris: 'A lens-shaped shell enclosing a bank of parallel edge-on ribs.',
  truss: 'Parallel rounded-rectangle rails crossing around three planes as one cuboid armature.',
  rotor: 'Open swept blades repeated around the throat of a double-domed turbine cage.',
  tube: 'A helix winding away down a corridor the eye is inside.',
};

const values: Record<Mode, readonly PortSpec[]> = {
  torus: [],
  rings: [numberPort('apart', 'How far the rings spread out of each other.', 0.4)],
  frame: [numberPort('size', 'How large the cube is around the eye.', 0.45)],
  lattice: [numberPort('apart', 'How far apart the cells of the scaffold sit.', 0.4)],
  weave: [
    numberPort('apart', 'How far the parallel rectangular loops sit from each other.', 0.45),
    numberPort('corner', 'How round each rectangular loop becomes.', 0.55),
    numberPort('tumble', 'How far the complete woven object has tumbled.', 0),
  ],
  loom: [
    numberPort('apart', 'How far the parallel members in every bundle sit apart.', 0.45),
    numberPort('cells', 'How far apart the repeated woven cells sit.', 0.52),
    numberPort('travel', 'How far the eye has travelled through the repeating loom.', 0),
  ],
  orbits: [
    numberPort('nest', 'How far the inner orbit radii step down from the enclosing one.', 0.55),
    numberPort('tumble', 'How far the complete orbital object has tumbled.', 0),
  ],
  relief: [
    numberPort('tiles', 'How tightly the relief modules repeat across the plane.', 0.48),
    numberPort('raise', 'How deeply the bevelled modules are extruded.', 0.5),
    numberPort('travel', 'How far the eye has travelled around its closed path.', 0),
  ],
  iris: [
    numberPort('ribs', 'How tightly the parallel rings fill the shell.', 0.58),
    numberPort('open', 'How far the internal rings open inside the shell.', 0.55),
    numberPort('phase', 'Where the ribs sit between their edge-on bank and crossed pair.', 0),
  ],
  truss: [
    numberPort('apart', 'How far the four rails of each rectangular face sit apart.', 0.45),
    numberPort('corner', 'How round the rectangular face rails become.', 0.55),
    numberPort('tumble', 'Where the complete truss sits on its closed rigid oscillation.', 0),
  ],
  rotor: [
    numberPort('blades', 'How many open blades repeat around the rotor throat.', 0.55),
    numberPort('sweep', 'How far the blade sides curl and rise through the double dome.', 0.65),
    numberPort('tumble', 'Where the complete rotor sits on its closed rigid tumble.', 0),
  ],
  tube: [
    numberPort('coil', 'How tightly the helix winds as it goes away.', 0.35),
    numberPort('radius', 'How far the helix runs from the corridor axis.', 0.35),
    livePort('travel', 'How far the eye has travelled through the repeating helix.',
      'fract(uBeat * 0.0625)'),
  ],
};

/**
 * The one node with a third coordinate in it, and it keeps it to itself.
 *
 * The camera remains four numbers rather than a rig. Finite objects interpret
 * them as orbit, elevation and distance. The three travelling constructions
 * keep the same compact controls but give them the useful local meaning:
 * camera roll, path sway or grazing angle, and offset or altitude. Their own
 * normalized travel is the camera path; there is still no target or lens rig
 * to wire before a form can make a picture.
 */
export const FORM_NODE_SPEC = {
  name: 'form',
  description: 'A shape standing in space, lit by its own glow and drawn from a moving eye.',
  inlets: (node) => [
    pointPort('p', 'Where in the frame the ray is cast from.'),
    // Unwired, the eye drifts round about once every thirty-three beats. A
    // still 3D object reads as a photograph of one; the orbit is what says the
    // thing has a far side. Slow enough not to be the motion anyone notices.
    livePort('turn', 'Where the eye stands around the form, or its roll on a travelling form.', '(uBeat * 0.03)'),
    numberPort('tilt', 'How high the eye stands, or how its travelling path leans.', 0.7),
    numberPort('dolly', 'How far back the eye stands, or its offset from a travelling path.', 0.4),
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
    const extras = [0, 1, 2].map((index) =>
      values[op][index] ? ctx.read(values[op][index].name) : '0.0');
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
      ...extras,
    ];
    return { c: `laid(form_march(${args.join(', ')}), ${e})` };
  },
} satisfies NodeSpec;
