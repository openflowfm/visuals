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
 * right and the cords do not cross. A row-major grid put a knob between two
 * links in a chain and made a six-node look need untangling before it could be
 * read, which for the library that *is* the manual is the wrong first sight.
 */
/**
 * How far apart two nodes in one column are laid out.
 *
 * Tall enough for the tallest faceplate there is, which is a `track`: a picture,
 * two pickers and a knob. Nodes grew when their pictures went to 16:9 and grew
 * again when `track` took on a second dropdown, and a spacing left at the old
 * height put the second row of every built-in through the first one.
 */
const ROW = 220;

function wire(
  name: string,
  nodes: [string, string, string?, Record<string, number>?, number?, string?, string?][],
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
      nodes: nodes.map(([id, kind, op, knobs, value, label, of]): CircuitNode => {
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
          ...(knobs ? { knobs } : {}),
          ...(value !== undefined ? { value } : {}),
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
 * Four looks that are a show, and are the manual.
 *
 * Deliberately a spread rather than four variations: one that is **only** the
 * set, one that **moves the point** the set is read at, one that puts the set
 * **inside** a picture that ships, and one that ignores the set entirely and
 * builds a picture **out of a number**. Between them they use every family in
 * the vocabulary, which matters more than it usually would — nobody reads a node
 * reference, and everybody takes a working example apart.
 *
 * Two rules they all keep, both learned the hard way.
 *
 * **Nothing here is only alive when the room is loud.** `master` is zero with no
 * Live connected, which is most of the time anyone is building one of these, and
 * a look whose every motion came off a meter is a still frame at a desk and
 * indistinguishable from one that is wired wrong. So the motion comes off the
 * clock — `phase`, `beat`, a `wave` — and the meter *adds*.
 *
 * **Nothing here is wired to something that cannot move it.** The old `Weather`
 * drove a `hue` from `song seed`, and a set with no song names holds that at a
 * half, which is exactly the rotation that does nothing: a cord drawn across the
 * canvas into a node that visibly never changed. A number that idles at a half
 * belongs on an inlet where a half means something.
 *
 * And one thing they teach by shape rather than by rule: **a number that goes to
 * one inlet is set on that inlet**, not wired in from a knob node parked beside
 * it. Four of these used to be knob nodes and are now numbers on a face, which
 * is four fewer cords across the four graphs anyone opens first. The one knob
 * node left is in `Weather`, feeding two places, which is what that node is for.
 */
const BUILT_IN: Scheme = {
  looks: {
    // One node. The floor of the vocabulary, and the claim the rig is built on:
    // point it at a Live set and it draws the Live set.
    live: wire(
      'The set',
      [
        ['live', 'tracks', 'by name'],
        ['o', 'out'],
      ],
      ['live/c -> o/c'],
    ),
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
        ['e', 'track', 'level', undefined, 0.35, undefined, 'master'],
        // The wedge count is set on the effect's own face rather than wired in
        // from a knob node. One number, one place, no cord across the canvas.
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
        'live/c -> fold/c',
        'e/n -> fold/energy',
        'fold/c -> o/c',
      ],
    ),
    // Two pictures, one of them the room's. The set is wobbled by how loud the
    // room is — still when it is quiet — and screened into a corridor, then
    // graded. The blend node is what every layer stack this replaced was for.
    deep: wire(
      'Deep',
      [
        ['e', 'track', 'level', undefined, 0.4, undefined, 'master'],
        ['pt', 'point'],
        ['tun', 'source', 'tunnel'],
        ['wob', 'lens', 'wobble'],
        ['live', 'tracks', 'by name'],
        // How much of the set is in the picture, and how hard the grade is:
        // both are numbers you turn while looking at the wall, and both live on
        // the node they belong to.
        ['mix', 'blend', 'screen', { amount: 0.75 }],
        ['grade', 'grade', 'levels', { gain: 0.62 }],
        ['o', 'out'],
      ],
      [
        'e/n -> tun/energy',
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
        ['e', 'track', 'level', undefined, 0.55, undefined, 'master'],
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
        'e/n -> surf/energy',
        'surf/c -> rip/c',
        'e/n -> rip/energy',
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
        ['e', 'track', 'level', undefined, 0.3, undefined, 'master'],
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
        'zm/p -> sp/p',
        'e/n -> sp/energy',
        'sp/c -> tw/c',
        'e/n -> tw/energy',
        'tw/c -> glow/c',
        'e/n -> glow/energy',
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
        ['e', 'track', 'level', undefined, 0.35, undefined, 'master'],
        ['tun', 'source', 'tunnel'],
        ['rng', 'source', 'rings'],
        ['mix', 'blend', 'add', { amount: 0.6 }],
        ['mir', 'lens', 'mirror', { line: 0.5, angle: 0.25 }],
        ['o', 'out'],
      ],
      [
        'pt/p -> fld/p',
        'fld/p -> tun/p',
        'e/n -> tun/energy',
        'pt/p -> rng/p',
        'e/n -> rng/energy',
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
    // Two `tracks` nodes, one texture. The set is drawn once a frame and read
    // twice: once for the outline and once, dimmed, as the ghost underneath, so
    // the shapes still have somewhere to sit.
    outline: wire(
      'Outline',
      [
        ['ink', 'tracks', 'by name'],
        // A wide tap and a hard gain. The gradient of a soft picture is a very
        // small number, so an outline drawn at the effect's own middle is one
        // you can only see in a dark room — which is the whole point of the
        // look and the one thing it was failing at.
        ['cut', 'spread', 'edge', { width: 0.72, gain: 0.85 }],
        ['lift', 'grade', 'levels', { gain: 0.6, lift: 0.74 }],
        ['fill', 'tracks', 'by name'],
        ['ghost', 'grade', 'levels', { gain: 0.34, lift: 0.46 }],
        ['mix', 'blend', 'screen', { amount: 0.85 }],
        ['o', 'out'],
      ],
      [
        'ink/c -> cut/c',
        'cut/c -> lift/c',
        'fill/c -> ghost/c',
        'ghost/c -> mix/base',
        'lift/c -> mix/top',
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
        ['live', 'tracks', 'by name'],
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
        'live/c -> punch/c',
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
        ['live', 'tracks', 'by name'],
        ['e', 'track', 'level', undefined, 0.12, undefined, 'master'],
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
        'live/c -> cut/c',
        'e/n -> cut/energy',
        'cut/c -> px/c',
        'e/n -> px/energy',
        'px/c -> rgb/c',
        'e/n -> rgb/energy',
        'rgb/c -> flip/c',
        'e/n -> flip/energy',
        'flip/c -> up/c',
        'up/c -> o/c',
      ],
    ),
  },
  colorways: {
    // Kept light on purpose: a cheap projector has no black to work against, so
    // a dark colourway is a dark screen.
    ember: ['#ffb347', '#ff6b6b', '#ffe9c4', '#c44536'],
    cold: ['#7ec8e3', '#c3f0ff', '#4a7fa5', '#eaf6ff'],
    acid: ['#c9f299', '#f2f27a', '#7ad7a0', '#ffffff'],
    dusk: ['#c792ea', '#f78fb3', '#ffd6e0', '#6c5b7b'],
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
    look: 'live',
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
   * A knob turning and a node being dragged both emit on every pointer move, so
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
    // second place the truth lives. Without this, the first turn of a knob
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

/** A kind that used to exist, for a file that still spells one. */
type Was = Omit<CircuitNode, 'kind'> & {
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

/** A knob renamed out of a collision with a mode or a kind beside it. */
function swapKnob(
  knobs: Record<string, number> | undefined,
  was: string,
  now: string,
): Record<string, number> | undefined {
  if (!knobs || knobs[was] === undefined) return knobs;
  const next = { ...knobs, [now]: knobs[was] };
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
 */
function reword(circuit: Circuit): Circuit {
  const renamed = new Set<string>();
  const nodes = circuit.nodes.map((old): CircuitNode => {
    const node = old as Was;
    if (node.kind === 'sample') return { ...node, kind: 'tracks', op: 'by name' };
    if (node.kind === 'signal') {
      const op = node.op === 'energy' || node.op === 'amount' ? 'level' : node.op;
      return { ...node, kind: 'playback', op };
    }
    if (node.kind === 'energy') {
      // A fall of nothing written down was 0.4, and the merged node's nothing
      // is zero — so an unstated fall has to be written down rather than
      // inherited, or every rolled look would lose its breathing.
      return { ...node, kind: 'track', op: 'level', of: node.op ?? 'master', value: node.value ?? 0.4 };
    }
    // `effect` was three things wearing one name, and the compiler said so: six
    // of its modes moved the point, two changed the colour where it was, and
    // four read their input many times. Every one of them keeps its `c` inlet
    // and its `c` outlet, so **no cord moves** — which is the whole reason the
    // split could be done to a library people already have.
    if (node.kind === 'effect') {
      const kind = WAS_EFFECT[node.op ?? ''] ?? 'lens';
      const knobs =
        node.op === 'posterize'
          ? swapKnob(node.knobs, 'levels', 'steps')
          : node.op === 'shift'
            ? swapKnob(node.knobs, 'spread', 'split')
            : node.knobs;
      return { ...node, kind, op: node.op ?? 'mirror', ...(knobs ? { knobs } : {}) };
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
      return { ...node, kind: 'track', of: node.op ?? 'master', op: 'level', value: node.value ?? 0 };
    }
    return old;
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
