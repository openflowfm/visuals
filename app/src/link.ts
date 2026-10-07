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

/** An interval the "change preset" picker offers. */
export interface Choice extends Every {
  name: string;
}

/** What the picker offers, in order. */
export const CHOICES: readonly Choice[] = [
  { every: 0, unit: 'bars', name: 'off' },
  { every: 1, unit: 'beats', name: 'every beat' },
  { every: 2, unit: 'beats', name: 'every 2 beats' },
  { every: 1, unit: 'bars', name: 'every bar' },
  { every: 2, unit: 'bars', name: 'every 2 bars' },
  { every: 4, unit: 'bars', name: 'every 4 bars' },
  { every: 8, unit: 'bars', name: 'every 8 bars' },
  { every: 16, unit: 'bars', name: 'every 16 bars' },
  { every: 32, unit: 'bars', name: 'every 32 bars' },
];

const same = (a: Every, b: Every) => a.every === b.every && (a.every === 0 || a.unit === b.unit);

/** The choices, with `current` added first when it is one the picker doesn't offer (set by a controller, say). */
export function choicesFor(current: Every): Choice[] {
  if (CHOICES.some((c) => same(c, current))) return CHOICES.map((c) => (c.every === 0 && current.every === 0 ? { ...c, unit: current.unit } : c));
  const unit = current.every === 1 ? current.unit.replace(/s$/, '') : current.unit;
  return [{ ...current, name: `every ${current.every} ${unit}` }, ...CHOICES];
}

/** Where the bar is now: the last frame run on at its tempo, so the light moves smoothly between frames. */
export function runOn(frame: Frame, now: number): { bar: number; phase: number } {
  const beats = Math.max(0, now - frame.at) * (frame.tempo / 60000);
  const q = frame.quantum;
  const since = frame.bar - 1 + (frame.barPhase + beats) / q;
  const bar = Math.floor(since);
  return { bar: bar + 1, phase: (since - bar) * q };
}

/** Beats until the next change on the beat, run on from the frame; null when changes are off. */
export function beatsToNext(frame: Frame, now: number): number | null {
  if (frame.next === null) return null;
  return frame.next - (frame.beat + Math.max(0, now - frame.at) * (frame.tempo / 60000));
}

/** Who the clock follows, in a few words. */
export function statusText(frame: Frame): string {
  const who = !frame.enabled ? 'off the network: our own clock' : frame.peers === 0 ? 'no one else in the session: our own clock' : `${frame.peers} ${frame.peers === 1 ? 'peer' : 'peers'}`;
  return frame.playing ? `${who} · playing` : who;
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
