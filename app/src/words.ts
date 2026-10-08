/**
 * The plain words the app says, for what the code and MilkDrop call by other
 * names. Every piece of UI copy uses these: the left side is how the code, the
 * docs and MilkDrop talk; the right is what someone playing music reads.
 */
export const WORDS = {
  bench: 'preview',
  sensitivity: 'how much it reacts',
  hold: 'stay on this one',
  'the one': 'bar start',
  pack: 'full library',
  'auto-advance': 'move on by itself',
  'audio input': 'listen to',
  'process tap': 'your DAW',
  'Ableton Link': 'keep in time with Ableton',
  quantum: 'beats in a bar',
} as const;

export type Jargon = keyof typeof WORDS;

/** The plain word for `term`. */
export const say = (term: Jargon): string => WORDS[term];

/** `say(term)` with its first letter capitalised, to start a sentence or a button. */
export const Say = (term: Jargon): string => {
  const w = say(term);
  return w.charAt(0).toUpperCase() + w.slice(1);
};
