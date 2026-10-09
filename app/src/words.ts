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
  hidden: 'never play',
  'save query': 'save as smart playlist',
  'user tags': 'my tags',
  'speed low': 'slow',
  'speed mid': 'steady',
  'speed high': 'fast',
  'intensity low': 'calm',
  'intensity mid': 'lively',
  'intensity high': 'wild',
  'render quality': 'picture quality',
  'reduced motion': 'reduce flashing',
  telemetry: 'usage tracking',
  'strobe style': 'strobe colour',
  'strobe rate': 'flashes per beat',
  'blackout fade': 'fade to black',
  'fx reset': 'back to normal',
  'output fit': 'how the picture fills the screen',
  /* A deck following the library grid's filter (any query that isn't a mood). */
  'library query': 'the library',
  /* The crash prompt's reminder (decision 54): the scrub can't catch every name. */
  'crash report check': "Read the text before you submit it: a name the app can't recognise, such as a device's or a display's, may still be in it.",
} as const;

export type Jargon = keyof typeof WORDS;

/** The plain word for `term`. */
export const say = (term: Jargon): string => WORDS[term];

/** `say(term)` with its first letter capitalised, to start a sentence or a button. */
export const Say = (term: Jargon): string => {
  const w = say(term);
  return w.charAt(0).toUpperCase() + w.slice(1);
};
