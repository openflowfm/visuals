import { invoke, listen, type UnlistenFn } from './ipc';

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
 * `live` with `VISUALS_LIVE=1`; null for the page's own start. `live` opens the
 * output on a display as it starts (the one place live does so by itself, for
 * launches and headless captures of the output); `live-windowed` plays in the
 * window, as going live from Home does; `library` is the home opened on its
 * library pane.
 */
export type StartView = 'home' | 'library' | 'live' | 'live-windowed';
export const liveStart = () => invoke<StartView | null>('live_start');

/**
 * The page's view for `liveStart`'s answer, with whether live plays in the window
 * (`windowed` false: it opens the output as it starts, `Live`'s `windowed`) and
 * whether the home opens on its library pane; `home` (the build's own start)
 * when it names none.
 */
export function startIn<V extends string>(view: StartView | null, home: V): { view: V | 'live' | 'home'; windowed?: boolean; library?: boolean } {
  if (view === 'live') return { view: 'live', windowed: false };
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
/** Esc off the page going down or coming up: on the output, or with no window of the app's key (after a click on the output). */
export type EscapeSays = 'down' | 'up';
/**
 * Esc off the page: its first press (`down`, never its repeats) and its release
 * or the app being left while it is held (`up`), so a hold can be timed.
 */
export const onEscape = (f: (says: EscapeSays) => void): Promise<UnlistenFn> => listen<EscapeSays>('output-escape', (e) => f(e.payload));

/**
 * `output::Render`: how the live output is drawn. `resolution` is the size it
 * renders at (`'display'`: the display's own pixels), `scale` multiplies it
 * (1 = 100%), `fps` caps the frame rate (null: the display's refresh).
 */
export interface Render {
  resolution: 'display' | [number, number];
  scale: number;
  fps: number | null;
}
export const RENDER_DEFAULT: Render = { resolution: 'display', scale: 1, fps: null };

/**
 * The render settings, and setting them (remembered for next time,
 * `~/.openflow/visuals/render.json`). They drive the live output while it is
 * open; the app answers with the settings it keeps (a scale or rate out of
 * range brought into it).
 */
export const render = () => invoke<Render>('output_render');
export const setRender = (r: Render) => invoke<Render>('output_set_render', { render: r });
