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
 */

/** How a layer combines with everything already drawn beneath it. */
export type Blend = 'over' | 'add' | 'screen' | 'multiply';

/** What draws a layer's picture. One fragment shader each. */
export type SourceKind =
  | 'solid'
  | 'bars'
  | 'rings'
  | 'noise'
  | 'strobe'
  | 'grid'
  | 'tunnel'
  | 'plasma'
  | 'spiral'
  | 'scan'
  | 'sparks';

/**
 * The six effects that ship as handwritten shaders.
 *
 * Not the whole set of effects — an effect is named by an **id** everywhere
 * else, and an id can also name one built out of nodes. These are the ones with
 * GLSL behind them rather than a circuit, and they exist so a rig draws
 * something good before anyone has wired anything.
 */
export type BuiltinEffect =
  | 'mirror'
  | 'kaleido'
  | 'shift'
  | 'pixelate'
  | 'ripple'
  | 'smear'
  | 'bloom'
  | 'slice'
  | 'edge'
  | 'posterize'
  | 'twist'
  | 'invert';

/** Every member, in the order an editor should offer them. */
export const SOURCE_KINDS: readonly SourceKind[] = [
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
export const BUILTIN_EFFECTS: readonly BuiltinEffect[] = [
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
export const BLENDS: readonly Blend[] = ['over', 'add', 'screen', 'multiply'];

// --- circuits: an effect built out of nodes ------------------------------

/**
 * The node vocabulary a circuit is wired from.
 *
 * Three signals move between them and the whole design follows from that:
 * a **point** (`p`, where in the frame you are looking), a **number** (`n`), and
 * a **colour** (`c`). Geometry nodes move points about, `sample` turns a point
 * into a colour by reading the picture that arrived, colour nodes work on
 * colours, and `out` takes the one that leaves. Everything a shader does to a
 * frame is one of those four moves.
 *
 * Points are in **centred, aspect-corrected** space — zero in the middle, a
 * circle round — because every geometric operation wants that and nothing else
 * does. `sample` is the only node that converts back, so no other node has to
 * know the frame's shape.
 */
export type NodeKind =
  // sources of signal
  | 'point'
  | 'signal'
  | 'value'
  // geometry: point in, point out
  | 'fold'
  | 'swirl'
  | 'zoom'
  | 'wobble'
  | 'tile'
  | 'polar'
  // the crossing
  | 'sample'
  | 'paint'
  // colour
  | 'hue'
  | 'levels'
  | 'blend'
  // arithmetic
  | 'math'
  | 'wave'
  // the end
  | 'out';

/** Which live signal a `signal` node reads. All of them are 0–1 except `beat`. */
export type SignalName =
  'level' | 'energy' | 'beat' | 'phase' | 'pulse' | 'time' | 'amount' | 'random';

export const SIGNAL_NAMES: readonly SignalName[] = [
  'level',
  'energy',
  'beat',
  'phase',
  'pulse',
  'time',
  'amount',
  'random',
];

export const MATH_OPS = ['add', 'subtract', 'multiply', 'min', 'max', 'average'] as const;
export const WAVE_SHAPES = ['sine', 'saw', 'ramp', 'square', 'pulse', 'noise'] as const;

export interface CircuitNode {
  /** Unique within its circuit. Cords name ports as `nodeId/portName`. */
  id: string;
  kind: NodeKind;
  /** Canvas position, in graph units. The editor's, never the compiler's. */
  x: number;
  y: number;
  /** The mode of a node that has one: a signal name, a maths op, a wave shape. */
  op?: string;
  /** A `value` node's amount, 0–1. Rides a uniform, so turning it never recompiles. */
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
 * One effect, however it is built.
 *
 * A built-in has GLSL and a handful of named parameters; a circuit has nodes
 * and its `value` nodes are its parameters. Both are addressed by the same id
 * from an archetype or a layer, so nothing that *uses* an effect has to know
 * which kind it is — which is the point, and the reason a circuit is worth
 * having rather than a seventh hard-coded shader.
 */
export interface EffectDef {
  /** What it is called in the editor. Ids are stable; names are not. */
  name: string;
  builtin?: BuiltinEffect;
  /** Values for the parameters a built-in declares, by name. */
  params?: Record<string, number>;
  circuit?: Circuit;
}

// --- the scheme, which is what the editor edits -------------------------

/**
 * What one track's layer does, wherever it is bound.
 *
 * The same shape binds to a track and to a clip, because they are the same
 * question asked at two specificities — "what does this instrument look like"
 * and "except this time".
 */
export interface LayerSpec {
  source?: SourceKind;
  /** Effect ids, **added** to whatever the section contributes rather than replacing it. */
  effects?: string[];
  blend?: Blend;
  /** Added to the section's energy, then clamped. Negative calms a layer. */
  bias?: number;
  /**
   * The energy at which this layer joins the picture, 0–1.
   *
   * How energy thins the stack. A layer below its floor fades out rather than
   * cutting, so a section change reads as the picture opening up instead of
   * something failing. Unset derives one from the layer's depth.
   */
  floor?: number;
  /** Never draw it. For the tracks that are utilities rather than instruments. */
  hide?: boolean;
}

/** What a song owns, which is its identity rather than its shape. */
export interface SongSpec {
  colorway?: string;
  /**
   * Added to every section's energy in this song.
   *
   * The thing that makes "the same chorus should differ between two songs" true
   * rather than merely intended: the archetype says what a chorus is, and this
   * says how hard this song plays one.
   */
  bias?: number;
}

export interface Archetype {
  /** 0–1. The one number a section is really described by. */
  energy: number;
  /** Effect ids. The character of the section, dialled in by energy, not switched on. */
  effects?: string[];
}

export interface Scheme {
  /** Named colour sets, as `#rrggbb`. A song is assigned one. */
  colorways: Record<string, string[]>;
  /** Song name (the set's own) to what that song owns. */
  songs: Record<string, SongSpec>;
  /** Role name to its archetype. Roles come from the set's own vocabulary. */
  archetypes: Record<string, Archetype>;
  /**
   * By **exact track name**, which is the set's vocabulary rather than a pattern
   * language.
   *
   * This used to be a list of regular expressions, and the flexibility was real
   * but nobody could read it: a rule was a string you typed, matched against
   * names you had to remember, in an order that silently decided the answer.
   * Binding to the names the set already has means the editor can list every
   * layer, show what each one resolved to, and never ask anyone to type a name
   * they could typo. A track with no entry falls back to the name hints in
   * `server/scheme.ts`, so an unconfigured set still draws.
   */
  layers: Record<string, LayerSpec>;
  /** By exact clip name: the exception, made from the clip that is playing. */
  clips: Record<string, LayerSpec>;
  /** Every effect there is, by id. Built-ins are pre-registered under their own names. */
  effects: Record<string, EffectDef>;
  /**
   * What the randomiser was rolled from, when it was.
   *
   * Kept so a show you liked can be got back — one level of undo covers the roll
   * you just did, and a seed covers the one from last week. Absent on a scheme
   * nobody rolled, which is most of them.
   */
  seed?: string;
  defaults: {
    colorway: string;
    energy: number;
    /** By depth, cycled. Something has to be opaque at the bottom. */
    blend: Blend[];
    /** Sources by depth, for a track whose name says nothing. */
    sources: SourceKind[];
    /** Most effects a layer may carry at once, however many the cascade offers. */
    maxEffects: number;
  };
}

// --- what is on screen --------------------------------------------------

/**
 * An effect and how far it is dialled in.
 *
 * `amount` rather than presence is what makes energy continuous. An effect that
 * could only be on or off would make a chorus a step change; at 0.3 it is a
 * suggestion and at 0.95 it has taken the picture over, and the archetype's
 * energy is what moves between them.
 */
export interface AppliedEffect {
  /** A key into `Scheme.effects`. The renderer looks up how to draw it. */
  id: string;
  /** 0–1. Every effect mixes against its untouched input by this. */
  amount: number;
}

export interface Layer {
  /** Live's track index, and the layer's identity. */
  t: number;
  name: string;
  /**
   * Resolved from the song's colourway by depth — **not** from the clip.
   *
   * Clip colour belongs to whoever is reading the grid to find their place in
   * the show, and driving the picture from it would mean choosing between a set
   * you can navigate and a set that looks right.
   */
  color: number;
  source: SourceKind;
  /** Additive across the cascade, ordered, and already capped by energy. */
  effects: AppliedEffect[];
  /**
   * Every effect id the cascade offered, before `maxEffects` and energy cut it
   * down. The editor shows this: what a layer *would* carry explains what it
   * carries far better than the survivors do.
   */
  offers: string[];
  blend: Blend;
  /** The energy this layer joins the picture at, derived or bound. */
  floor: number;
  /** 0–1, from the track's fader, already gated by this layer's energy floor. */
  opacity: number;
  /** 0–1 output meter, for anything that should move with the sound. */
  level: number;
  /** The archetype's energy, biased by the song, the track and the clip. */
  energy: number;
  /** Turned off in the scheme rather than by the set. Drawn nowhere, listed everywhere. */
  hidden: boolean;
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
  layers: Layer[];
  /** The song the set's names describe, when they describe one. */
  song: string | null;
  /** The role the playing scene names. */
  role: string | null;
  /** Which archetype answered. Null when the role has none defined. */
  archetype: string | null;
  colorway: string | null;
  /** The section's own energy, after the song's bias and before any layer's. */
  energy: number;
  schemeError: string | null;
  /**
   * Every role and song the set contains, so the editor can offer them.
   *
   * Sent with the show rather than fetched, because an editor that made you
   * type a role name is an editor that lets you typo one — and a rule matching
   * nothing is invisible until the section it was for arrives on stage.
   */
  roles: string[];
  songs: string[];
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
      /** By layer, in the order the last `show` gave them. */
      levels: number[];
      opacity: number[];
    }
  | { kind: 'scheme'; scheme: Scheme };

/**
 * Browser to server. One message: the whole scheme, replaced.
 *
 * Whole rather than a patch because the scheme is a few kilobytes and an editor
 * that sent deltas would need every one of them to be reversible to be
 * undoable. The server writes it to `scheme.json`, which stays the record.
 */
export type Up = { kind: 'scheme'; scheme: Scheme };

export const VISUALS_PORT = 17900;
export const VISUALS_WS_PATH = '/ws';
