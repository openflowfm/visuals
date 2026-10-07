import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/** `output::Display`. */
export interface Display {
  /** `CGDirectDisplayID`. */
  id: number;
  /** In the system's order, from 0. */
  index: number;
  name: string;
  /** In pixels. */
  width: number;
  height: number;
  /** The display with the menu bar. */
  main: boolean;
}

/** `output::Status`: where the live output is, if it is open. */
export interface Status {
  display: Display | null;
  /** The picture's size on the display, in pixels. */
  size: [number, number] | null;
}

/** `VISUALS_LIVE=1`: start in live mode. */
export const liveStart = () => invoke<boolean>('live_start');
export const displays = () => invoke<Display[]>('displays');
/** Open the live output on display `id` and remember it, or (null) on the one chosen last. */
export const open = (id: number | null) => invoke<Status>('output_open', { id });
export const close = () => invoke<Status>('output_close');
export const status = () => invoke<Status>('output_status');
/** The output opened, moved, resized or closed (its display went away, say). */
export const onStatus = (f: (s: Status) => void): Promise<UnlistenFn> => listen<Status>('output', (e) => f(e.payload));
