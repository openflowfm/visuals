/**
 * The session's trail: the presets played since the page opened, oldest first, which Live's map
 * draws as a dashed path through their dots. It is the page's (module-level), not live mode's, so
 * leaving Live and coming back keeps it; nothing persists it.
 */
import { useEffect, useSyncExternalStore } from 'react';

/** How many presets the trail keeps: the newest 40. */
export const TRAIL_MAX = 40;

/** The trail after `path` plays: it appended, unless null or the same as the last; only the newest `max` kept. */
export function trailAfter(trail: readonly string[], path: string | null, max: number = TRAIL_MAX): string[] {
  const next = !path || trail[trail.length - 1] === path ? [...trail] : [...trail, path];
  return next.length > max ? next.slice(next.length - max) : next;
}

let session: readonly string[] = [];
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((f) => f());

/** The session's trail as it stands, oldest first. */
export const sessionTrail = (): readonly string[] => session;

/** Note that `path` plays now: the session's trail grows by it (never by null, nor by the preset already last). */
export function noteTrail(path: string | null): void {
  if (!path || session[session.length - 1] === path) return;
  session = trailAfter(session, path);
  tell();
}

/** For stories and tests: start the session's trail over, seeded with `paths` (oldest first). */
export function resetTrail(paths: readonly string[] = []): void {
  session = paths.slice(-TRAIL_MAX);
  tell();
}

const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => void listeners.delete(f);
};

/** The presets played this session, oldest first, `current` appended whenever it changes; it outlives the component (Live unmounting keeps it). */
export function useSessionTrail(current: string | null): readonly string[] {
  useEffect(() => noteTrail(current), [current]);
  return useSyncExternalStore(subscribe, sessionTrail, sessionTrail);
}
