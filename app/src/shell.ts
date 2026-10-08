/**
 * The small decisions behind the page's chrome, kept out of the components so
 * they can be tested without a window: what a failure says to the person using
 * the app, how a preset is named, when a key is typing, how full a level meter
 * is, and when the frame rate is worth a word.
 */

/**
 * A failure as every view shows it: one short, plain sentence saying what didn't
 * happen, and what the app actually said, for the tooltip. A raw `String(e)` from
 * a Tauri command is a Rust message ("no display 3") that means something to us
 * and little on stage.
 */
export interface Notice {
  /** What didn't happen, in a sentence. */
  message: string;
  /** What was thrown, as text; null when it adds nothing to the message. */
  detail: string | null;
}

/** What was thrown, as text: Tauri rejects with the command's error string, a JS failure is an `Error`. */
function thrownText(e: unknown): string {
  if (e === null || e === undefined) return '';
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e) ?? String(e);
  } catch {
    return String(e);
  }
}

/**
 * `message`, with whatever `e` said as the detail: trimmed, without the `Error:`
 * a thrown Error's text can carry, and null when it is empty or only repeats the
 * message.
 */
export function notice(message: string, e?: unknown): Notice {
  const detail = thrownText(e)
    .trim()
    .replace(/^(Error|Uncaught \w*Error):\s*/i, '')
    .trim();
  return { message, detail: detail && detail !== message ? detail : null };
}

/** A preset's name, from its path in the pack: the file name without `.milk`. */
export const nameOf = (path: string): string =>
  path
    .split('/')
    .pop()
    ?.replace(/\.milk$/i, '') ?? path;

/** The `live` event's error: the preset at `path` didn't open, and the last good one keeps drawing. */
export function openFailed(path: string | null, error: string): Notice {
  return notice(path ? `Couldn't open ${nameOf(path)} — the last preset keeps playing.` : "Couldn't open that preset.", error);
}

/** A key pressed while typing in a field or picking from a list, which the page's shortcuts leave alone. */
export function isTyping(e: { target: EventTarget | null }): boolean {
  const t = e.target as { closest?: (selector: string) => unknown } | null;
  return typeof t?.closest === 'function' && t.closest('input, textarea, select, [role="combobox"]') != null;
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
