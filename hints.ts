/**
 * What a track's name suggests it should draw.
 *
 * These were the scheme's own rule list, then a demoted backstop inside a
 * four-level cascade. The cascade is gone and they survived it, because the
 * thing they were always good at is the thing that is left: **guessing what an
 * instrument looks like from what it is called**, for a set nobody has
 * configured. That is now one node's `by name` mode and nothing else.
 *
 * Word boundaries are load-bearing, not tidiness. Without them `beat` matches
 * inside "Beating Pad" and a pad track draws as a drum — found against a real
 * set, where it was the only wrong thing on screen and the hardest kind of wrong
 * to trace back to a regular expression.
 */
export interface Hint {
  /** What kind of thing this is, which is what a roll deals a picture to. */
  family: string;
  test: RegExp;
  /** A `source` mode. The picture a track of this kind draws. */
  draws: string;
}

export const HINTS: readonly Hint[] = [
  { family: 'drums', test: /\b(kick|drums?|beats?|perc|snare)\b/i, draws: 'strobe' },
  { family: 'bass', test: /\b(bass|sub|808|303)\b/i, draws: 'bars' },
  // Before the keys hint: an arp is a sequence rather than a chord, and four of
  // them scattered across unrelated pictures read as four unrelated things when
  // they are a family.
  { family: 'arp', test: /\barps?\b/i, draws: 'sparks' },
  { family: 'lead', test: /\b(lead|solo|gtr|guitar|vox|vocal)\b/i, draws: 'rings' },
  { family: 'pad', test: /\b(pads?|strings?|atmos|amb|textures?)\b/i, draws: 'noise' },
  { family: 'keys', test: /\b(keys?|synth|chords?|piano|organ|pluck)\b/i, draws: 'grid' },
];

/** What a track draws when nothing else has said. Never null: everything draws. */
export function hint(name: string): string {
  return HINTS.find(({ test }) => test.test(name))?.draws ?? 'plasma';
}

/** Which family a name reads as. `other` for a name that says nothing. */
export function familyOf(name: string): string {
  return HINTS.find(({ test }) => test.test(name))?.family ?? 'other';
}

/** Every family a roll might have to deal a picture to, `other` last. */
export const FAMILIES: readonly string[] = [...HINTS.map((h) => h.family), 'other'];
