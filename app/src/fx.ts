import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type Mirror = 'off' | 'x' | 'y' | 'quad';
export type StrobeStyle = 'white' | 'black';
/** What strobe and punch-on-beat follow: the tapped tempo, or beats heard in the bass. */
export type Sync = 'tempo' | 'audio';

/**
 * The live effects' half of `actions::Action`, sent through the same `act` command as
 * next / previous, so a controller mapping reaches them the same way. `on: null` toggles;
 * momentary hits (strobe, punch, freeze) are `on: true` while held and `on: false` on
 * release. Values are clamped by the app.
 */
export type FxAction =
  | { kind: 'speed'; speed: number } // 0.25–4: a scale on the preset clock, 1 normal
  | { kind: 'freeze'; on: boolean | null }
  | { kind: 'transition'; seconds: number } // 0–10, 0 a hard cut
  | { kind: 'strobe'; on: boolean | null }
  | { kind: 'strobe_rate'; rate: number } // flashes per beat, 0.25–4
  | { kind: 'strobe_intensity'; value: number } // 0–1
  | { kind: 'strobe_style'; style: StrobeStyle }
  | { kind: 'sync'; source: Sync }
  | { kind: 'blackout'; on: boolean | null }
  | { kind: 'blackout_fade'; seconds: number } // 0–10
  | { kind: 'punch'; on: boolean | null }
  | { kind: 'punch_on_beat'; on: boolean | null }
  | { kind: 'brightness'; value: number } // 0–2, 1 as drawn
  | { kind: 'hue'; value: number } // 0–1 of a turn
  | { kind: 'invert'; on: boolean | null }
  | { kind: 'mirror'; mode: Mirror | null } // null steps off → x → y → quad
  | { kind: 'trails'; value: number } // 0–1, 0 off
  | { kind: 'sensitivity'; value: number } // 0.25–4, gain on what the presets hear, 1 as heard
  | { kind: 'tap' }
  | { kind: 'bpm'; bpm: number } // 40–240
  | { kind: 'hold'; on: boolean | null }
  | { kind: 'bars'; bars: number } // change preset every this many bars on Link's grid, from the one; 0 stops
  | { kind: 'fx_reset' }; // every picture and time effect back to normal; tempo, sensitivity and settings stay

/** `fx::View`, the `fx` event: every effect's current state, whoever changed it. */
export interface Fx {
  speed: number;
  freeze: boolean;
  transition: number;
  strobe: boolean;
  strobe_rate: number;
  strobe_intensity: number;
  strobe_style: StrobeStyle;
  sync: Sync;
  blackout: boolean;
  blackout_fade: number;
  punch: boolean;
  punch_on_beat: boolean;
  brightness: number;
  hue: number;
  invert: boolean;
  mirror: Mirror;
  trails: number;
  sensitivity: number;
  bpm: number;
  /** The tempo is a Link session's (it has peers); taps don't set it. */
  linked: boolean;
  hold: boolean;
  bars: number;
}

/** The effects held while pressed (and latched with Shift), and blackout, which toggles. */
export type Hit = 'strobe' | 'punch' | 'freeze' | 'blackout';
export const hitAction = (kind: Hit, on: boolean | null): FxAction => ({ kind, on });

/** The keys that hold an effect while they are down. */
export const HOLD_KEYS: Readonly<Record<string, Hit>> = { s: 'strobe', p: 'punch', f: 'freeze' };

/** What an effect key does: hold an effect while it is down, or send one action. */
export type KeyPress = { hold: Hit } | { action: FxAction };

/**
 * The live effect keys: S, P, F hold strobe, punch, freeze (Shift latches them);
 * B blackout, T tap, I invert, M mirror and H hold toggle or step; 0 resets the
 * effects. Null for any other key. `key` is `KeyboardEvent.key`, any case.
 */
export function effectKey(key: string, shift: boolean): KeyPress | null {
  const k = key.toLowerCase();
  const hit = HOLD_KEYS[k];
  if (hit) return shift ? { action: hitAction(hit, null) } : { hold: hit };
  switch (k) {
    case 'b':
      return { action: { kind: 'blackout', on: null } };
    case 't':
      return { action: { kind: 'tap' } };
    case 'i':
      return { action: { kind: 'invert', on: null } };
    case 'm':
      return { action: { kind: 'mirror', mode: null } };
    case 'h':
      return { action: { kind: 'hold', on: null } };
    case '0':
      return { action: { kind: 'fx_reset' } };
    default:
      return null;
  }
}

/**
 * The speed and sensitivity sliders run on a log taper: the position is the
 * multiplier's log2, from −2 (¼×) to 2 (4×), so 1× is the centre and every
 * doubling is the same distance. What is sent stays the plain multiplier.
 */
export const MULTIPLIER_MIN = 0.25;
export const MULTIPLIER_MAX = 4;
export const POSITION_MIN = Math.log2(MULTIPLIER_MIN);
export const POSITION_MAX = Math.log2(MULTIPLIER_MAX);
/** Positions this close to the centre land on exactly 1×. */
export const CENTRE_SNAP = 0.06;

/** A multiplier's place on the slider, −2 to 2; out of range clamps, NaN is the centre. */
export function multiplierToPosition(multiplier: number): number {
  if (Number.isNaN(multiplier) || multiplier <= 0) return Number.isNaN(multiplier) ? 0 : POSITION_MIN;
  return Math.max(POSITION_MIN, Math.min(POSITION_MAX, Math.log2(multiplier)));
}

/** The multiplier at a slider position, ¼× to 4×; near the centre it is exactly 1. */
export function positionToMultiplier(position: number): number {
  if (Number.isNaN(position)) return 1;
  const p = Math.max(POSITION_MIN, Math.min(POSITION_MAX, position));
  return Math.abs(p) < CENTRE_SNAP ? 1 : 2 ** p;
}

/** A multiplier as the panel shows it: `0.25×`, `0.5×`, `1×`, `2.8×`. */
export function formatMultiplier(multiplier: number): string {
  const digits = multiplier < 1 ? 2 : 1;
  return `${Number(multiplier.toFixed(digits))}×`;
}

export const act = (action: FxAction) => invoke<void>('act', { action });
export const state = () => invoke<Fx>('fx_state');
export const onFx = (f: (fx: Fx) => void): Promise<UnlistenFn> => listen<Fx>('fx', (e) => f(e.payload));
