/**
 * What the visuals server and its browsers say to each other.
 *
 * Separate from `protocol/` at the repo root, which is the wire between the
 * browser and the Live device. This one is a layer above it: the server is a
 * *client* of that protocol and speaks this one downstream, so nothing here is
 * Live's vocabulary. A renderer should be able to draw a show without knowing
 * that Ableton exists, and this is the shape that makes that true.
 *
 * The scheme types live here rather than in `server/` because the editor edits
 * them and the server resolves them — two consumers, one definition, the same
 * argument `protocol/README.md` makes about not keeping a second copy.
 *
 * ## There is one noun, and it is a graph
 *
 * A **flow** is a graph that produces a frame. Not a graph plus a stack plus a
 * cascade: one graph. Everything that used to be a level of something is a node
 * in it — the pictures that ship, the effects that work on them, the Live set's
 * own layer mix, the meters, the song, and other flows.
 *
 * That collapse deleted four concepts. There is no layer binding, no clip
 * exception, no archetype and no per-track stack, because each of them was a
 * different answer to "how do two pictures combine" and a graph answers it once.
 * What is left above the graph is deliberately tiny: which flow is up, and which
 * colours it draws from.
 */
import { NODE_FAMILIES, type NodeKind } from './src/nodes/generated.ts';
import type { ParameterResponse, ResponseTarget } from './response.ts';

export { NODE_FAMILIES, type NodeKind };

/** How two pictures combine. Used by `blend`, and by how the tracks node stacks. */
export type Blend = 'over' | 'add' | 'screen' | 'multiply';

export const BLENDS: readonly Blend[] = ['over', 'add', 'screen', 'multiply'];

// --- the graph -----------------------------------------------------------

/**
 * The node vocabulary a flow is wired from.
 *
 * Three signals move between them and the whole design follows from that:
 * a **point** (`p`, where in the frame you are looking), a **number** (`n`), and
 * a **colour** (`c`).
 *
 * The important thing about this list is what is *not* beside it. There is no
 * separate registry of sources and no separate registry of effects: `source`
 * and `effect` are nodes with modes, the way `math` and `wave` always were.
 * A picture that ships and a picture you wired are the same kind of thing, in
 * the same list, reachable from the same drawer.
 */
/**
 * The pictures that ship, as `source` node modes.
 *
 * These were eleven separate shaders, then eleven `BuiltinFlow` values that a
 * scheme registered under their own ids and a cascade could name. They are
 * modes now, which is the point: nothing in the model knows they exist except
 * the one node that draws them.
 */
export const SOURCES = [
  'solid',
  'bars',
  'rings',
  'noise',
  'strobe',
  'grid',
  'tunnel',
  'plasma',
  'spiral',
  'scan',
  'sparks',
  'checker',
  'rays',
] as const;

export type Source = (typeof SOURCES)[number];

/**
 * Fixed-work procedural fields that are safe in a flow but not once per track.
 *
 * Each mode declares its primitive work in the renderer, so multi-tap effects
 * cannot multiply it past the graph budget without being refused first.
 */
export const FIELD_MODES = ['cells', 'clouds', 'metaballs'] as const;

/**
 * The two bounded escape-time pictures the dedicated `fractal` node draws.
 *
 * Deliberately not `SOURCES`: every source is also offered as a per-track draw,
 * and repeating an iterative shader once per playing track is exactly the
 * accidental GPU load this node exists to prevent.
 */
export const FRACTAL_MODES = ['mandelbrot', 'julia'] as const;

/**
 * The four bounded 2D lights the dedicated `light` node hangs in a frame.
 *
 * Deliberately not `SOURCES`, for the reason `fractal` is not: every source is
 * also offered once per playing track, and a light is priced for a flow. Each
 * mode declares its fixed work in the renderer the way a `field` mode does.
 */
export const LIGHT_MODES = ['lamp', 'beam', 'shafts', 'caustics'] as const;

/**
 * Disk-backed video playback: looping, one pass held on its final frame, or a
 * playhead driven by a number.
 *
 * `scrub` is the mode that makes a clip a *function of the music* rather than a
 * thing playing next to it. Its `position` inlet is the whole clip over 0–1, so
 * a bar-length ramp is one pass through the footage at whatever tempo the room
 * is at, and a meter is a clip that only advances when somebody plays.
 */
export const VIDEO_MODES = ['loop', 'once', 'scrub'] as const;

/** Disk-backed still-image framing: fill the frame, or preserve the whole image. */
export const IMAGE_MODES = ['cover', 'contain'] as const;

/** The effects that ship, as `effect` node modes. The other half of the old split. */
/**
 * The three that `effect` split into, and why it had to.
 *
 * `effect` was one name over three different things, and the compiler said so
 * without anyone meaning it to: six of its twelve modes compiled to *read my
 * input at a moved point*, two to *change the colour where it already is*, and
 * four to *read my input several times*. Only the last can make a shader
 * expensive; only the first is geometry. One dropdown containing all three
 * taught that they were variations on each other, which is the opposite of true.
 *
 * The five standalone geometry kinds came into `lens` with the six remaps,
 * because they were already the same functions: `fold` **is** `kaleido`'s wedge
 * fold and `swirl` **is** `twist`'s rotation, written twice under two prefixes
 * in two files.
 */

/**
 * `lens` — move the point, then read what is there.
 *
 * The node carries **both** outlets, which is what stops this being a
 * regression. Take `p` and it is the geometry node it replaced; take `c` and it
 * is the effect. Without the `c` outlet, "the set, kaleidoscoped" would need a
 * second node and two more cords to say — and it is the plainest sentence the
 * vocabulary has.
 */
export const LENS_MODES: readonly string[] = [
  'zoom',
  'swirl',
  'fold',
  'wobble',
  'tile',
  'mirror',
  'kaleido',
  'twist',
  'ripple',
  'slice',
  'pixelate',
  'creep',
];

/** `grade` — the colour where it already is, without moving anything. */
export const GRADE_MODES: readonly string[] = [
  'levels',
  'saturate',
  'hue',
  'tint',
  'posterize',
  'solarize',
  'channels',
  'invert',
];

/**
 * `spread` — reads its input several times, and is the only family that can
 * make a shader too big to draw.
 *
 * Its own kind because that is a fact about **cost** rather than about what it
 * does to a picture, and cost is the one thing the vocabulary could not say out
 * loud before: `roll.ts` kept a hand-written list of these four so it would
 * never stack two, and the list is the kind now.
 */
export const SPREAD_MODES: readonly string[] = ['bloom', 'smear', 'edge', 'shift'];

/**
 * `blend` — how two pictures become one, and why this is not `BLENDS`.
 *
 * `Blend` is the **set pass's** list: four names that each compile to one
 * `blendFunc` pair, because a track is drawn into a buffer by fixed-function
 * hardware. The `blend` node's list is a GLSL expression over two colours,
 * which is a strictly larger thing — `stencil` carves one picture with the
 * brightness of another, and there is no pair of GL factors that says it.
 *
 * The two agreed on four names for as long as the node could only do what the
 * hardware could. The moment that stopped being true they had to part, and
 * sharing one exported list would have made the next stencil-shaped mode look
 * like a track blending option it can never be.
 */
export const MIX_MODES: readonly string[] = [...BLENDS, 'stencil', 'cut'];

/**
 * `displace` — move a point by what a *picture* says, rather than by a shape.
 *
 * The eleven `lens` modes are eleven fixed functions of a point: a fold, a
 * swirl, a tile. None of them can be told where to go by something else, which
 * is why footage under a lens reads as footage under an effect rather than as
 * footage that is moving on its own. A displacement takes its offset from a
 * field, so the motion is as organic as whatever you wire in — and at a low
 * amount the content stays perfectly readable while the frame breathes.
 *
 * Not a `lens` mode, by the substitution rule: `lens` spends its one colour
 * inlet on *the picture it reads through*, and a mode needing a second colour
 * inlet for a different purpose moves the signal path rather than the trim.
 */
export const DISPLACE_MODES: readonly string[] = ['map', 'curl'];

/**
 * `halftone` — throw brightness away in a pattern that keeps the picture.
 *
 * Its own kind rather than four more `grade` modes, because every mode in
 * `grade` answers *what colour is here* from the colour that is already here,
 * and these four answer it from the colour **and where in the frame it is**. A
 * dropdown holding both would teach that a hue rotation and a print screen are
 * variations on each other, which is the `effect` mistake in miniature.
 *
 * They earn their place on footage specifically: a halftone is the one
 * reduction invented to survive being reduced, so a face is still a face at
 * four tones. That is the whole brief — make it breathe, keep it decipherable.
 */
export const HALFTONE_MODES: readonly string[] = ['dots', 'lines', 'dither', 'scanlines'];

/**
 * What a `read` node takes off a picture, as one number.
 *
 * Nothing else in the vocabulary turns a colour into a number. Every `n` outlet
 * comes from the clock, the set, or arithmetic between them, so a picture could
 * drive nothing and footage — the only picture here with content worth
 * reacting to — was inert. `luma` is the one anybody reaches for; the channels
 * are there because a colour-keyed mask is a channel and a threshold.
 */
export const READ_NAMES: readonly string[] = ['luma', 'red', 'green', 'blue', 'alpha'];

/**
 * Three nodes read the set, and between them they are the whole of it.
 *
 * They used to be four — `signal`, `song`, `track`, `energy` — and the seam was
 * in the wrong place. `energy` was `track` with an envelope on it: same
 * signature, same bank shape, named the same way, differing by one number that
 * happened to be computed on a CPU. Two rows in a browser for one question.
 *
 * What decides a node here is **what you have to ask the set** rather than what
 * the renderer has to fetch. There are three of those and there is no fourth:
 *
 * - `playback` — where the music is *now*: the beat, the bar, the meter.
 * - `track` — one named track, and which of its numbers you want.
 * - `song` — what the set's own names say about the song that is playing.
 *
 * The test that draws the line is whether swapping one for the other is a change
 * of mind or a change of wiring. `beat` for `phase` is a change of mind. `beat`
 * for `key` is not — one is where you are and the other is what you are in.
 */

/** Where the music is now, as a `playback` node reads it. 0–1 except `beat`. */
export type PlaybackName = 'level' | 'beat' | 'phase' | 'pulse' | 'time' | 'random';

export const PLAYBACK_NAMES: readonly PlaybackName[] = [
  'level',
  'beat',
  'phase',
  'pulse',
  'time',
  'random',
];

/**
 * Which of a track's numbers a `track` node reads.
 *
 * The meter is the one anybody reaches for first and the other two are why this
 * is a *property* rather than a node called "meter": a **fader** is a hand on a
 * control, which is the most deliberate thing a player does that a rig can
 * hear, and **playing** is a gate — is this track on at all — which is the one
 * fact about a track a picture most often wants to be gated by.
 *
 * All three go through the same smoothing, which is what folded `energy` in
 * here: an envelope follower on a meter is an energy, and one on a gate is a
 * fade-in. It is a control on the node's face rather than an inlet because the
 * envelope runs on the CPU and a cord cannot reach it.
 */
export const TRACK_READS: readonly string[] = ['level', 'fader', 'playing'];

/**
 * What a `song` node can tell you about the song that is playing.
 *
 * `key` is the musical one — the tonic as a pitch class over twelve — and not
 * `seed`, which is a hash of the name. Two songs in the same key get the same
 * number on purpose: it is the one song fact that is *about the music* rather
 * than about the entry, so a flow wired key → hue turns a set into a picture
 * that modulates with it.
 */
export const SONG_FACTS: readonly string[] = ['seed', 'tempo', 'key', 'section', 'sections'];

export const MATH_OPS = ['add', 'subtract', 'multiply', 'min', 'max', 'average'] as const;
export const WAVE_SHAPES = ['sine', 'saw', 'ramp', 'square', 'pulse', 'noise'] as const;

/** Clock-owning low-frequency oscillator shapes, including one value held per cycle. */
export const LFO_SHAPES = ['sine', 'triangle', 'saw', 'square', 'sample-hold'] as const;

/** How a `tracks` node decides what each Live track draws. */
export const TRACK_DRAWS = ['by name', ...SOURCES] as const;

export interface CircuitNode {
  /** Unique within its flow. Cords name ports as `nodeId/portName`. */
  id: string;
  kind: NodeKind;
  /** Canvas position, in graph units. The editor's, never the compiler's. */
  x: number;
  y: number;
  /**
   * Which outlet the node's picture and promoted bench show.
   *
   * Only meaningful on a node with more than one. Absent, or an outlet name a
   * hand-edited file got wrong, falls back to the wiring-aware choice in
   * `ui/probe.ts`, so adding this field changes no existing flow.
   */
  previewOutlet?: string;
  /**
   * The mode of a node that has one: a source name, an effect name, a maths op,
   * a wave shape, a signal name, a track name, a flow id.
   *
   * One field for all of them because the compiler treats them identically —
   * it is the string that picks which of a node kind's behaviours you meant.
   */
  op?: string;
  /**
   * Which **thing in the set** this node points at: a track's name.
   *
   * Apart from `op` because they answer different questions and a node can need
   * both. `op` picks one of a node kind's fixed behaviours — a list this
   * codebase writes down — where this names an instance of something that only
   * exists because somebody's Live set contains it. A `track` node has to say
   * *which track* and *which of its numbers*, and squeezing those into one
   * string would make a browser unable to offer either.
   *
   * A name rather than an index, and it breaks if the track is renamed. An
   * index breaks when a track is *moved*, which happens far more often and
   * silently repoints the node at somebody else's part.
   */
  of?: string;
  /** A server-approved path below the visuals media root, for a media node. */
  asset?: string;
  /**
   * What each unwired number inlet holds, by inlet name, 0–1.
   *
   * An inlet with nothing wired to it used to get a fallback written into the
   * shader; now it gets a number you can turn on the node's own face, and the
   * fallback is only what that number *starts* as. That is what makes a
   * `posterize` something you drop and dial rather than something you have to
   * wire a number into.
   *
   * These ride `uParams` exactly as a `value` node does — never interpolated
   * into the GLSL — so turning one never recompiles a shader. Setting one for
   * the first time does, once, because it changes how big the bank is.
   *
   * A number stays here while the inlet is wired, dormant rather than lost:
   * wiring and then unwiring gives it back, so a cord is not a destructive
   * gesture. Only *number* inlets are in here — a point and a colour have no
   * single control shape and no useful constant.
   *
   * Spelled `knobs` in a file written before the word went; `reword` in
   * `server/scheme.ts` carries those across.
   */
  values?: Record<string, number>;
  /**
   * How far a cord is allowed to move each inlet, signed. Keyed as `values` is.
   *
   * A cord used to *replace* the number under it, so a meter wired into an
   * inlet swung it across the whole range and there was no way to say "pulse
   * between a fifth and a half". With a depth the number stays where it was
   * set and the signal moves it from there: `value + depth × signal`, clamped
   * when it read.
   *
   * **Signed, because the sign is the polarity.** A positive depth carries the
   * inlet up from its value, a negative one carries it down, and the same cord
   * drives a lens one way or the other without a `math` node to invert it.
   *
   * Absent means one, which with a value of zero is exactly the replacement it
   * replaced — that is what lets a flow written before any of this existed draw
   * the same picture.
   */
  depths?: Record<string, number>;
  /** A `value` node's number, 0–1. Spelled `value` because that is what the node is. */
  value?: number;
  /**
   * A `track` node's smoothing, 0–1.
   *
   * Not an inlet value and not a shader number: the envelope runs on the CPU,
   * because it has to remember what it saw last frame and a fragment shader
   * cannot. Spelled `value` in an older file; `reword` in `server/scheme.ts`
   * carries it across at the one door every scheme comes through.
   */
  smooth?: number;
  /** A `value` node's name, which is what it is called in the editor. */
  label?: string;
}

export interface CircuitCord {
  /** `nodeId/portName` of an outlet. */
  from: string;
  /** `nodeId/portName` of an inlet. */
  to: string;
}

export interface Circuit {
  nodes: CircuitNode[];
  cords: CircuitCord[];
}

/**
 * One flow: a name and a graph.
 *
 * That is the whole type now. There is no `builtin` variant, because a built-in
 * is a node mode rather than a kind of flow — which is what makes the library
 * a list of things you made rather than a list of things you made mixed in with
 * twenty-three you did not.
 */
export interface FlowDef {
  /** What it is called in the editor. Ids are stable; names are not. */
  name: string;
  circuit: Circuit;
  /** The randomiser wired this one, so the next roll may clear it. */
  rolled?: boolean;
}

/** Every flow a graph reaches from this one, in the order its nodes appear. */
export function flowsUsedBy(circuit: Circuit): string[] {
  return circuit.nodes.filter((node) => node.kind === 'flow' && node.op).map((node) => node.op!);
}

/**
 * Whether `id` can be dropped into `into` without the graph eating itself.
 *
 * A flow inside a flow is the whole reason this vocabulary can express anything
 * complicated, and it is also the one way to write a program that never
 * terminates. Refusing by name at the moment of wiring is much better than
 * refusing at compile time, because at compile time the honest message is "one
 * of these seven flows contains itself" and nobody can act on that.
 */
export function wouldLoop(
  flows: Record<string, FlowDef>,
  into: string,
  id: string,
): boolean {
  if (into === id) return true;
  const seen = new Set<string>();
  const walk = (at: string): boolean => {
    if (at === into) return true;
    if (seen.has(at)) return false;
    seen.add(at);
    const def = flows[at];
    return def ? flowsUsedBy(def.circuit).some(walk) : false;
  };
  return walk(id);
}

// --- the scheme, which is what the editor edits -------------------------

/**
 * What a song may override, and it is deliberately almost nothing.
 *
 * A song used to own a colourway, a bias, and a set of flows resolved through
 * four levels of cascade. The cascade is gone: what is on screen is decided by
 * the rotation, and a song entry is how you say "not for this one". Two fields,
 * both optional, both meaning *pin this instead of letting it turn*.
 */
export interface SongSpec {
  /** Draw this song from one colourway rather than whatever is up. */
  colorway?: string;
  /** Draw this song from these flows rather than the rotation's pool. */
  flows?: string[];
}

/**
 * What is on screen when nobody has said anything, which is the normal case.
 *
 * **The rotation is the default and binding is the exception**, which is the
 * reverse of how this worked and the reason most of the model could go. A rig
 * that draws nothing until it is configured is a rig nobody configures; a rig
 * that keeps turning through everything you have made is one you can point at a
 * set you have never seen.
 */
export interface Rotation {
  /** The flows it turns through. Empty means every flow there is. */
  flows: string[];
  /** The colourways it turns through. Empty means every colourway there is. */
  colorways: string[];
  /**
   * Bars between changes. Zero holds whatever is up.
   *
   * Bars rather than seconds because everything else here is musical, and a
   * picture that changes at 11.4 seconds changes in the middle of a phrase.
   */
  bars: number;
  /**
   * Also change when a clip is fired **out of band** — one clip launched on its
   * own rather than a whole scene.
   *
   * That gesture is already the "and now something else" of a live set, and it
   * is the only one a player makes that the rig can hear without being told.
   * A scene change is deliberately *not* a trigger: scenes fire constantly and
   * the picture would never settle.
   */
  onClip: boolean;
  /**
   * Turn the colourway on its own schedule rather than with the flow.
   *
   * Two wheels rather than one pair, because a flow and a palette are different
   * lengths of idea — the same flow in three colourways still reads as three
   * things, and changing both every time makes every change total.
   */
  colorEvery: number;
}

export interface Scheme {
  /** Every flow, by id. All of them are graphs; none of them ship. */
  flows: Record<string, FlowDef>;
  /** Named colour sets, as `#rrggbb`. */
  colorways: Record<string, string[]>;
  rotation: Rotation;
  /** By the set's own song name. Overrides only — most sets have none. */
  songs: Record<string, SongSpec>;
  /** What the randomiser was rolled from, when it was. */
  seed?: string;
  defaults: {
    colorway: string;
    /** Drawn when the rotation has nothing to turn through. */
    flow: string;
    /**
     * A shift, in rungs, along the ladder of divisions a flow may react on.
     *
     * Whole rungs rather than a multiplier, because every rung is a musical
     * division and a rate *between* two of them is in time with nothing.
     *
     * Not called speed: a DAW already means playback rate by that.
     */
    pace: number;
    /** How each Live track draws inside a `tracks` node that does not say. */
    draws: string;
  };
}

// --- what is on screen --------------------------------------------------

/**
 * One Live track, as the renderer needs it.
 *
 * Much smaller than the `Layer` it replaces, and the difference is the whole
 * point: a layer carried a resolved stack, a blend, a floor, a bias and an
 * energy, all decided by a cascade. A track carries facts about a track. What
 * is *drawn* is the graph's business now.
 */
export interface Track {
  /** Live's track index, and the track's identity. */
  t: number;
  name: string;
  /** From the colourway, by position in the set. */
  color: number;
  /** 0–1, from the track's fader. */
  opacity: number;
  /** 0–1 output meter. */
  level: number;
  /** The scene index playing in this track, or -1. */
  playing: number;
  clipName: string;
}

export interface Show {
  connected: boolean;
  lomReady: boolean;
  /** Live's transport, which is the authority Link cannot be on joining. */
  playing: boolean;
  peers: number;
  /** True when the native Link addon loaded. False means a wall-clock stand-in. */
  clock: boolean;
  tempo: number;
  quantum: number;
  /** Link's session beat at `at`, for the browser to extrapolate from. */
  beat: number;
  /** `Date.now()` when `beat` was sampled. */
  at: number;
  /**
   * Seconds since the server started, sampled with `beat`.
   *
   * What `uTime` is extrapolated from, so the deliberately unmusical half of the
   * renderer — haze, dust, sway — is in phase across every render box. Counting
   * it locally made it a fact about when a window opened. See `server/link.ts`.
   */
  since: number;
  master: number;
  tracks: Track[];
  /**
   * The set's group tracks, which are **read but never drawn**.
   *
   * They are not in `tracks` and must not be: a `tracks` node draws every entry
   * there, and a group carries no clips of its own, so drawing one would paint
   * everything inside it a second time.
   *
   * Reading one is the opposite — it is usually the *better* question. A set
   * with five kick tracks under a `DRUMS` group has one number worth driving a
   * flow from, and it is the group's. A `track` node resolves a name against
   * this list as well as `tracks`, so pointing one at a group needs nothing
   * from the person beyond picking it.
   */
  groups: Track[];
  /**
   * The flow that is up, and why it is.
   *
   * `pinned` when a song named it, so an editor can say whether it is watching
   * the rotation turn or looking at an override.
   */
  flow: string | null;
  pinned: boolean;
  colorway: string | null;
  /** The colourway's colours, packed, so nothing downstream parses hex. */
  colors: number[];
  /** The song the set's names describe, when they describe one. */
  song: string | null;
  /**
   * The musical key, as a pitch class over twelve. Null when nothing states one.
   *
   * A number rather than the `F#m` the set spells, because everything a node
   * reads is 0–1 and the mapping is a fact about music rather than about a
   * renderer — the browser should no more parse a key label than it parses a
   * scene name. Resolved in `server/show.ts`, beside the rest of the reading.
   */
  key: number | null;
  /** The role the playing scene names. */
  role: string | null;
  /**
   * The Link beat the phrase is counted from. See `resolve.ts`.
   *
   * On the wire because the panel says where in the phrase the set is, and a
   * browser that worked it out for itself would be a second answer to a
   * question the server has already answered.
   */
  one: number;
  schemeError: string | null;
  /** Every role and song the set contains, so the editor can offer them. */
  roles: string[];
  songs: string[];
}

// --- the set's own shape, for the set view -------------------------------

/**
 * The set's shape, sent apart from the show and rarely.
 *
 * Far smaller than it was: the coverage matrix wanted every distinct clip name
 * on every track of every row, which for a real set is tens of kilobytes. There
 * is nothing left that asks a question at that resolution — a song owns a
 * colourway and a list of flows, and neither is a fact about a track.
 */
export interface SetGrid {
  tracks: { t: number; name: string; group: string | null }[];
  /** The set's running order, with what the bridge already rendered about each. */
  songs: { name: string; key: string; bpm?: string; tonality?: string; roles: string[] }[];
}

// --- the lab, which is what the review view is one UI over ---------------

/**
 * The invented room a candidate is judged under.
 *
 * **Colours by value, never by colourway name.** A judgment has to keep
 * describing the thing it judged, and a name resolved against the open scheme
 * stops doing that the day the colourway is edited — the same argument that
 * freezes a candidate's dependency bundle. Everything here is the number the
 * flow actually read.
 */
export interface LabRoom {
  tempo: number;
  quantum: number;
  /** 0–1. What the stand-in set pulses at, and what an unwired energy reads. */
  energy: number;
  /** The section reported, and the sorted list it is reported against. */
  section: string;
  sections: string[];
  /** Pitch class over twelve, or null for a room that states none. */
  key: number | null;
  /** The palette judged, as `#rrggbb`. */
  colors: string[];
  /** What the room was dealt from, so it can be dealt again. */
  seed: string;
}

/** One frozen candidate, as a lab view receives it. */
export interface LabCandidate {
  /** A hash of visual behaviour — see `canonicalCandidate` in `lab.ts`. */
  id: string;
  flow: FlowDef;
  /** Every flow the graph reaches, frozen with it, by the id its cords use. */
  bundle: Record<string, FlowDef>;
  method: string;
  methodVersion: number;
  /** The seed this candidate was dealt from, within its experiment. */
  seed: string;
  /** The candidate changed to make this one, or null for a fresh seed. */
  parentId: string | null;
  /** The one generation operation that produced this candidate. */
  operation: string;
  /** Zero for a fresh seed; one more than its parent after each mutation. */
  generation: number;
  /** Candidates compared under one frozen room share this id. */
  cohort: string;
}

export type LabScore = 1 | 2 | 3 | 4 | 5;

/** The deliberately small signal used by the fast train loop. */
export type LabVerdict = 'up' | 'down';

/** One binary preference, kept separately from the anchored review rubric. */
export interface LabSelection {
  candidateId: string;
  /** The server owns the cohort room; a binary client cannot vary it. */
  verdict: LabVerdict;
}

/** The two kinds of question the recursive search asks. */
export type LabEncounterPhase = 'explore' | 'refine';

/**
 * A comparison needs absolute anchors at both ends. Without both/neither, a
 * pair always manufactures a winner even when it contains two keepers or two
 * failures.
 */
export type LabComparisonChoice = 'left' | 'right' | 'both' | 'neither';

/** One synchronized pair, frozen by the server before it reaches Train. */
export interface LabEncounter {
  id: number;
  phase: LabEncounterPhase;
  /** The candidate this neighborhood was opened around, null for immigrants. */
  anchorId: string | null;
  left: LabCandidate;
  right: LabCandidate;
  room: LabRoom;
  /** Search depth, not the number of atomic edits inside an exploratory leap. */
  depth: number;
}

/** The complete gesture for one pair. Its room and candidates are server-owned. */
export interface LabComparisonSubmission {
  encounterId: number;
  choice: LabComparisonChoice;
}

/** An absolute finished-work judgment, separate from search direction. */
export type LabArchiveVerdict = 'keep' | 'pass' | 'clear';

export interface LabArchiveSubmission {
  candidateId: string;
  verdict: LabArchiveVerdict;
  source: 'search' | 'archive';
}

/** Lightweight enough to send the complete search history without its graphs. */
export interface LabLineageNode {
  id: string;
  name: string;
  parentId: string | null;
  generation: number;
  cohort: string;
  operation: string;
  appearances: number;
  chosen: number;
  finals: number;
  reviewed: boolean;
  /** Marked to come back to. Several per family is normal, not a conflict. */
  bookmarked: boolean;
  /**
   * How many batches this node has ever been developed with.
   *
   * The instrument against the thing that made this rewrite necessary. A shelf
   * of admitted ideas is only half of it; what tells you an idea got lost is
   * that it was never mutated, and that is a number nothing else reports.
   */
  batches: number;
  /** Descendants one step down, so a leaf reads as a leaf without a scan. */
  children: number;
}

export interface LabLineageFinalistSubmission {
  candidateId: string;
  finalist: boolean;
}

/** One historical work replayed in the exact room where it first appeared. */
export interface LabArchiveState {
  /** The complete lightweight lineage forest. Full graphs are loaded on selection. */
  nodes: LabLineageNode[];
  candidate: LabCandidate | null;
  room: LabRoom | null;
  reviewed: number;
  total: number;
  kept: number;
  keptCandidateIds: string[];
  complete: boolean;
  notice: string | null;
}

/** One Finals match: preference and independent show-readiness for both sides. */
export interface LabFinalsSubmission {
  encounterId: number;
  choice: LabComparisonChoice;
  leftShowReady: boolean;
  rightShowReady: boolean;
}

/** One cross-family match under a named room from the frozen Finals deck. */
export interface LabFinalsEncounter {
  id: number;
  left: LabCandidate;
  right: LabCandidate;
  room: LabRoom;
  roomIndex: number;
  roomName: string;
}

/** A nominee's current or final standing. Score is 0–1 and deliberately derived. */
export interface LabFinalist {
  rank: number;
  candidate: LabCandidate;
  matches: number;
  showReady: number;
  preference: number;
  score: number;
  uncertainty: number;
}

/** The durable playoff over a frozen, diverse snapshot of one search experiment. */
export interface LabFinalsState {
  runId: number;
  status: 'judging' | 'complete';
  nominees: number;
  compared: number;
  total: number;
  encounter: LabFinalsEncounter | null;
  /** Ten while possible, ordered by current derived standing. */
  leaders: LabFinalist[];
  notice: string | null;
}

/** A seed is admitted or declined on its own merits; there is nothing to compare. */
export type LabSeedVerdict = 'yes' | 'no';

/** One fresh root, staged alone under a frozen room. */
export interface LabSeedEncounter {
  id: number;
  candidate: LabCandidate;
  room: LabRoom;
}

export interface LabSeedSubmission {
  encounterId: number;
  verdict: LabSeedVerdict;
}

/**
 * Explore: acquiring stock, not searching.
 *
 * The counts are the point as much as the queue is. `seen` against `admitted`
 * is the first honest measurement of the generator this lab has ever been able
 * to take — under a pairing, ten of every twelve roots were discarded before
 * anybody looked, so "what fraction of random roots are worth anything" had no
 * answer. If that ratio is dismal, no amount of mutation downstream will help,
 * and the work belongs in the dealer rather than in the tournament.
 */
export interface LabExploreState {
  encounter: LabSeedEncounter | null;
  seen: number;
  admitted: number;
  declined: number;
  skipped: number;
  notice: string | null;
}

/** One entrant's current standing inside a batch. */
export interface LabBatchEntrant {
  rank: number;
  candidate: LabCandidate;
  /** The parent, riding in its own batch so the family can fail to improve. */
  isParent: boolean;
  matches: number;
  preference: number;
  score: number;
  uncertainty: number;
}

/** One match inside a batch: which of these two, under the batch's one room. */
export interface LabBatchEncounter {
  id: number;
  left: LabCandidate;
  right: LabCandidate;
  room: LabRoom;
  round: number;
  rounds: number;
}

export interface LabBatchSubmission {
  encounterId: number;
  choice: LabComparisonChoice;
}

/**
 * Develop: one parent's children, in a tournament somebody asked for.
 *
 * `improved` is the result the old Refine phase could never state. A batch
 * whose leader is the parent says this node is already at its local peak —
 * a real answer, and one worth having before spending another batch on it.
 */
export interface LabDevelopState {
  batchId: number;
  parent: LabCandidate;
  status: 'judging' | 'complete';
  size: number;
  compared: number;
  total: number;
  encounter: LabBatchEncounter | null;
  standings: LabBatchEntrant[];
  improved: boolean;
  notice: string | null;
}

/** Mark or unmark one work. A bookmark is navigation, never a verdict. */
export interface LabBookmarkSubmission {
  candidateId: string;
  marked: boolean;
}

/** Ask for a batch of children on one node, or throw the current one away. */
export interface LabDevelopRequest {
  candidateId: string;
  size: number;
}

/** One judgment, exactly as submitted. The raw fact every score derives from. */
export interface LabSubmission {
  candidateId: string;
  /** The room actually judged — the dealt one, or the dealt one adjusted. */
  room: LabRoom;
  score: LabScore;
  /** Tag ids. A tag is the whole gesture — nothing rides on it. */
  tags: string[];
  note?: string;
}

/**
 * One past judgment, as the review tab lists it.
 *
 * The judgment itself — candidate, room, score, when — is immutable; `tags`
 * and `note` are the living description around it, revisable from the review
 * tab. The row carries the room whole so a judgment can be re-staged without
 * a second ask; the candidate's graph is fetched separately, because a log of
 * hundreds of rows each carrying a full flow bundle would be most of a scheme
 * per row.
 */
export interface LabReviewRow {
  id: number;
  candidateId: string;
  /** The frozen flow's display name, so a list reads as work, not hashes. */
  flowName: string;
  score: LabScore;
  tags: string[];
  note: string | null;
  room: LabRoom;
  createdAt: string;
}

/**
 * What every console shows about the review queue.
 *
 * Server-owned for the reason the wheel is: two screens on one rig are two
 * views of one queue, not two queues that happen to start together.
 */
export interface LabState {
  /**
   * The legacy paired search question.
   *
   * Retained so `lineage@2`'s answered pairs keep their meaning and keep
   * feeding the forest's counts. Nothing deals a new one: Explore and Develop
   * replaced the scheduler that used to choose between them.
   */
  encounter: LabEncounter | null;
  /** One fresh root at a time, admitted or declined on its own merits. */
  explore: LabExploreState | null;
  /** The open batch, or null when no node is being developed. */
  develop: LabDevelopState | null;
  /** The lineage forest, and whichever work is selected in it. */
  archive: LabArchiveState | null;
  /** A frozen playoff, absent until Finals is opened for this experiment. */
  finals: LabFinalsState | null;
  /** Legacy single-candidate state, retained for historical methods. */
  candidate: LabCandidate | null;
  /** The room dealt with the candidate; Train treats it as immutable. */
  room: LabRoom | null;
  method: string;
  /** Binary train decisions in this experiment. */
  liked: number;
  rejected: number;
  reviewed: number;
  skipped: number;
  /** Dealt and waiting, this candidate included. */
  pending: number;
  /** Pairwise search progress for the active method. */
  comparisons: number;
  explores: number;
  refines: number;
  frontier: number;
  maxGeneration: number;
  /** One sentence when a submit was refused, or null. */
  notice: string | null;
}

// --- development calibration --------------------------------------------

/** One curve offered in a parameter-response comparison. */
export interface CalibrationOption {
  /** Stable within the trial; the UI deliberately presents only A/B/C. */
  id: string;
  response: ParameterResponse;
}

/** One reproducible parameter question and the picture used to answer it. */
export interface CalibrationTrial {
  id: string;
  version: number;
  batch: string;
  name: string;
  question: string;
  target: ResponseTarget & { nodeId: string };
  flow: FlowDef;
  room: LabRoom;
  /** Where the target control starts when this trial is opened. */
  initialValue: number;
  options: CalibrationOption[];
}

export interface CalibrationSubmission {
  trialId: string;
  trialVersion: number;
  /** The exact development room on screen when the decision was made. */
  room: LabRoom;
  /** Null is an explicit rejection of every option, never a skip. */
  selectedOptionId: string | null;
  /** The selected option after the shared maximum-reach adjustment. */
  response: ParameterResponse | null;
  extent: number;
  note?: string;
}

/** One row in the device/parameter browser, without its heavier frozen flow. */
export interface CalibrationTrialSummary {
  id: string;
  version: number;
  batch: string;
  name: string;
  target: ResponseTarget;
  ordinal: number;
  decided: boolean;
}

/** A compact completed decision for progress and review in the development UI. */
export interface CalibrationDecisionRow {
  id: number;
  trialId: string;
  trialVersion: number;
  name: string;
  target: ResponseTarget;
  room: LabRoom;
  selectedOptionId: string | null;
  response: ParameterResponse | null;
  extent: number;
  note: string | null;
  createdAt: string;
}

export interface CalibrationState {
  trial: CalibrationTrial | null;
  /** The latest decision for the selected trial, if it has been calibrated before. */
  decision: CalibrationDecisionRow | null;
  /** Every active question, kept compact for device and parameter selection. */
  trials: CalibrationTrialSummary[];
  decided: number;
  total: number;
  history: CalibrationDecisionRow[];
  notice: string | null;
}

// --- the wire -----------------------------------------------------------

/**
 * The scheme library, as the console shows it: every saved scheme, which one
 * is open, and whether the open one holds edits its file does not have.
 */
export const EXAMPLES_SCHEME_ID = '@examples';

/** The system scheme has an address no user file may claim, and one human name. */
export function schemeLabel(id: string): string {
  return id === EXAMPLES_SCHEME_ID ? 'Examples' : id;
}

export interface Library {
  /** Every saved scheme by id, plus the read-only system examples. */
  schemes: string[];
  /** The one that is open. */
  current: string;
  /** The open scheme is a system source: editable in memory, but only Save As may write it. */
  readOnly: boolean;
  /** True when the open scheme has been edited since it was last saved. */
  dirty: boolean;
  /** One sentence the console should show — a refusal, a file moved under us — or null. */
  notice: string | null;
}

/** One server-approved file below the configured media root. */
export interface MediaAsset {
  /** Which node may select this file. */
  type: 'image' | 'video';
  /** POSIX relative path below that root, used by a media node and the media endpoint. */
  id: string;
  /** Basename for compact selectors; `id` disambiguates matching names in folders. */
  name: string;
  bytes: number;
}

/**
 * Server to browser, discriminated by kind, and the show/anchor split is what
 * keeps the renderer smooth — see `docs/clock.md`.
 */
export type Down =
  | ({ kind: 'show' } & Show)
  | {
      kind: 'anchor';
      tempo: number;
      beat: number;
      at: number;
      since: number;
      playing: boolean;
      master: number;
      /** By track, in the order the last `show` gave them. */
      levels: number[];
      opacity: number[];
    }
  | { kind: 'scheme'; scheme: Scheme }
  | ({ kind: 'library' } & Library)
  | { kind: 'media'; assets: MediaAsset[] }
  | { kind: 'grid'; grid: SetGrid }
  | ({ kind: 'lab' } & LabState)
  // The review tab's page of past judgments, newest first; `more` says the
  // log continues past the oldest row sent.
  | { kind: 'lab-log'; reviews: LabReviewRow[]; more: boolean }
  // One row after a retag or renote, to every console — an edited description
  // is show state the way the queue is.
  | { kind: 'lab-review-changed'; review: LabReviewRow }
  // A frozen candidate's graph, for re-staging a judgment on the bench.
  | { kind: 'lab-candidate'; id: string; flow: FlowDef; bundle: Record<string, FlowDef> }
  | { kind: 'calibration-available'; available: boolean }
  | ({ kind: 'calibration' } & CalibrationState);

/**
 * Browser to server. An edit is the whole scheme, replaced.
 *
 * Whole rather than a patch because the scheme is a few kilobytes and an editor
 * that sent deltas would need every one of them to be reversible to be
 * undoable. The server holds it in memory and every screen follows; **nothing
 * reaches disk until `save-scheme` says so**. `save-scheme-as` writes the open
 * scheme under a new id and stays there; `load-scheme` opens a saved one,
 * dropping unsaved edits — the console asks first, the server does not.
 *
 * `downbeat` carries nothing: *when* it arrives is the
 * whole message. It goes to the server rather than being handled in the browser
 * because the wheel belongs to the show and not to whoever is watching it —
 * two screens on one rig have to be counting the same phrase.
 *
 * `next-flow` is the same kind of gesture: it turns only the flow wheel, leaving
 * the colourway where it is, and lands on the server so every screen moves
 * together.
 */
export type Up =
  | { kind: 'scheme'; scheme: Scheme }
  | { kind: 'save-scheme' }
  | { kind: 'save-scheme-as'; id: string }
  | { kind: 'load-scheme'; id: string }
  | { kind: 'downbeat' }
  | { kind: 'next-flow' }
  | { kind: 'next-colorway' }
  // The lab speaks coarse gestures and nothing finer. Opening train asks for
  // the queue's state — and is the only thing that makes the server deal;
  // nothing is generated merely because a server is running. A comparison,
  // a historical binary choice, a detailed review and a skip remain different
  // facts and therefore different messages.
  | { kind: 'lab-open' }
  | { kind: 'lab-compare'; comparison: LabComparisonSubmission }
  | { kind: 'lab-skip-encounter'; encounterId: number }
  | { kind: 'lab-archive-open' }
  | { kind: 'lab-archive-select'; candidateId: string }
  | { kind: 'lab-archive-decide'; decision: LabArchiveSubmission }
  | { kind: 'lab-lineage-finalist'; decision: LabLineageFinalistSubmission }
  | { kind: 'lab-explore-open' }
  | { kind: 'lab-explore-judge'; submission: LabSeedSubmission }
  | { kind: 'lab-explore-skip'; encounterId: number }
  | { kind: 'lab-bookmark'; decision: LabBookmarkSubmission }
  | { kind: 'lab-develop-open'; candidateId: string }
  | { kind: 'lab-develop-deal'; request: LabDevelopRequest }
  | { kind: 'lab-develop-compare'; comparison: LabBatchSubmission }
  | { kind: 'lab-develop-skip'; encounterId: number }
  | { kind: 'lab-develop-close' }
  | { kind: 'lab-finals-open' }
  | { kind: 'lab-finals-new' }
  | { kind: 'lab-finals-compare'; comparison: LabFinalsSubmission }
  | { kind: 'lab-finals-skip'; encounterId: number }
  | { kind: 'lab-select'; selection: LabSelection }
  | { kind: 'lab-review'; review: LabSubmission }
  | { kind: 'lab-skip'; candidateId: string }
  // A flow from the open scheme, offered to the queue by hand — so what was
  // built in the build tab can be judged and kept as evidence the way a dealt
  // candidate is. The server freezes it: the graph and its bundle by value.
  | { kind: 'lab-offer'; flowId: string }
  // The review tab: browse past judgments and revise the assessment — score,
  // tags, note. What a judgment is *of* — candidate, room, when — has no
  // message that can touch it.
  | { kind: 'lab-log'; before?: number }
  | { kind: 'lab-rescore'; reviewId: number; score: LabScore }
  | { kind: 'lab-retag'; reviewId: number; tags: string[] }
  | { kind: 'lab-renote'; reviewId: number; note: string }
  | { kind: 'lab-candidate'; candidateId: string }
  | { kind: 'calibration-open'; trialId?: string; trialVersion?: number }
  | { kind: 'calibration-decide'; decision: CalibrationSubmission };

export const VISUALS_PORT = 17900;
export const VISUALS_WS_PATH = '/ws';
