/**
 * How long a preset picked on the page (a tile, a dot on a map) is claimed: shown playing at once,
 * the deck's word on another preset taken as it catching up rather than news, until the app says
 * the pick plays or this many ms pass. Home's claim and Live's map's share it.
 */
export const CLAIM_MS = 2000;

/** A preset picked on the page, lit before the app says it plays. */
export interface Claim {
  path: string;
  /** Until when it holds at most (ms, `Date.now()`'s clock). */
  until: number;
  /**
   * Set once the pick's open resolved (`claimSettled`): what played when it was picked. The app
   * has opened the pick by then, so the deck moving off that preset is news, not catching up.
   */
  from?: string | null;
}

/** The claim on `path`, picked at `now`: it holds for `CLAIM_MS`. */
export const claimOf = (path: string, now: number = Date.now()): Claim => ({ path, until: now + CLAIM_MS });

/**
 * Whether `claim` still holds, with `current` playing at `now`: until the picked preset plays, or
 * its time is up. Anything else playing meanwhile (the deck moving on, a Link beat, the preset
 * playing when it was picked) is the deck catching up, not news: the claim holds through it, until
 * the open resolves (`claimSettled`); after that only the preset playing when picked holds it.
 */
export const claimHolds = (claim: Claim, current: string | null, now: number = Date.now()): boolean =>
  current !== claim.path && now < claim.until && (claim.from === undefined || current === claim.from);

/**
 * `claim` once its open resolved, `from` playing when it was picked: from then on it holds only
 * while `from` still plays (the deck's word on the pick not in yet); any other preset is news.
 */
export const claimSettled = (claim: Claim, from: string | null): Claim => ({ ...claim, from });
