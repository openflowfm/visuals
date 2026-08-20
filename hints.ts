import type { LayerSpec } from './protocol.ts';

/**
 * What a track's name suggests, for a track nobody has bound.
 *
 * These used to be the scheme's own rule list, editable as regular expressions
 * in the file and in the editor. They are hints now, and the demotion is the
 * point: a pattern language is the wrong surface for a set whose track names are
 * already known, but it is exactly the right shape for a *guess* at one nobody
 * has configured. So the guessing stays and the editing moved to the names
 * themselves — `Scheme.layers`, keyed by what the track is actually called.
 *
 * Word boundaries are load-bearing, not tidiness. Without them `beat` matches
 * inside "Beating Pad" and a pad track draws as a drum — found against a real
 * set, where it was the only wrong layer on screen and the hardest kind of wrong
 * to trace back to a regular expression.
 *
 * It lives beside `protocol.ts` rather than in `server/` because the randomiser
 * needs the same reading of a name that the resolver does. A roll that dealt
 * every track its own unrelated source would look like noise; dealing one source
 * per **family** is what makes a rolled show read as a show, and the families
 * are exactly these.
 */
export interface Hint {
  /** What kind of thing this is, which is what a roll deals a source to. */
  family: string;
  test: RegExp;
  spec: LayerSpec;
}

export const HINTS: readonly Hint[] = [
  {
    family: 'drums',
    test: /\b(kick|drums?|beats?|perc|snare)\b/i,
    spec: { looks: ['strobe'], bias: 0.1, floor: 0 },
  },
  { family: 'bass', test: /\b(bass|sub|808|303)\b/i, spec: { looks: ['bars'], floor: 0.05 } },
  // Before the keys hint: an arp is a sequence rather than a chord, and four of
  // them scattered across unrelated sources read as four unrelated things when
  // they are a family.
  { family: 'arp', test: /\barps?\b/i, spec: { looks: ['bars'], bias: 0.05 } },
  {
    family: 'lead',
    test: /\b(lead|solo|gtr|guitar|vox|vocal)\b/i,
    spec: { looks: ['rings'], bias: 0.1 },
  },
  {
    family: 'pad',
    test: /\b(pads?|strings?|atmos|amb|textures?)\b/i,
    spec: { looks: ['noise'], bias: -0.15 },
  },
  {
    family: 'keys',
    test: /\b(keys?|synth|chords?|piano|organ|pluck)\b/i,
    spec: { looks: ['grid'] },
  },
];

/** What a track with no binding falls back to, or null. First match wins. */
export function hint(name: string): LayerSpec | null {
  return HINTS.find(({ test }) => test.test(name))?.spec ?? null;
}

/** Which family a name reads as. `other` for a name that says nothing. */
export function familyOf(name: string): string {
  return HINTS.find(({ test }) => test.test(name))?.family ?? 'other';
}

/** Every family a roll might have to deal a source to, `other` last. */
export const FAMILIES: readonly string[] = [...HINTS.map((h) => h.family), 'other'];
