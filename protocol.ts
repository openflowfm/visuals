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

/** What a layer's picture is put through afterwards. */
export type EffectKind = 'none' | 'mirror' | 'kaleido' | 'shift' | 'pixelate';

export interface Layer {
  /** Live's track index, and the layer's identity. */
  t: number;
  name: string;
  /** Live's track colour, as 0xRRGGBB. The set is already colour-coded; use it. */
  color: number;
  /**
   * Bottom layer first, so the renderer composites in array order and the last
   * one is on top. Live's leftmost track is the bottom layer, which matches how
   * a session grid reads.
   */
  source: SourceKind;
  effect: EffectKind;
  blend: Blend;
  /** 0–1, from the track's volume. A track fader is a layer fader. */
  opacity: number;
  /** 0–1 output meter, for anything that should move with the sound. */
  level: number;
  /** The scene index playing in this track, or -1. */
  playing: number;
  /** The clip's own colour when one is playing, else the track's. */
  clipColor: number;
  clipName: string;
}

/**
 * One coherent description of what should be on screen.
 *
 * Pushed on change and on a slow heartbeat — never per frame. The clock below
 * is an *anchor*, not a position, so the browser extrapolates between pushes
 * and stays smooth at any refresh rate.
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
  /** The song the set says is playing, when its names describe one. */
  song: string | null;
  role: string | null;
}

export const VISUALS_PORT = 17900;
export const VISUALS_WS_PATH = '/ws';
