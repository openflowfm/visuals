import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Circuit, CircuitNode, LookDef, Scheme, SongSpec } from '../protocol.ts';
import { repaired, splitPort } from '../src/render/circuit.ts';

/**
 * The scheme: every look there is, the colours they draw from, and the wheel
 * that turns through them. Read from `visuals/scheme.json`, hot-reloaded, and
 * entirely optional.
 *
 * **Everything here has a default that works**, which is the rule the file is
 * designed around. A rig that draws nothing until it has been configured is a
 * rig nobody configures, so the built-in scheme below is a complete show and the
 * file only ever overrides parts of it. Delete `scheme.json` and the picture
 * changes; it does not stop.
 *
 * ## What is not in it any more
 *
 * `layers`, `clips` and `archetypes` are gone, and with them the cascade. All
 * three existed to answer "how do two pictures combine", and a graph answers
 * that once — so what a track draws, what a section feels like and what a clip
 * makes an exception of are all things you wire rather than things you bind.
 *
 * What is left above the graph is deliberately small enough to read in one
 * screen: the looks, the colourways, which of them the rotation turns through,
 * and the handful of songs that want to say otherwise.
 */

/**
 * A look, spelled compactly, because a graph written as JSON is unreadable.
 *
 * **Laid out from the wiring rather than from the order it was typed.** These
 * are the four graphs anyone opens first, so where the nodes sit is part of what
 * they teach: a column per step along the signal, so the picture reads left to
 * right and the cords do not cross. A row-major grid put a `value` node between
 * two links in a chain and made a six-node look need untangling before it could
 * be read, which for the library that *is* the manual is the wrong first sight.
 */
/**
 * How far apart two nodes in one column are laid out.
 *
 * Tall enough for the tallest faceplate there is, which is a `track`: a picture,
 * two pickers and a control. Nodes grew when their pictures went to 16:9 and grew
 * again when `track` took on a second dropdown, and a spacing left at the old
 * height put the second row of every built-in through the first one.
 */
const ROW = 220;

/**
 * What a node holds on its number inlets, and how far a cord may carry each.
 *
 * A bare number is where the control sits: `{ segments: 0.3 }`. A pair is that
 * number **and** the range a cord moves it through, signed — `{ amount: [1, -1] }`
 * is an inlet sitting at one that a signal carries down to nothing, which is a
 * `subtract` node's worth of graph written as the polarity of a cord. One map
 * rather than two, because on the node's face they are one row.
 */
type Values = Record<string, number | [number, number]>;

/** That map, split into the two the node format keeps it in. */
function numbers(held?: Values): Pick<CircuitNode, 'values' | 'depths'> {
  const values: Record<string, number> = {};
  const depths: Record<string, number> = {};
  for (const [name, each] of Object.entries(held ?? {})) {
    values[name] = Array.isArray(each) ? each[0] : each;
    if (Array.isArray(each)) depths[name] = each[1];
  }
  return {
    ...(Object.keys(values).length ? { values } : {}),
    ...(Object.keys(depths).length ? { depths } : {}),
  };
}

function wire(
  name: string,
  nodes: [string, string, string?, Values?, number?, string?, string?, number?][],
  cords: string[],
): LookDef {
  const wired = cords.map((each) => {
    const [from, to] = each.split(' -> ');
    return { from, to };
  });
  const at = columnsOf(
    nodes.map(([id]) => id),
    wired,
  );
  const row = new Map<number, number>();
  return {
    name,
    circuit: {
      nodes: nodes.map(([id, kind, op, values, value, label, of, smooth]): CircuitNode => {
        const column = at.get(id) ?? 0;
        const depth = row.get(column) ?? 0;
        row.set(column, depth + 1);
        return {
          id,
          kind: kind as CircuitNode['kind'],
          x: 40 + column * 210,
          y: 40 + depth * ROW,
          ...(op ? { op } : {}),
          ...(of ? { of } : {}),
          ...numbers(values),
          ...(value !== undefined ? { value } : {}),
          ...(smooth !== undefined ? { smooth } : {}),
          ...(label ? { label } : {}),
        };
      }),
      cords: wired,
    },
  };
}

/**
 * How far along the signal each node sits: one past the furthest thing feeding
 * it, and zero for anything nothing feeds.
 *
 * Guarded against a graph that feeds itself even though none of these do, since
 * the only thing worse than a badly laid out built-in is a server that will not
 * start.
 */
function columnsOf(ids: readonly string[], cords: readonly { from: string; to: string }[]): Map<string, number> {
  const node = (address: string) => address.slice(0, address.lastIndexOf('/'));
  const feeders = new Map<string, string[]>();
  for (const cord of cords) {
    const to = node(cord.to);
    feeders.set(to, [...(feeders.get(to) ?? []), node(cord.from)]);
  }
  const at = new Map<string, number>();
  const walk = (id: string, seen: readonly string[]): number => {
    const held = at.get(id);
    if (held !== undefined) return held;
    if (seen.includes(id)) return 0;
    const column = (feeders.get(id) ?? []).reduce(
      (most, from) => Math.max(most, walk(from, [...seen, id]) + 1),
      0,
    );
    at.set(id, column);
    return column;
  };
  for (const id of ids) walk(id, []);
  return at;
}

/**
 * The library, which is a show on its own and is also the manual.
 *
 * Deliberately a spread rather than variations on one idea: one that is **only**
 * the set, one that **moves the point** the set is read at, one that puts the set
 * **inside** a picture that ships, one that ignores the set entirely and builds a
 * picture **out of a number**, and one built **out of three of the others**.
 * Between them they use every family in the vocabulary, which matters more than
 * it usually would — nobody reads a node reference, and everybody takes a working
 * example apart.
 *
 * Three rules they all keep, all learned the hard way.
 *
 * **Nothing here is only alive when the room is loud, and the shape of that is
 * `max`.** `master` is zero with no Live connected — most of the hours anyone
 * spends building one of these — and it is near zero between songs, when all
 * that is running is a click. A meter wired straight into an energy therefore
 * holds a generator at its dullest: fewest arms, slowest rung on the division
 * ladder, least charge. So every meter that reaches an energy arrives through
 *
 *     wave or playback ─> a ┐
 *                           ├ max ─> energy
 *     track master ──────> b ┘
 *
 * with the clock on a **range** — `{ a: [0.3, 0.4] }` is a floor of three tenths
 * that the clock lifts by four — and the meter taking over the moment it is
 * louder than that. `max` and not `average`, because an average with a silent
 * meter halves everything the clock is doing, which is how a floor becomes a
 * ceiling. Which clock is each look's own business and is most of its character.
 *
 * **A look that reads the set carries a picture underneath it.** A `tracks` node
 * draws nothing with no clip playing, so five of these went black between songs.
 * There is a ring under `Folded`, a grid under `Outline`, a wash under `Poster`
 * and a scan pattern under `Glitch`, each blended so a playing set is what you
 * see and each there when it is not. There is no exception: `The set` was one,
 * a lone `tracks` node that went black between songs, and a look that is one
 * node is a node — the browser already offers it under `draw`.
 *
 * **Nothing here is wired to something that cannot move it.** The old `Weather`
 * drove a `hue` from `song seed`, and a set with no song names holds that at a
 * half, which is exactly the rotation that does nothing: a cord drawn across the
 * canvas into a node that visibly never changed. A number that idles at a half
 * belongs on an inlet where a half means something.
 *
 * And one thing they teach by shape rather than by rule: **a number that goes to
 * one inlet is set on that inlet**, not wired in from a `value` node parked
 * beside it. Four of these used to be `value` nodes and are now numbers on a
 * face, which is four fewer cords across the four graphs anyone opens first. The
 * one left is in `Weather`, feeding two places, which is what that node is for.
 */
const BUILT_IN: Scheme = {
  looks: {
    // A colour is a function of a point. The set is read through a swirl that
    // sways once a bar, and the kaleidoscope folds the whole chain rather than
    // an image of it — which is the one idea the rest of the model falls out of.
    folded: wire(
      'Folded',
      [
        ['pt', 'point'],
        ['bar', 'playback', 'phase'],
        ['sway', 'wave', 'sine'],
        ['half', 'math', 'average'],
        ['turn', 'lens', 'swirl'],
        ['live', 'tracks', 'by name'],
        ['e', 'track', 'level', undefined, undefined, undefined, 'master', 0.35],
        // The floor under the meter, and the shape every look here now uses:
        // `max` of something on the clock and something on the room. See the
        // note above about a set that is only the click.
        ['lift', 'math', 'max', { a: [0.3, 0.35] }],
        // Rings, read at the *swirled* point, so what the kaleidoscope folds is
        // the set and a picture that is there when the set is not.
        ['rings', 'source', 'rings'],
        ['mix', 'blend', 'screen', { amount: 0.7 }],
        // The wedge count is set on the effect's own face rather than wired in
        // from a `value` node. One number, one place, no cord across the canvas.
        ['fold', 'lens', 'kaleido', { segments: 0.3 }],
        ['o', 'out'],
      ],
      [
        'bar/n -> sway/phase',
        // `b` is left at its own half, which halves the swing about centre —
        // an unwired inlet's answer, doing real work.
        'sway/n -> half/a',
        'pt/p -> turn/p',
        'half/n -> turn/turn',
        'turn/p -> live/p',
        'turn/p -> rings/p',
        'sway/n -> lift/a',
        'e/n -> lift/b',
        'lift/n -> rings/energy',
        'rings/c -> mix/base',
        'live/c -> mix/top',
        'mix/c -> fold/c',
        'lift/n -> fold/energy',
        'fold/c -> o/c',
      ],
    ),
    // Two pictures, one of them the room's. The set is wobbled by how loud the
    // room is — still when it is quiet — and screened into a corridor, then
    // graded. The blend node is what every layer stack this replaced was for.
    deep: wire(
      'Deep',
      [
        ['e', 'track', 'level', undefined, undefined, undefined, 'master', 0.4],
        // A snap on every beat, floored under the meter: the corridor gains
        // arms and rushes harder on the hit, and does it with nothing playing.
        ['beat', 'wave', 'pulse'],
        ['lift', 'math', 'max', { a: [0.32, 0.4] }],
        ['pt', 'point'],
        ['tun', 'source', 'tunnel'],
        // A wobble that sits at a sixth with the room silent rather than at
        // nothing, and the meter carries it up from there. `cWobble` runs on the
        // beat, so a constant amount is still a moving picture.
        ['wob', 'lens', 'wobble', { amount: [0.16, 0.45] }],
        ['live', 'tracks', 'by name'],
        // How much of the set is in the picture, and how hard the grade is:
        // both are numbers you turn while looking at the wall, and both live on
        // the node they belong to.
        ['mix', 'blend', 'screen', { amount: 0.75 }],
        ['grade', 'grade', 'levels', { gain: 0.62 }],
        ['o', 'out'],
      ],
      [
        'beat/n -> lift/a',
        'e/n -> lift/b',
        'lift/n -> tun/energy',
        'pt/p -> wob/p',
        'e/n -> wob/amount',
        'wob/p -> live/p',
        'tun/c -> mix/base',
        'live/c -> mix/top',
        'mix/c -> grade/c',
        'grade/c -> o/c',
      ],
    ),
    // No set at all, and no picture that ships either: `polar` turns a position
    // into two numbers, `paint` turns one of them into the colourway, and `hue`
    // turns the other into every colour there is. The song moves the grain, so
    // one set of files is a different weather per song.
    //
    // It is also the one that still has a `value` node in it, doing the job
    // that node is now for: **one number in two places**. `weight` says how
    // heavy the weather is, and thickening the grain without hardening the glow
    // under it would be two dials for one idea.
    weather: wire(
      'Weather',
      [
        ['pt', 'point'],
        ['pol', 'polar'],
        ['weight', 'value', undefined, undefined, 0.75, 'weight'],
        // A full `a`, so the subtraction is one minus the radius — a disc that
        // fades from the middle out. Set on the node, since nothing else in the
        // graph has any business knowing that number.
        ['fade', 'math', 'subtract', { a: 1 }],
        ['grain', 'source', 'noise'],
        ['glow', 'paint'],
        ['tint', 'grade', 'hue'],
        ['song', 'song', 'seed'],
        ['mix', 'blend', 'screen'],
        ['o', 'out'],
      ],
      [
        'pt/p -> pol/p',
        'pol/radius -> fade/b',
        'fade/n -> glow/amount',
        'glow/c -> tint/c',
        'pol/angle -> tint/shift',
        'weight/n -> grain/energy',
        'weight/n -> glow/energy',
        'tint/c -> mix/base',
        'grain/c -> mix/top',
        'song/n -> mix/amount',
        'mix/c -> o/c',
      ],
    ),
    // Refraction, which is what water actually is: a surface that displaces
    // what you see *through* it rather than a blue thing drawn on top. The
    // wobble moves the point the plasma is read at, `ripple` moves it again on
    // the beat, and `smear` softens the result the way depth does.
    //
    // The drift is the one thing here deliberately **not** in time. Water does
    // not obey a bar, so `time` goes through a multiply to slow it to a cycle
    // every eight seconds or so — the one place a number outside 0–1 is useful,
    // and why `math` takes what it is given rather than clamping.
    water: wire(
      'Water',
      [
        ['pt', 'point'],
        ['t', 'playback', 'time'],
        ['slow', 'math', 'multiply', { b: 0.12 }],
        ['sway', 'wave', 'sine'],
        ['wob', 'lens', 'wobble'],
        ['e', 'track', 'level', undefined, undefined, undefined, 'master', 0.55],
        // The same sine that moves the surface is the floor under the meter, so
        // the water is finer and quicker on the swell and never flat calm.
        ['lift', 'math', 'max', { a: [0.3, 0.3] }],
        ['surf', 'source', 'plasma'],
        ['rip', 'lens', 'ripple', { waves: 0.72, depth: 0.4, speed: 0.22 }],
        ['soft', 'spread', 'smear', { reach: 0.2, drive: 0.35 }],
        // A lifted floor and a gain just under neutral: milky rather than
        // contrasty, because nothing underwater has a hard edge — but not so
        // soft that the ripple it is there to carry stops reading.
        ['milk', 'grade', 'levels', { gain: 0.52, lift: 0.6 }],
        ['o', 'out'],
      ],
      [
        't/n -> slow/a',
        'slow/n -> sway/phase',
        'pt/p -> wob/p',
        'sway/n -> wob/amount',
        'wob/p -> surf/p',
        'sway/n -> lift/a',
        'e/n -> lift/b',
        'lift/n -> surf/energy',
        'surf/c -> rip/c',
        'lift/n -> rip/energy',
        'rip/c -> soft/c',
        'soft/c -> milk/c',
        'milk/c -> o/c',
      ],
    ),
    // A portal that turns rather than recedes. `zoom` is driven by the beat
    // pulse, so the whole spiral punches inward on every hit and falls back out
    // across it — a portal you feel the tempo through, where `Deep` is one you
    // travel down.
    vortex: wire(
      'Vortex',
      [
        ['pt', 'point'],
        ['hit', 'playback', 'pulse'],
        ['zm', 'lens', 'zoom'],
        ['e', 'track', 'level', undefined, undefined, undefined, 'master', 0.3],
        // The pulse that punches the zoom is also the floor under the meter, so
        // the spiral grows arms and turns harder on the same hit rather than
        // sitting at two arms all night in a quiet room.
        ['lift', 'math', 'max', { a: [0.3, 0.45] }],
        ['sp', 'source', 'spiral'],
        ['tw', 'lens', 'twist', { turn: 0.68, sway: 0.4 }],
        // A short reach and a floor high enough that only the arms bloom. Wide
        // open it welds the spiral into two flat colours, which is the failure
        // this effect always has: it is the cheapest way to look expensive and
        // the cheapest way to lose every edge you had.
        ['glow', 'spread', 'bloom', { reach: 0.34, floor: 0.34 }],
        ['o', 'out'],
      ],
      [
        'pt/p -> zm/p',
        'hit/n -> zm/by',
        'hit/n -> lift/a',
        'e/n -> lift/b',
        'zm/p -> sp/p',
        'lift/n -> sp/energy',
        'sp/c -> tw/c',
        'lift/n -> tw/energy',
        'tw/c -> glow/c',
        'lift/n -> glow/energy',
        'glow/c -> o/c',
      ],
    ),
    // Two pictures read at two different points and added, then folded about a
    // line. A corridor through a kaleidoscope with rings coming up it — the one
    // that shows most plainly that geometry happens *before* the picture, since
    // `fold` and `pt` feed two sources that never meet until the blend.
    gateway: wire(
      'Gateway',
      [
        ['pt', 'point'],
        ['fld', 'lens', 'fold', { sides: 0.45 }],
        ['e', 'track', 'level', undefined, undefined, undefined, 'master', 0.35],
        // A saw rather than a pulse: the corridor and the rings ramp up across
        // each beat and drop, so the gate breathes instead of twitching.
        ['ramp', 'wave', 'saw'],
        ['lift', 'math', 'max', { a: [0.28, 0.4] }],
        ['tun', 'source', 'tunnel'],
        ['rng', 'source', 'rings'],
        ['mix', 'blend', 'add', { amount: 0.6 }],
        ['mir', 'lens', 'mirror', { line: 0.5, angle: 0.25 }],
        ['o', 'out'],
      ],
      [
        'pt/p -> fld/p',
        'ramp/n -> lift/a',
        'e/n -> lift/b',
        'fld/p -> tun/p',
        'lift/n -> tun/energy',
        'pt/p -> rng/p',
        'lift/n -> rng/energy',
        'tun/c -> mix/base',
        'rng/c -> mix/top',
        'mix/c -> mir/c',
        'mir/c -> o/c',
      ],
    ),
    // The set as a diagram. `edge` keeps the outline and throws the fill away,
    // which is the one effect here that makes a busy frame *less* busy — and a
    // wall full of outlines is legible at a distance no filled picture is.
    //
    // **A grid under the set, and one junction read twice.** With no clip
    // playing there is nothing to outline, and a look whose whole job is edges
    // had none between songs. The grid supplies them — cells lighting on their
    // own beats, which an outline detector turns into a wireframe — and the set
    // lands `over` it, so a playing set is what you see and the grid is what is
    // there when it is not. The blend is then read twice, once for the outline
    // and once, dimmed, as the ghost underneath, so the shapes have somewhere to
    // sit. That is one `tracks` node where there were two, and one fewer thing
    // to keep in step.
    outline: wire(
      'Outline',
      [
        ['beat', 'wave', 'sine'],
        ['breath', 'math', 'average'],
        ['grid', 'source', 'grid'],
        ['ink', 'tracks', 'by name'],
        ['bed', 'blend', 'over'],
        // A wide tap and a hard gain. The gradient of a soft picture is a very
        // small number, so an outline drawn at the effect's own middle is one
        // you can only see in a dark room — which is the whole point of the
        // look and the one thing it was failing at.
        ['cut', 'spread', 'edge', { width: 0.72, gain: 0.85 }],
        ['pale', 'grade', 'levels', { gain: 0.6, lift: 0.74 }],
        ['ghost', 'grade', 'levels', { gain: 0.34, lift: 0.46 }],
        ['mix', 'blend', 'screen', { amount: 0.85 }],
        ['o', 'out'],
      ],
      [
        'beat/n -> breath/a',
        'breath/n -> grid/energy',
        'grid/c -> bed/base',
        'ink/c -> bed/top',
        'bed/c -> cut/c',
        'cut/c -> pale/c',
        'bed/c -> ghost/c',
        'ghost/c -> mix/base',
        'pale/c -> mix/top',
        'mix/c -> o/c',
      ],
    ),
    // Flat bands of colour, and the one look that changes with the *music*
    // rather than with the playing. `posterize` quantises the set to four steps
    // — its own middle is fourteen, which is invisible, so the number is set on
    // the node — and `song key` rotates the hue, so two songs a fifth apart are
    // two palettes and the same song is always the same one.
    poster: wire(
      'Poster',
      [
        // A wash under the set, so there is something to cut bands out of when
        // nothing is playing. Its energy is a sine on the beat, which for a
        // picture about to be quantised to four steps is not a frequency change
        // you watch — it is the bands themselves breathing.
        ['swell', 'wave', 'sine'],
        // Halved about a half, the way `Folded` halves its swirl: `b` left at
        // its own middle turns a full swing into a quarter either side, which
        // for a spatial frequency is the difference between breathing and
        // lurching.
        ['breath', 'math', 'average'],
        ['wash', 'source', 'plasma'],
        ['live', 'tracks', 'by name'],
        ['bed', 'blend', 'screen', { amount: 0.75 }],
        // Lifted *before* the quantise, not after. Four steps taken out of a
        // dark picture are four dark steps, and no amount of grading afterwards
        // puts back a band that was never cut.
        ['punch', 'grade', 'levels', { gain: 0.68, lift: 0.66 }],
        ['flat', 'grade', 'posterize', { steps: 0.78 }],
        ['key', 'song', 'key'],
        // Halved about no-shift, because `hue` reads a half as "leave it alone"
        // and a pitch class reads C as zero — so the key wired straight in put
        // every song in C at a full half-turn, which is the one rotation that
        // makes the colourway its own opposite. Averaged, the whole set of keys
        // swings a quarter-turn either side of the colours you chose.
        ['centre', 'math', 'average'],
        ['tint', 'grade', 'hue'],
        ['o', 'out'],
      ],
      [
        'swell/n -> breath/a',
        'breath/n -> wash/energy',
        'wash/c -> bed/base',
        'live/c -> bed/top',
        'bed/c -> punch/c',
        'punch/c -> flat/c',
        'flat/c -> tint/c',
        'key/n -> centre/a',
        'centre/n -> tint/shift',
        'tint/c -> o/c',
      ],
    ),
    // Four effects in a row and nothing else, which is the other end of the
    // vocabulary from `The set`. Rows thrown sideways, quantised to blocks, the
    // channels pulled apart on transients, and the whole thing inverted on the
    // beat and back.
    //
    // A fast fall on the envelope is the point: everything else here breathes,
    // and this one twitches.
    glitch: wire(
      'Glitch',
      [
        // Lines to throw about when the set is not playing any. `scan` is the
        // one source that looks like a machine rather than like weather, which
        // is the right thing to find underneath a broken picture.
        ['scan', 'source', 'scan'],
        ['live', 'tracks', 'by name'],
        ['bed', 'blend', 'over'],
        ['e', 'track', 'level', undefined, undefined, undefined, 'master', 0.12],
        ['twitch', 'wave', 'pulse'],
        // A low floor and a wide reach: this is the one that should still be
        // twitching on the click, and the one that should go off in a loud room.
        ['lift', 'math', 'max', { a: [0.25, 0.5] }],
        ['cut', 'lens', 'slice', { bands: 0.5, throw: 0.45 }],
        ['px', 'lens', 'pixelate', { blocks: 0.22, resolve: 0.8 }],
        ['rgb', 'spread', 'shift', { split: 0.45, drive: 0.7 }],
        ['flip', 'grade', 'invert', { hold: 0.28, rate: 0.6 }],
        // Last, so the lift is on the glitch rather than on the set: brightening
        // first would have `shift` pulling apart channels that were already at
        // the top and the aberration would go white instead of coloured.
        ['up', 'grade', 'levels', { gain: 0.58, lift: 0.72 }],
        ['o', 'out'],
      ],
      [
        'scan/c -> bed/base',
        'live/c -> bed/top',
        'twitch/n -> lift/a',
        'e/n -> lift/b',
        'lift/n -> scan/energy',
        'bed/c -> cut/c',
        'lift/n -> cut/energy',
        'cut/c -> px/c',
        'lift/n -> px/energy',
        'px/c -> rgb/c',
        'lift/n -> rgb/energy',
        'rgb/c -> flip/c',
        'lift/n -> flip/energy',
        'flip/c -> up/c',
        'up/c -> o/c',
      ],
    ),
    // A lamp, and the one picture here that keeps no time at all. `noise` is a
    // field with a threshold on it, so what decides whether it reads as fog or as
    // blobs is where that threshold sits — and `heat` walks it, slowly, off
    // `time` rather than off the beat, because wax does not know what a bar is.
    //
    // The meter is the other half of `heat` and it only ever adds: at a desk the
    // lamp still rises and falls on its own, and a loud room fattens the wax until
    // the blobs run together. A long envelope on it, because lava has weight.
    //
    // `paint` is the bulb behind the glass, and it is the one wired with a
    // **negative depth**: the inlet sits at one and the distance from the centre
    // carries it down to nothing, which is a `subtract` node's worth of graph
    // written as the polarity of a cord. `Weather` fades the same disc the older
    // way, one node heavier, and both are worth having in front of somebody.
    lava: wire(
      'Lava',
      [
        ['pt', 'point'],
        ['t', 'playback', 'time'],
        // A cycle every seventeen seconds or so. The same unclamped multiply
        // `Water` drifts on, slower, and for the same reason.
        ['slow', 'math', 'multiply', { b: 0.06 }],
        ['rise', 'wave', 'sine'],
        ['e', 'track', 'level', undefined, undefined, undefined, 'master', 0.7],
        // `max`, and the rise arrives on a range rather than whole: the wax sits
        // between a seventh and a third of the frame all on its own, and the
        // meter only shows up when the room is louder than that. Wired to the
        // full swing it emptied the glass at the bottom of every cycle, which is
        // a lamp that keeps switching itself off.
        ['heat', 'math', 'max', { a: [0.38, 0.28] }],
        // Magnified, and breathing with the same number: the blobs swell as they
        // fatten and shrink back as they thin.
        ['swell', 'lens', 'zoom', { by: [0.6, -0.1] }],
        ['wax', 'source', 'noise'],
        // Bloom rather than smear, and the reason is the desk. Both scale their
        // reach with the meter, and a smear shrunk to three hundredths of the
        // frame is a softening nobody can see — where a bloom's ring still reads
        // as a halo with nothing playing at all. Most of the hours spent making
        // one of these are spent in a quiet room.
        ['glow', 'spread', 'bloom', { reach: 0.42, floor: 0.3 }],
        // The one thing here in time, and it is the bulb rather than the wax: a
        // snap of contrast on each beat, sixteen hundredths deep. Lava that
        // moved on the beat would stop being lava, but a lamp with a band on the
        // other side of the room is allowed to flicker with them.
        ['throb', 'wave', 'pulse'],
        ['melt', 'grade', 'levels', { gain: [0.5, 0.16], lift: 0.62 }],
        ['pol', 'polar'],
        ['lamp', 'paint', undefined, { amount: [1, -1] }],
        ['mix', 'blend', 'screen', { amount: 0.9 }],
        ['o', 'out'],
      ],
      [
        't/n -> slow/a',
        'slow/n -> rise/phase',
        'rise/n -> heat/a',
        'e/n -> heat/b',
        'heat/n -> wax/energy',
        'pt/p -> swell/p',
        'rise/n -> swell/by',
        'swell/p -> wax/p',
        'wax/c -> glow/c',
        'heat/n -> glow/energy',
        'glow/c -> melt/c',
        'throb/n -> melt/gain',
        'pt/p -> pol/p',
        'pol/radius -> lamp/amount',
        'heat/n -> lamp/energy',
        'lamp/c -> mix/base',
        'melt/c -> mix/top',
        'mix/c -> o/c',
      ],
    ),
    // Lightning, which is two things: something jagged and bright, and the
    // waiting. `random` is a new number every beat and a `wave` on `pulse` snaps
    // to one on each beat and is gone inside a fifth of it, so their product is a
    // strike that is a different size every time.
    //
    // **The random is squared**, which is the whole of the waiting. Uniform, it
    // strikes hard every other beat and reads as a flicker; multiplied by itself,
    // most beats get almost nothing and about one in three is a real hit — and
    // nothing about that is a threshold anyone has to tune.
    //
    // The strike then does three things and no more: it opens the blend the
    // crackle arrives through, it throws the broken pieces further apart, and it
    // lights the whole room through `paint`.
    //
    // A bolt is an `edge` of a noise field — the contour where the noise crosses
    // its threshold, kept, with the field itself thrown away — and `slice` throws
    // rows of that contour sideways, which is what makes it read as forked rather
    // than as an outline.
    //
    // **`playback pulse` is deliberately not what fires it**, and this is worth
    // knowing before wiring one: that signal decays across whatever division
    // `rate` picked, so at one strike every eight beats it is a swell four beats
    // long rather than a flash. A `wave` normalises to the beat and stays sharp.
    //
    // **The field's energy is floored, not gated.** How fine the noise is decides
    // how many contours there are to crack, and the strike wired straight into it
    // lit half the wall white; a narrow range off the same beat gives a sky that
    // boils a little and a few more cracks on the hit, and the meter takes it
    // further in a loud room. The slice's energy is **left unwired** — the room's
    // — so the rows re-throw on a musical division of their own and no two
    // strikes break the same way.
    storm: wire(
      'Storm',
      [
        ['sky', 'source', 'plasma'],
        ['cloud', 'source', 'noise'],
        ['hit', 'wave', 'pulse'],
        ['dice', 'playback', 'random'],
        ['e', 'track', 'level', undefined, undefined, undefined, 'master', 0.3],
        // A narrow range on purpose. The field's energy is how many contours
        // there are to crack, and a full swing wired here lit half the wall
        // white — a fifth of the way up, on the beat, is a sky that boils a
        // little and a bolt with somewhere to go.
        ['bank', 'math', 'max', { a: [0.12, 0.26] }],
        // The same outlet into both inlets: a number multiplied by itself, which
        // is the cheapest way to make a chance rare rather than even.
        ['odds', 'math', 'multiply'],
        ['strike', 'math', 'multiply'],
        // A wide tap and a hard gain, for the same reason `Outline` needs them:
        // the gradient of a soft picture is a very small number.
        ['bolt', 'spread', 'edge', { width: 0.52, gain: 0.88 }],
        // The throw sits low and the strike carries it up, so the segments only
        // fly apart on the hit and the sky is still between them.
        ['jag', 'lens', 'slice', { bands: 0.66, throw: [0.24, 0.4] }],
        ['dim', 'grade', 'levels', { gain: 0.32, lift: 0.4 }],
        ['crack', 'blend', 'add'],
        ['glare', 'paint'],
        ['lit', 'blend', 'screen', { amount: 0.55 }],
        ['o', 'out'],
      ],
      [
        'dice/n -> odds/a',
        'dice/n -> odds/b',
        'hit/n -> strike/a',
        'odds/n -> strike/b',
        'hit/n -> bank/a',
        'e/n -> bank/b',
        'bank/n -> sky/energy',
        'bank/n -> cloud/energy',
        'cloud/c -> bolt/c',
        'bolt/c -> jag/c',
        'strike/n -> jag/throw',
        'sky/c -> dim/c',
        'dim/c -> crack/base',
        'jag/c -> crack/top',
        // Nothing set under this cord, which is the older reading and still the
        // right one here: between strikes the crackle should not be there at all.
        'strike/n -> crack/amount',
        'strike/n -> glare/amount',
        'crack/c -> lit/base',
        'glare/c -> lit/top',
        'lit/c -> o/c',
      ],
    ),
    // Three of the others, as three nodes. The claim the vocabulary makes about
    // itself — a look is a picture, so a look goes wherever a picture goes — and
    // the only one of these you cannot read without believing it.
    //
    // `Water` is the wash, `Vortex` is folded into a window by a kaleidoscope
    // that never touches its insides, and `Outline` puts the set's own edges on
    // top. The fold is wired **point first**: `kaleido`'s `p` outlet into the look
    // node's own point inlet, which is the whole reason that inlet exists. The
    // sub-graph is evaluated at the folded point rather than folded afterwards,
    // so the spiral bends into the wedges instead of being a picture of a spiral
    // cut into pieces.
    //
    // It is also the most expensive look here by some way, and worth knowing why:
    // `Vortex` ends in a `bloom` and `Water` in a `smear`, so one frame of this
    // is nine evaluations of that spiral plus six of that plasma. Nesting does
    // not add, it multiplies — which is the thing `MAX_LINES` is watching for.
    lot: wire(
      'The lot',
      [
        ['pt', 'point'],
        ['fold', 'lens', 'kaleido', { segments: 0.24, spin: 0.62 }],
        ['wheel', 'look', 'vortex'],
        ['tide', 'look', 'water'],
        ['ink', 'look', 'outline'],
        ['e', 'track', 'level', undefined, undefined, undefined, 'master', 0.4],
        // Open enough to see with nothing playing, and the meter brings the
        // window up over the wash rather than switching it on.
        ['mix', 'blend', 'screen', { amount: [0.55, 0.35] }],
        ['over', 'blend', 'add', { amount: 0.7 }],
        ['o', 'out'],
      ],
      [
        'pt/p -> fold/p',
        'fold/p -> wheel/p',
        'tide/c -> mix/base',
        'wheel/c -> mix/top',
        'e/n -> mix/amount',
        'mix/c -> over/base',
        'ink/c -> over/top',
        'over/c -> o/c',
      ],
    ),
  },
  colorways: {
    // Five each, and **saturated is not the same as bright**, which is what the
    // old four confused. They were kept pale on the true argument that a cheap
    // projector has no black to work against — and pale is not what that
    // argument asks for. A colour at 90% lightness has given away almost all of
    // its hue whatever its saturation says, so a wall lit from one of those was
    // four shades of off-white with a tint on them.
    //
    // These sit where a hue is loudest and stay clear of the dark end. Each is
    // built the way [the roll](../roll.ts) builds one: **the first is the
    // loudest**, because a look that ignores the set draws every generator from
    // `colors[0]`; one member answers it from across the wheel, so nothing is a
    // wall in a single colour; and one is a **tint** rather than a white, light
    // enough to read edges against and coloured enough to belong.
    ember: ['#ff5a1f', '#ffb703', '#00c4ff', '#ff2d55', '#ffe3c2'],
    cold: ['#00a2ff', '#00e5d0', '#ff7a29', '#6a5cff', '#d8f1ff'],
    acid: ['#b4ff00', '#00ffa8', '#c400ff', '#ffe600', '#eaffc2'],
    dusk: ['#b026ff', '#ff2d95', '#ffe600', '#2ee6ff', '#f6d6ff'],
  },
  rotation: {
    // Empty pools mean "everything", so a fresh clone turns through all four
    // looks and all four colourways without anyone filling anything in.
    looks: [],
    colorways: [],
    // Eight bars. Long enough to read as a section and short enough that a
    // four-minute song is not one picture.
    bars: 8,
    onClip: true,
    // The palette turns half as often as the look, so a change is usually one
    // thing moving rather than everything at once.
    colorEvery: 16,
  },
  songs: {},
  defaults: {
    colorway: 'ember',
    look: 'folded',
    pace: 0,
    draws: 'by name',
  },
};
const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = process.env.BSV_VISUALS_SCHEME ?? path.resolve(here, '../scheme.json');

export interface SchemeSource {
  current(): Scheme;
  /**
   * Replace it wholesale and write it back to disk.
   *
   * The file stays the record — the editor is a way of writing it, not a second
   * place the truth lives. Which also means a scheme edited in the browser is
   * one you can read, diff and commit afterwards.
   */
  replace(next: Scheme): void;
  /** The last parse failure, or null. Shown in the panel rather than logged away. */
  error(): string | null;
  stop(): void;
}

/**
 * Loads the scheme and follows the file.
 *
 * Watched rather than read once because the whole point of a file is that you
 * edit it with the picture on screen next to you. A parse failure **keeps the
 * scheme that was already working** and reports the message — losing the show
 * because of a trailing comma is the wrong answer at any time and an unthinkable
 * one during a set.
 */
export function openScheme(): SchemeSource {
  let scheme = BUILT_IN;
  let error: string | null = null;
  let watcher: fs.FSWatcher | null = null;
  let debounce: NodeJS.Timeout | null = null;
  /**
   * The file lags the edit by a moment, deliberately.
   *
   * A control turning and a node being dragged both emit on every pointer move, so
   * an editor mid-gesture sends sixty schemes a second. What it holds is
   * published immediately — the show must follow the pointer — but writing the
   * file that often would put a synchronous write in the middle of a drag for
   * no benefit, since nobody reads the file until the gesture is over.
   */
  let pending: NodeJS.Timeout | null = null;
  /**
   * The last thing we wrote ourselves.
   *
   * Saving from the editor changes the file, which wakes the watcher, which
   * would re-read and re-publish what the editor already has — harmless but for
   * one thing: the re-read lands a render or two later and would yank a control
   * out from under a drag. Recognising our own write is what stops that.
   */
  let written: string | null = null;

  const load = () => {
    if (!fs.existsSync(FILE)) {
      scheme = BUILT_IN;
      error = null;
      return;
    }
    let text: string;
    try {
      text = fs.readFileSync(FILE, 'utf8');
    } catch {
      return;
    }
    if (written !== null && text.trim() === written.trim()) return;
    written = null;
    try {
      const parsed = JSON.parse(text) as Partial<Scheme>;
      scheme = merge(parsed);
      error = null;
      console.log(`visuals: scheme loaded from ${path.relative(process.cwd(), FILE)}`);
    } catch (err) {
      error = (err as Error).message;
      console.warn(`visuals: scheme not reloaded — ${error}`);
    }
  };

  load();

  try {
    // The directory, not the file: editors write by renaming a temp file over
    // the target, which breaks a watch on the inode and would silently stop
    // reloading after the first save.
    watcher = fs.watch(path.dirname(FILE), (_event, name) => {
      if (name && name !== path.basename(FILE)) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(load, 120);
    });
  } catch {
    // A platform without directory watching still runs; it just needs a restart.
  }

  return {
    current: () => scheme,
    error: () => error,
    replace(next) {
      scheme = merge(next);
      error = null;
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => {
        pending = null;
        write(next);
      }, 200);
    },
    stop() {
      if (debounce) clearTimeout(debounce);
      if (pending) {
        clearTimeout(pending);
        write(scheme);
      }
      watcher?.close();
    },
  };

  function write(next: Scheme) {
    // Written over whatever the file already held rather than in place of it,
    // and indented rather than minified. The file is meant to be read, edited
    // by hand and committed — the editor is a way of writing the record, not a
    // second place the truth lives. Without this, the first turn of a control
    // flattens it to one line and silently drops the `_` block explaining what
    // every key means.
    let held: Record<string, unknown> = {};
    try {
      held = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Record<string, unknown>;
    } catch {
      // No file yet, or an unparseable one we are about to replace anyway.
    }
    // Ours, so the watcher ignores the change it is about to see.
    written = JSON.stringify({ ...held, ...next }, null, 2);
    try {
      fs.writeFileSync(FILE, `${written}\n`);
    } catch (err) {
      error = `could not write ${path.basename(FILE)}: ${(err as Error).message}`;
    }
  }
}

/**
 * A file overrides the built-in scheme one section at a time.
 *
 * Shallow per section, deliberately. Naming one colourway should not delete the
 * other three, and registering one look should not remove the four that ship.
 *
 * **This is the one door**, and it is why every graph is repaired here. A scheme
 * reaches the renderer exactly two ways — read off disk, or sent up by an editor
 * that gets it straight back down again — and both of them come through this
 * function. So a look that arrived without an `out`, with two of them, or with a
 * cord addressed to a port that is not there leaves here as a look, once, and is
 * written back in that shape the next time anything saves. The alternative was
 * repairing where the damage shows: in the compiler, which would silently redo
 * the same fix on every frame and never write it down, or in the editor, which
 * would need it in four places and would not cover the file at all.
 */
export function merge(raw: Partial<Scheme>): Scheme {
  const file = carried(raw);
  return {
    // Carried rather than rebuilt, so a rolled show can still say where it came
    // from after a reload. Without it the seed lived exactly as long as the tab.
    ...(file.seed ? { seed: file.seed } : {}),
    looks: whole({ ...BUILT_IN.looks, ...(file.looks ?? {}) }),
    colorways: { ...BUILT_IN.colorways, ...(file.colorways ?? {}) },
    rotation: { ...BUILT_IN.rotation, ...(file.rotation ?? {}) },
    songs: songsOf(file.songs),
    defaults: { ...BUILT_IN.defaults, ...(file.defaults ?? {}) },
  };
}

/**
 * Every look, as the model requires one.
 *
 * `repaired` is the whole of it and it is cheap — a walk of the nodes and a walk
 * of the cords per look, once per file change and once per save. It returns the
 * same graph untouched for anything the editor made, which is nearly everything.
 */
function whole(looks: Record<string, LookDef>): Record<string, LookDef> {
  const out: Record<string, LookDef> = {};
  for (const [id, def] of Object.entries(looks)) out[id] = { ...def, circuit: repaired(def.circuit) };
  return out;
}

/**
 * A scheme written when the cascade existed.
 *
 * Most of an old file describes things that no longer have anywhere to live —
 * `layers`, `clips` and `archetypes` are all answers to a question a graph
 * answers now — so they are dropped rather than translated. Inventing a graph
 * out of a layer binding would produce something nobody wrote and nobody wants
 * to debug.
 *
 * **What is carried is what a person made**: the colourways, which song draws
 * from which, and any look that was a graph. A look that was a built-in is not
 * carried, because a built-in is a node mode now and a library full of
 * twenty-three entries called "Ripple" that are one node each is worse than an
 * empty one.
 *
 * Carried rather than migrated in place: the file is not rewritten until someone
 * saves, and then it is written in the new spelling.
 */
function carried(file: Partial<Scheme> & Legacy): Partial<Scheme> {
  const out: Partial<Scheme> = { ...file };
  delete (out as Legacy).layers;
  delete (out as Legacy).clips;
  delete (out as Legacy).archetypes;
  delete (out as Legacy).effects;

  const looks = file.looks ?? (file as Legacy).effects;
  if (looks) {
    const kept: Record<string, LookDef> = {};
    for (const [id, def] of Object.entries(looks)) {
      const circuit = (def as LookDef & { builtin?: string }).circuit;
      if (!circuit) continue;
      kept[id] = { ...def, circuit: reword(circuit) };
    }
    out.looks = kept;
  }

  const old = (file as Legacy).defaults;
  if (old) out.defaults = { ...BUILT_IN.defaults, pace: old.pace ?? 0, colorway: old.colorway ?? BUILT_IN.defaults.colorway, look: BUILT_IN.defaults.look, draws: BUILT_IN.defaults.draws };

  return out;
}

/**
 * A kind that used to exist, for a file that still spells one — and the fields
 * that changed their names rather than their meanings.
 *
 * `knobs` is what `values` was called, back when the word for a number set on
 * an inlet was the shape of the control that set it.
 */
type Was = Omit<CircuitNode, 'kind'> & {
  knobs?: Record<string, number>;
  kind:
    | CircuitNode['kind']
    | 'sample'
    | 'signal'
    | 'energy'
    | 'effect'
    | 'hue'
    | 'levels'
    | 'fold'
    | 'swirl'
    | 'zoom'
    | 'wobble'
    | 'tile';
};

/** The five geometry kinds, which are `lens` modes now and were always its functions. */
const WAS_GEOMETRY = ['fold', 'swirl', 'zoom', 'wobble', 'tile'] as const;

/** Where each old `effect` mode went when `effect` turned out to be three things. */
const WAS_EFFECT: Record<string, CircuitNode['kind']> = {
  mirror: 'lens',
  kaleido: 'lens',
  pixelate: 'lens',
  ripple: 'lens',
  slice: 'lens',
  twist: 'lens',
  posterize: 'grade',
  invert: 'grade',
  bloom: 'spread',
  smear: 'spread',
  edge: 'spread',
  shift: 'spread',
};

/**
 * `knobs`, under the name it has now.
 *
 * The field is dropped rather than left beside its replacement, because
 * `scheme.json` is a file somebody reads and diffs and two spellings of one map
 * in it is a question nobody should have to answer. A node that already says
 * `values` comes back untouched, which is nearly every node in nearly every
 * file — and one that somehow says both keeps `values`, since that is the one
 * anything since the rename has been writing.
 */
function revalued(node: Was): Was {
  if (!node.knobs) return node;
  const next: Was = { ...node, values: { ...node.knobs, ...node.values } };
  delete next.knobs;
  return next;
}

/**
 * A `track` node's old `value`, under the one name it has now.
 *
 * A file that already says `smooth` wins if it somehow says both. The old key
 * is deleted rather than left beside the new one, both because `value` now has
 * exactly one meaning and because the saved scheme is meant to be read.
 */
function resmoothed(node: Was): Was {
  if (node.kind !== 'track' || node.value === undefined) return node;
  const next: Was = { ...node, smooth: node.smooth ?? node.value };
  delete next.value;
  return next;
}

/** An inlet renamed out of a collision with a mode or a kind beside it. */
function swapValue(
  values: Record<string, number> | undefined,
  was: string,
  now: string,
): Record<string, number> | undefined {
  if (!values || values[was] === undefined) return values;
  const next = { ...values, [now]: values[was] };
  delete next[was];
  return next;
}

/**
 * A graph written against an older vocabulary.
 *
 * Every scheme on every machine arrives through here, so this is where a
 * renaming stops being a breaking change. Four so far:
 *
 * `sample` read "the frame that arrived", which was the layer underneath in a
 * stack — the nearest thing to that now is the set's own picture, so it becomes
 * `tracks`. Two `signal` modes went with the cascade: `energy` is its own
 * question and `amount` described how far a look was dialled into a stack,
 * which is not a thing any more. Both fall back to the meter.
 *
 * `signal` is **`playback`**, unchanged but for the word: it is where the music
 * is now, and it sat next to a `song` node that was also, unhelpfully, a signal.
 *
 * `energy` is **`track`**, which is the merge this pass exists for. It was
 * `track` with an envelope on it — same signature, same bank, named the same
 * way — so it is a `track` reading a level with its smoothing already turned
 * up. And `track` itself moves its name from `op` to `of`, because the node now
 * has to say which track *and* which of its numbers; its outlet goes from
 * `level` to the `n` every other number outlet in the vocabulary already used,
 * which is why the cords are walked too.
 *
 * Two are spellings rather than meanings. The numbers a node holds on its own
 * inlets were `knobs` and are **`values`**, because a knob is the shape of a
 * control and this is a number. A `track` node's smoothing was `value` and is
 * **`smooth`**, because `value` is the number held by the node of that name.
 * Both run before the kind branches that reach for the new spellings.
 */
/**
 * A number that was sleeping under a cord, told that it is now the floor.
 *
 * Before a cord carried a range it simply replaced its inlet, and the number
 * underneath was dormant — kept only so that unwiring gave it back. It is
 * load-bearing now: a cord reads `value + depth × signal`, so the number that
 * used to be ignored would quietly become an offset and a look written last
 * month would draw differently this month.
 *
 * So a wired inlet arriving without a depth is written down as the replacement
 * it was: floor at zero, depth of one. The dormant number is what that costs,
 * and it is the right thing to spend — it was never on screen, and every other
 * reading of it changes a picture somebody already made.
 *
 * Untouched once a depth exists, because then the file is already speaking the
 * new language and its numbers mean what they say.
 */
function ranged(node: Was, wired: ReadonlySet<string>): Was {
  if (!node.values) return node;
  let values = node.values;
  let depths = node.depths;
  for (const name of Object.keys(node.values)) {
    if (!wired.has(`${node.id}/${name}`)) continue;
    if (depths?.[name] !== undefined) continue;
    values = { ...values, [name]: 0 };
    depths = { ...depths, [name]: 1 };
  }
  if (values === node.values) return node;
  return { ...node, values, ...(depths ? { depths } : {}) };
}

function reword(circuit: Circuit): Circuit {
  const renamed = new Set<string>();
  const wired = new Set(circuit.cords.map((cord) => cord.to));
  const nodes = circuit.nodes.map((raw): CircuitNode => {
    const node = ranged(resmoothed(revalued(raw as Was)), wired);
    if (node.kind === 'sample') return { ...node, kind: 'tracks', op: 'by name' };
    if (node.kind === 'signal') {
      const op = node.op === 'energy' || node.op === 'amount' ? 'level' : node.op;
      return { ...node, kind: 'playback', op };
    }
    if (node.kind === 'energy') {
      // A fall of nothing written down was 0.4, and the merged node's nothing
      // is zero — so an unstated fall has to be written down rather than
      // inherited, or every rolled look would lose its breathing.
      const next: Was = {
        ...node,
        kind: 'track',
        op: 'level',
        of: node.op ?? 'master',
        smooth: node.smooth ?? node.value ?? 0.4,
      };
      delete next.value;
      return next as CircuitNode;
    }
    // `effect` was three things wearing one name, and the compiler said so: six
    // of its modes moved the point, two changed the colour where it was, and
    // four read their input many times. Every one of them keeps its `c` inlet
    // and its `c` outlet, so **no cord moves** — which is the whole reason the
    // split could be done to a library people already have.
    if (node.kind === 'effect') {
      const kind = WAS_EFFECT[node.op ?? ''] ?? 'lens';
      const values =
        node.op === 'posterize'
          ? swapValue(node.values, 'levels', 'steps')
          : node.op === 'shift'
            ? swapValue(node.values, 'spread', 'split')
            : node.values;
      return { ...node, kind, op: node.op ?? 'mirror', ...(values ? { values } : {}) };
    }
    // The five that were kinds of their own are the same eleven functions the
    // six above are: `fold` **is** `kaleido`'s wedge fold, written twice.
    if ((WAS_GEOMETRY as readonly string[]).includes(node.kind)) {
      return { ...node, kind: 'lens', op: node.kind };
    }
    if (node.kind === 'hue' || node.kind === 'levels') {
      return { ...node, kind: 'grade', op: node.kind };
    }
    if (node.kind === 'track' && node.of === undefined) {
      renamed.add(node.id);
      return { ...node, kind: 'track', of: node.op ?? 'master', op: 'level' };
    }
    return node as CircuitNode;
  });
  return {
    nodes,
    cords: circuit.cords.map((cord) => {
      const from = splitPort(cord.from);
      return renamed.has(from.node) && from.port === 'level'
        ? { ...cord, from: `${from.node}/n` }
        : cord;
    }),
  };
}

interface Legacy {
  effects?: Record<string, LookDef>;
  layers?: unknown;
  clips?: unknown;
  archetypes?: unknown;
  defaults?: { colorway?: string; pace?: number };
}

/**
 * A song used to be assigned a colourway and nothing else, so its whole entry
 * was the colourway's name. A bare string still means what it always did rather
 * than quietly unstyling every song in a file written last week. Everything else
 * is passed through whole, minus the fields that no longer exist.
 */
function songsOf(songs: Record<string, SongSpec | string> | undefined): Record<string, SongSpec> {
  const out: Record<string, SongSpec> = { ...BUILT_IN.songs };
  for (const [name, spec] of Object.entries(songs ?? {})) {
    if (typeof spec === 'string') {
      out[name] = { colorway: spec };
      continue;
    }
    const kept: SongSpec = {};
    if (spec.colorway) kept.colorway = spec.colorway;
    if (spec.looks?.length) kept.looks = spec.looks;
    if (Object.keys(kept).length > 0) out[name] = kept;
  }
  return out;
}

export { BUILT_IN };
