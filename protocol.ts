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
export type SourceKind = 'solid' | 'bars' | 'rings' | 'noise' | 'strobe' | 'grid';

/** What a layer's picture is put through afterwards. One fragment shader each. */
export type EffectKind = 'mirror' | 'kaleido' | 'shift' | 'pixelate' | 'ripple' | 'smear';

/** Every member, in the order an editor should offer them. */
export const SOURCE_KINDS: readonly SourceKind[] = [
  'solid',
  'bars',
  'rings',
  'noise',
  'strobe',
  'grid',
];
export const EFFECT_KINDS: readonly EffectKind[] = [
  'mirror',
  'kaleido',
  'shift',
  'pixelate',
  'ripple',
  'smear',
];
export const BLENDS: readonly Blend[] = ['over', 'add', 'screen', 'multiply'];

// --- the scheme, which is what the editor edits -------------------------

/** A rule that matches something by name and contributes to the cascade. */
export interface Rule {
  /** Case-insensitive regular expression, tested against the name. */
  match: string;
  source?: SourceKind;
  /** Added to whatever earlier levels contributed, not replacing it. */
  effects?: EffectKind[];
  blend?: Blend;
  /** Added to the archetype's energy, then clamped. Negative calms a layer. */
  energyBias?: number;
  /**
   * The energy at which this layer joins the picture, 0–1.
   *
   * How energy thins the stack. A layer below its floor fades out rather than
   * cutting, so a section change reads as the picture opening up instead of
   * something failing. Default is derived from depth.
   */
  floor?: number;
}

export interface Archetype {
  /** 0–1. The one number a section is really described by. */
  energy: number;
  /** The character of the section. Dialled in by energy, not switched on. */
  effects?: EffectKind[];
}

export interface Scheme {
  /** Named colour sets, as `#rrggbb`. A song is assigned one. */
  colorways: Record<string, string[]>;
  /** Song name (the set's `songKey`) to colourway name. */
  songs: Record<string, string>;
  /** Role name to its archetype. Roles come from the set's own vocabulary. */
  archetypes: Record<string, Archetype>;
  /** Matched against a track's name. First hit wins for scalars. */
  tracks: Rule[];
  /** Matched against a playing clip's name. The most specific level. */
  clips: Rule[];
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
  kind: EffectKind;
  /** 0–1. Every effect shader mixes against its untouched input by this. */
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
  blend: Blend;
  /** 0–1, from the track's fader, already gated by this layer's energy floor. */
  opacity: number;
  /** 0–1 output meter, for anything that should move with the sound. */
  level: number;
  /** The archetype's energy, biased by the track and the clip. */
  energy: number;
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
  /** The section's own energy, before any track or clip bias. */
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
  /** Track names, for the same reason: a rule can be checked against them. */
  trackNames: string[];
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
 * Whole rather than a patch because the scheme is two kilobytes and an editor
 * that sent deltas would need every one of them to be reversible to be
 * undoable. The server writes it to `scheme.json`, which stays the record.
 */
export type Up = { kind: 'scheme'; scheme: Scheme };

export const VISUALS_PORT = 17900;
export const VISUALS_WS_PATH = '/ws';
