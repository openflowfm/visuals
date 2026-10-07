/**
 * The small decisions behind the editor's chrome, kept out of the components so
 * they can be tested without a window: what a failure says to the person using
 * the app, how full a level meter is, and when the frame rate is worth a word.
 */

/** A failure as the header shows it: a short sentence, and the raw text for a tooltip. */
export interface Notice {
  message: string;
  detail: string;
}

/**
 * `what` went wrong, in plain words, with whatever was thrown kept as the detail.
 * Tauri rejects with the command's error string; a JS failure is an `Error`.
 */
export function noticeOf(what: string, e: unknown): Notice {
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : e == null ? '' : JSON.stringify(e);
  const detail = raw.replace(/^(Error|Uncaught \w*Error):\s*/i, '').trim();
  return { message: what, detail: detail || what };
}

/**
 * A peak as a meter reads it, 0–1: in decibels, −60 dB empty to 0 dB full. A
 * linear meter shows a signal at −30 dB as a one-pixel sliver.
 */
export function meterLevel(peak: number): number {
  if (!Number.isFinite(peak) || peak <= 0) return 0;
  return Math.max(0, Math.min(1, 1 + (20 * Math.log10(peak)) / 60));
}

/** Below this the picture visibly stutters, and a release build says so. */
export const SLOW_FPS = 45;
/** How many one-second readings in a row must be slow before it says so. */
export const SLOW_FOR = 3;

/**
 * What the header says about the frame rate, given the last few readings (newest
 * last). A developer sees the numbers always; someone using a release sees
 * nothing until the picture has been slow for a few seconds, and then only that.
 */
export function frameReadout(history: readonly { fps: number; cpu_ms: number }[], dev: boolean): { text: string; slow: boolean } | null {
  const now = history[history.length - 1];
  if (!now) return null;
  const recent = history.slice(-SLOW_FOR);
  // No frames at all is the bench not drawing yet (or hidden), not a slow one.
  const slow = recent.length === SLOW_FOR && recent.every((s) => s.fps > 0 && s.fps < SLOW_FPS);
  if (dev) return { text: `${now.fps.toFixed(0)} fps · ${now.cpu_ms.toFixed(2)} ms cpu`, slow };
  return slow ? { text: `running slowly: ${now.fps.toFixed(0)} fps`, slow } : null;
}
