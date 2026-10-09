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

/**
 * The view to start in: `VISUALS_VIEW=home|library|live|live-windowed`, or
 * `live` with `VISUALS_LIVE=1`; null for the page's own start. `live-windowed`
 * plays live in the window, without opening the output on a display, and
 * `library` is the home opened on its library pane.
 */
export type StartView = 'home' | 'library' | 'live' | 'live-windowed';
export const liveStart = () => invoke<StartView | null>('live_start');

/**
 * The page's view for `liveStart`'s answer, with whether live plays in the window
 * and whether the home opens on its library pane; `home` (the build's own start)
 * when it names none.
 */
export function startIn<V extends string>(view: StartView | null, home: V): { view: V | 'live' | 'home'; windowed?: boolean; library?: boolean } {
  if (view === 'live-windowed') return { view: 'live', windowed: true };
  if (view === 'library') return { view: 'home', library: true };
  return { view: view ?? home };
}
/** `VISUALS_PRESET=<path>`: the preset to start on, as an absolute path. */
export const startPreset = () => invoke<string | null>('start_preset');
export const displays = () => invoke<Display[]>('displays');
/** Open the live output on display `id` and remember it, or (null) on the one chosen last. */
export const open = (id: number | null) => invoke<Status>('output_open', { id });
export const close = () => invoke<Status>('output_close');
export const status = () => invoke<Status>('output_status');
/** The output opened, moved, resized or closed (its display went away, say). */
export const onStatus = (f: (s: Status) => void): Promise<UnlistenFn> => listen<Status>('output', (e) => f(e.payload));
/** Esc pressed off the page: on the output, or with no window of the app's key (after a click on the output). */
export const onEscape = (f: (payload: null) => void): Promise<UnlistenFn> => listen<null>('output-escape', () => f(null));
