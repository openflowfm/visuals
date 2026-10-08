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

export const act = (action: FxAction) => invoke<void>('act', { action });
export const state = () => invoke<Fx>('fx_state');
export const onFx = (f: (fx: Fx) => void): Promise<UnlistenFn> => listen<Fx>('fx', (e) => f(e.payload));
