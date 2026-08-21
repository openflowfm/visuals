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
 * A **look** is a graph that produces a frame. Not a graph plus a stack plus a
 * cascade: one graph. Everything that used to be a level of something is a node
 * in it — the pictures that ship, the effects that work on them, the Live set's
 * own layer mix, the meters, the song, and other looks.
 *
 * That collapse deleted four concepts. There is no layer binding, no clip
 * exception, no archetype and no per-track stack, because each of them was a
 * different answer to "how do two pictures combine" and a graph answers it once.
 * What is left above the graph is deliberately tiny: which look is up, and which
 * colours it draws from.
 */

/** How two pictures combine. Used by `blend`, and by how the tracks node stacks. */
export type Blend = 'over' | 'add' | 'screen' | 'multiply';

export const BLENDS: readonly Blend[] = ['over', 'add', 'screen', 'multiply'];

// --- the graph -----------------------------------------------------------

/**
 * The node vocabulary a look is wired from.
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
export type NodeKind =
  // where you are, and what the room is doing
  | 'point'
  | 'value'
  // the three the set answers
  | 'playback'
  | 'track'
  | 'song'
  // pictures
  | 'source'
  | 'tracks'
  | 'look'
  | 'paint'
  // geometry: point in, point out
  | 'fold'
  | 'swirl'
  | 'zoom'
  | 'wobble'
  | 'tile'
  | 'polar'
  // colour
  | 'effect'
  | 'hue'
  | 'levels'
  | 'blend'
  // arithmetic
  | 'math'
  | 'wave'
  // the end
  | 'out';

/**
 * The families a node browser groups by.
 *
 * Ordered the way the drawer should read: what draws, what moves a point, what
 * works on a colour, what the room is doing, and the arithmetic between them.
 * A family is a fact about the vocabulary rather than about the editor, which
 * is why it is here — two editors listing these differently would be two
 * different vocabularies.
 */
export const NODE_FAMILIES: readonly { name: string; about: string; kinds: NodeKind[] }[] = [
  {
    name: 'pictures',
    about: 'Everything that makes a colour out of nothing',
    kinds: ['source', 'tracks', 'look', 'paint'],
  },
  {
    name: 'colour',
    about: 'Everything that takes a picture and gives one back',
    kinds: ['effect', 'blend', 'hue', 'levels'],
  },
  {
    name: 'geometry',
    about: 'Moving the point a picture is read at',
    kinds: ['point', 'fold', 'swirl', 'zoom', 'wobble', 'tile', 'polar'],
  },
  {
    name: 'the room',
    about: 'Three questions you can ask the set, and nothing else can answer',
    kinds: ['playback', 'track', 'song'],
  },
  {
    name: 'numbers',
    about: 'Knobs and the arithmetic between them',
    kinds: ['value', 'math', 'wave'],
  },
  { name: 'the end', about: 'What leaves the look', kinds: ['out'] },
];

/**
 * The pictures that ship, as `source` node modes.
 *
 * These were eleven separate shaders, then eleven `BuiltinLook` values that a
 * scheme registered under their own ids and a cascade could name. They are
 * modes now, which is the point: nothing in the model knows they exist except
 * the one node that draws them.
 */
export const SOURCES: readonly string[] = [
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
];

/** The effects that ship, as `effect` node modes. The other half of the old split. */
export const EFFECTS: readonly string[] = [
  'mirror',
  'kaleido',
  'shift',
  'pixelate',
  'ripple',
  'smear',
  'bloom',
  'slice',
  'edge',
  'posterize',
  'twist',
  'invert',
];

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
 * fade-in. It is a knob on the node's face rather than an inlet because the
 * envelope runs on the CPU and a cord cannot reach it.
 */
export const TRACK_READS: readonly string[] = ['level', 'fader', 'playing'];

/**
 * What a `song` node can tell you about the song that is playing.
 *
 * `key` is the musical one — the tonic as a pitch class over twelve — and not
 * `seed`, which is a hash of the name. Two songs in the same key get the same
 * number on purpose: it is the one song fact that is *about the music* rather
 * than about the entry, so a look wired key → hue turns a set into a picture
 * that modulates with it.
 */
export const SONG_FACTS: readonly string[] = ['seed', 'tempo', 'key', 'section', 'sections'];

export const MATH_OPS = ['add', 'subtract', 'multiply', 'min', 'max', 'average'] as const;
export const WAVE_SHAPES = ['sine', 'saw', 'ramp', 'square', 'pulse', 'noise'] as const;

/** How a `tracks` node decides what each Live track draws. */
export const TRACK_DRAWS: readonly string[] = ['by name', ...SOURCES];

export interface CircuitNode {
  /** Unique within its look. Cords name ports as `nodeId/portName`. */
  id: string;
  kind: NodeKind;
  /** Canvas position, in graph units. The editor's, never the compiler's. */
  x: number;
  y: number;
  /**
   * The mode of a node that has one: a source name, an effect name, a maths op,
   * a wave shape, a signal name, a track name, a look id.
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
  /**
   * What each unwired number inlet holds, by inlet name, 0–1.
   *
   * An inlet with nothing wired to it used to get a fallback written into the
   * shader; now it gets a number you can turn on the node's own face, and the
   * fallback is only what that number *starts* as. That is what makes a
   * `posterize` something you drop and dial rather than something you have to
   * build a knob for.
   *
   * These ride `uParams` exactly as a `value` node does — never interpolated
   * into the GLSL — so turning one never recompiles a shader. Setting one for
   * the first time does, once, because it changes how big the bank is.
   *
   * A value stays here while the inlet is wired, dormant rather than lost:
   * wiring and then unwiring gives the number back, so a cord is not a
   * destructive gesture. Only *number* inlets are in here — a point and a
   * colour have no single control shape and no useful constant.
   */
  knobs?: Record<string, number>;
  /**
   * A `value` node's amount, or a `track` node's smoothing. 0–1 either way.
   *
   * Not folded into `knobs`, and the reason is that neither is an inlet:
   * `knobs` is keyed by inlet name and is trimmed against the inlets a node
   * actually has, so a number parked under a name no port answers to would be
   * dropped the first time anything came through `merge`. A track's smoothing
   * is not even a shader number — the envelope runs on the CPU, because it has
   * to remember what it saw last frame and a fragment shader cannot.
   */
  value?: number;
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
 * One look: a name and a graph.
 *
 * That is the whole type now. There is no `builtin` variant, because a built-in
 * is a node mode rather than a kind of look — which is what makes the library
 * a list of things you made rather than a list of things you made mixed in with
 * twenty-three you did not.
 */
export interface LookDef {
  /** What it is called in the editor. Ids are stable; names are not. */
  name: string;
  circuit: Circuit;
  /** The randomiser wired this one, so the next roll may clear it. */
  rolled?: boolean;
}

/** Every look a graph reaches from this one, in the order its nodes appear. */
export function looksUsedBy(circuit: Circuit): string[] {
  return circuit.nodes.filter((node) => node.kind === 'look' && node.op).map((node) => node.op!);
}

/**
 * Whether `id` can be dropped into `into` without the graph eating itself.
 *
 * A look inside a look is the whole reason this vocabulary can express anything
 * complicated, and it is also the one way to write a program that never
 * terminates. Refusing by name at the moment of wiring is much better than
 * refusing at compile time, because at compile time the honest message is "one
 * of these seven looks contains itself" and nobody can act on that.
 */
export function wouldLoop(
  looks: Record<string, LookDef>,
  into: string,
  id: string,
): boolean {
  if (into === id) return true;
  const seen = new Set<string>();
  const walk = (at: string): boolean => {
    if (at === into) return true;
    if (seen.has(at)) return false;
    seen.add(at);
    const def = looks[at];
    return def ? looksUsedBy(def.circuit).some(walk) : false;
  };
  return walk(id);
}

// --- the scheme, which is what the editor edits -------------------------

/**
 * What a song may override, and it is deliberately almost nothing.
 *
 * A song used to own a colourway, a bias, and a set of looks resolved through
 * four levels of cascade. The cascade is gone: what is on screen is decided by
 * the rotation, and a song entry is how you say "not for this one". Two fields,
 * both optional, both meaning *pin this instead of letting it turn*.
 */
export interface SongSpec {
  /** Draw this song from one colourway rather than whatever is up. */
  colorway?: string;
  /** Draw this song from these looks rather than the rotation's pool. */
  looks?: string[];
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
  /** The looks it turns through. Empty means every look there is. */
  looks: string[];
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
   * Turn the colourway on its own schedule rather than with the look.
   *
   * Two wheels rather than one pair, because a look and a palette are different
   * lengths of idea — the same look in three colourways still reads as three
   * things, and changing both every time makes every change total.
   */
  colorEvery: number;
}

export interface Scheme {
  /** Every look, by id. All of them are graphs; none of them ship. */
  looks: Record<string, LookDef>;
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
    look: string;
    /**
     * A shift, in rungs, along the ladder of divisions a look may react on.
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
  master: number;
  tracks: Track[];
  /**
   * The look that is up, and why it is.
   *
   * `pinned` when a song named it, so an editor can say whether it is watching
   * the rotation turn or looking at an override.
   */
  look: string | null;
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
 * colourway and a list of looks, and neither is a fact about a track.
 */
export interface SetGrid {
  tracks: { t: number; name: string; group: string | null }[];
  /** The set's running order, with what the bridge already rendered about each. */
  songs: { name: string; key: string; bpm?: string; tonality?: string; roles: string[] }[];
}

// --- the wire -----------------------------------------------------------

/**
 * Server to browser. Three kinds, discriminated, and the split is what keeps
 * the renderer smooth — see `docs/clock.md`.
 */
export type Down =
  | ({ kind: 'show' } & Show)
  | {
      kind: 'anchor';
      tempo: number;
      beat: number;
      at: number;
      playing: boolean;
      master: number;
      /** By track, in the order the last `show` gave them. */
      levels: number[];
      opacity: number[];
    }
  | { kind: 'scheme'; scheme: Scheme }
  | { kind: 'grid'; grid: SetGrid };

/**
 * Browser to server. Two messages, and the first is the whole scheme, replaced.
 *
 * Whole rather than a patch because the scheme is a few kilobytes and an editor
 * that sent deltas would need every one of them to be reversible to be
 * undoable. The server writes it to `scheme.json`, which stays the record.
 *
 * `downbeat` is the other one, and it carries nothing: *when* it arrives is the
 * whole message. It goes to the server rather than being handled in the browser
 * because the wheel belongs to the show and not to whoever is watching it —
 * two screens on one rig have to be counting the same phrase.
 */
export type Up = { kind: 'scheme'; scheme: Scheme } | { kind: 'downbeat' };

export const VISUALS_PORT = 17900;
export const VISUALS_WS_PATH = '/ws';
