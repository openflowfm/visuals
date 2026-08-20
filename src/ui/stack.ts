import type { Scheme } from '../../protocol.ts';
import { isGenerator } from '../../resolve.ts';

/**
 * Where a look goes when it joins a stack.
 *
 * A stack has exactly one thing at the bottom that draws its own picture, and
 * everything above it works on what is already there. So adding a base replaces
 * the base rather than appending — two generators in a stack means the lower one
 * is drawn and then completely painted over, which costs a full-screen pass to
 * produce nothing.
 *
 * Adding a transformer appends, because that is the whole point of a stack: a
 * kaleidoscope over a ripple is a different picture from either.
 */
export function place(scheme: Scheme, stack: readonly string[], id: string): string[] {
  if (!isGenerator(scheme, id)) return [...stack, id];
  return [id, ...stack.filter((each) => !isGenerator(scheme, each))];
}

/** In, or out. The library's `+` and `−` are the same button. */
export function toggleIn(scheme: Scheme, stack: readonly string[], id: string): string[] {
  return stack.includes(id) ? stack.filter((each) => each !== id) : place(scheme, stack, id);
}

/**
 * A stack that will actually show the look you are editing.
 *
 * The reason this is not just `[id]`: once source and effect became one noun, a
 * transformer previewed alone mixes against a black frame and comes back black.
 * Selecting one in the library and seeing nothing would read as a broken look
 * rather than as a look with nothing under it, so it gets a base — the one
 * already in the stack if there is one, or a sensible default.
 */
export function stackFor(scheme: Scheme, stack: readonly string[], id: string, fallback: string): string[] {
  if (stack.includes(id)) return [...stack];
  const next = place(scheme, stack, id);
  if (next.some((each) => isGenerator(scheme, each))) return next;
  return scheme.looks[fallback] ? [fallback, ...next] : next;
}
