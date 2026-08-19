/**
 * What the visuals server sends its browsers.
 *
 * Separate from `protocol/` at the repo root, which is the wire between the
 * browser and the Live device. This one is a layer above it: the server is a
 * *client* of that protocol and speaks this one downstream, so nothing here is
 * Live's vocabulary. A renderer should be able to draw a show without knowing
 * that Ableton exists, and this is the shape that makes that true.
 */

/** How a layer combines with everything already drawn beneath it. */
export type Blend = 'over' | 'add' | 'screen' | 'multiply';

/** What draws a layer's picture. One fragment shader each. */
export type SourceKind = 'solid' | 'bars' | 'rings' | 'noise' | 'strobe' | 'grid';

/** What a layer's picture is put through afterwards. One fragment shader each. */
export type EffectKind = 'mirror' | 'kaleido' | 'shift' | 'pixelate' | 'ripple' | 'smear';

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
   * you can navigate and a set that looks right. The song says what the colours
   * are; the grid stays yours.
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
  /**
   * This layer's own energy: the archetype's, biased by the track and the clip.
   *
   * Per layer rather than per show because the cascade lets a track and a clip
   * bias it — a drum layer can run hotter than the pad underneath it in the same
   * chorus, which is the thing a single global number cannot say.
   */
  energy: number;
  /** The scene index playing in this track, or -1. */
  playing: number;
  clipName: string;
}

/**
 * One coherent description of what should be on screen.
 *
 * Pushed on change and on a slow heartbeat — never per frame. The clock is an
 * *anchor*, not a position, so the browser extrapolates between pushes and stays
 * smooth at any refresh rate.
 */
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
  /** The role the playing scene names — the archetype that was resolved. */
  role: string | null;
  /** Which archetype answered, after fallbacks. Null when nothing matched. */
  archetype: string | null;
  /** Which colourway the song resolved to. */
  colorway: string | null;
  /** The section's own energy, before any track or clip bias. */
  energy: number;
  /** Set when the scheme file failed to parse, so the panel can say so. */
  schemeError: string | null;
}

export const VISUALS_PORT = 17900;
export const VISUALS_WS_PATH = '/ws';
