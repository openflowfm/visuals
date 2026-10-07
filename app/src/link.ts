import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/** `link::Unit`. */
export type Unit = 'bars' | 'beats';

/** `link::Every`: change the preset every `every` bars or beats; 0 is off. */
export interface Every {
  every: number;
  unit: Unit;
}

/** `link::Frame`: Ableton Link and the one, ten times a second as the `link` event. */
export interface Frame {
  /** On the network. Off, the clock still runs at the last tempo. */
  enabled: boolean;
  tempo: number;
  peers: number;
  /** Link's start/stop state. A session already playing when we joined reads false. */
  playing: boolean;
  /** Link's session beat: continuous and not aligned to anything musical. */
  beat: number;
  /** Link's phase in the bar, 0 to `quantum`. */
  phase: number;
  quantum: number;
  /** The Link beat the bars are counted from. */
  one: number;
  /** From 1 at the one. */
  bar: number;
  /** From 1 to `quantum`. */
  beatInBar: number;
  /** Beats into the bar counted from the one, 0 to `quantum`. */
  barPhase: number;
  every: Every;
  /** The Link beat of the next change, when changes are on. */
  next: number | null;
  /** `Date.now()` when sampled. */
  at: number;
}

export const state = () => invoke<Frame>('link_state');
/** Join or leave the Link session. Visuals never set its tempo or transport. */
export const enable = (on: boolean) => invoke<Frame>('link_enable', { on });
/** "Here is the one": the nearest bar line, or the coming one late in a bar. */
export const setOne = () => invoke<Frame>('link_set_one');
/** Move the one by `beats`. */
export const nudge = (beats: number) => invoke<Frame>('link_nudge', { beats });
/** Back to Link's own bar lines. */
export const resetOne = () => invoke<Frame>('link_reset_one');
/** Change the preset every `every` bars or beats, on the boundary; 0 is off. Turns auto-advance off. */
export const sync = (every: number, unit: Unit) => invoke<Frame>('link_sync', { every, unit });
export const onFrame = (f: (frame: Frame) => void): Promise<UnlistenFn> => listen<Frame>('link', (e) => f(e.payload));
