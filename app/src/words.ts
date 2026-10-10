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
  /* A playlist with auto-advance off (as one from 0.2 plays): the choice's name, and what it means. */
  'auto-advance off': 'off',
  'auto-advance off hint': 'Stays on each preset until you move on; pick s or bars to move on by itself again',
  /* The auto-advance unit's "s" read aloud (a screen reader would say "s"). */
  'auto-advance seconds': 'seconds',
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
  /* A preset that can't be read or won't load (decision 38); live skips it with a note (decision 60). */
  'failed preset': 'broken preset',
  /* Stepping past presets that panic drawing stopped at its budget (resume::BUDGET): the note's start, then how many in a row. */
  'skip budget spent': 'stopped skipping',
  'skip budget why': "in a row wouldn't draw",
  /* The strobe rate picker's items (¼ ½ 1 2 4) as VoiceOver names them; the glyphs say nothing read aloud. */
  'strobe rate 1/4': 'a quarter flash per beat',
  'strobe rate 1/2': 'half a flash per beat',
  'strobe rate 1': '1 flash per beat',
  'strobe rate 2': '2 flashes per beat',
  'strobe rate 4': '4 flashes per beat',
  /* The mirror picker's items (off X Y 4-way) as VoiceOver names them, each starting with what the item shows, so voice control finds it by what it says (WCAG 2.5.3). */
  'mirror mode off': 'mirror off',
  'mirror mode x': 'X: mirror across',
  'mirror mode y': 'Y: mirror down',
  'mirror mode quad': '4-way: mirror four ways',
  /* Home's layout (decision 67): the panel beside the grid with the preset playing (the code's stage), and the button that opens live mode. */
  stage: 'now playing',
  'live mode': 'go live',
  /* The library's filter chips (facets), behind a button, and a playlist's settings, in a popover (decision 67). */
  facets: 'filter',
  'playlist settings': 'how it plays',
  /* A preset opened on its own, not from a playlist or the library's filter. */
  'played alone': 'opened on its own',
  /* The bundled presets a fresh install has, before the full library (decision 67 offers it in the library then). */
  'starter set': 'starter presets',
  /* The source picker's left and right channels, in Settings (decision 67). */
  'audio channels': 'left and right channels',
  /* Home's empty states (decision 68): a search or filter that finds nothing, and an empty Starred. */
  'no matches': 'Nothing matches',
  'no matches search why': 'Every word has to match a name, style, author or tag.',
  'no matches filter why': 'No preset has every value picked.',
  'clear search': 'Clear the search',
  'clear filter': 'Clear the filter',
  'starred empty': 'Nothing starred yet',
  'starred empty why': 'Star in the now playing panel stars the preset playing.',
  /* The library's search box ("Search 9,795 presets") and an open group's own ("find an author"). */
  search: 'search',
  'find value': 'find',
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
