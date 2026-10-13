/**
 * What Live's map shows, "This set" or "Library", remembered for the page's session (module
 * state: the panel opens on the scope picked last; nothing persists it).
 */

/** What the map shows: the presets of what the deck plays, or the whole library. */
export type Scope = 'set' | 'library';
export const SCOPES: readonly Scope[] = ['set', 'library'];
export const SCOPE_NAMES = ['This set', 'Library'] as const;

let session: Scope = 'set';

/** The scope picked last this session ("This set" until one is picked). */
export const liveMapScope = (): Scope => session;

/** Remember `scope` as the one picked last. */
export function setLiveMapScope(scope: Scope): void {
  session = scope;
}

/** For stories and tests: start the session over, on "This set". */
export function resetLiveMapScope(): void {
  session = 'set';
}
