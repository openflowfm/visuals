/**
 * Errors as the live page and the playlists panel show them: one short, plain
 * sentence saying what didn't happen, with the app's own words kept for the
 * tooltip. A raw `String(e)` from a Tauri command is a Rust message ("no display
 * 3", "the playlist has 2 items") that means something to us and little on stage.
 */
export interface Problem {
  /** What didn't happen, in a sentence. */
  text: string;
  /** What the app said, for the tooltip; null when there is nothing more. */
  detail: string | null;
}

/** What an error carried, as text. */
export function detailOf(e: unknown): string | null {
  if (e === null || e === undefined) return null;
  if (typeof e === 'string') return e.trim() || null;
  if (e instanceof Error) return e.message.trim() || null;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/** `text`, with whatever `e` said as the detail. */
export function problem(text: string, e?: unknown): Problem {
  const detail = detailOf(e);
  return { text, detail: detail === text ? null : detail };
}

const nameOf = (path: string) => path.split('/').pop()?.replace(/\.milk$/i, '') ?? path;

/** The `live` event's error: the preset at `path` didn't open, and the last good one keeps drawing. */
export function openFailed(path: string | null, error: string): Problem {
  return problem(path ? `Couldn't open ${nameOf(path)} — the last preset keeps playing.` : "Couldn't open that preset.", error);
}
