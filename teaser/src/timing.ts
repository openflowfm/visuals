// Everything in the teaser lands on the music's grid. The placeholder beat is
// 128 bpm, 28 bars (52.5 s); a real track changes BPM, BARS and the sections below.

export const FPS = 60;
export const BPM = 128;
export const BEAT = 60 / BPM; // seconds
export const BAR = BEAT * 4;
export const BARS = 28;

/** The frame at `bars` bars in. */
export const bar = (bars: number) => Math.round(bars * BAR * FPS);
export const beat = (beats: number) => Math.round(beats * BEAT * FPS);
export const LENGTH = bar(BARS);

/** The sections, in bars — the same lines as ../cuts.txt and the beat's arrangement. */
export const SECTIONS = {
  // 2001: MilkDrop in a little Winamp-era window, pad only; it grows over the last bar.
  origin: [0, 4],
  intro: [4, 6],
  // Two facts of two bars, then three bars of Link.
  facts: [6, 13],
  breakdown: [13, 16],
  // DROP OUT, then presets: a bar each, a half-bar each for the last two.
  drop: [16, 24],
  // The name, held back until here.
  outro: [24, 28],
} as const;

/** Where the drop's presets change, in bars — the same times as the drop in ../cuts.txt. */
export const DROP_CUTS = [16, 17, 18, 19, 20, 21, 22, 22.5, 23, 23.5];

export type Section = keyof typeof SECTIONS;

export const sectionAt = (frame: number): Section =>
  (Object.keys(SECTIONS) as Section[]).find((s) => frame >= bar(SECTIONS[s][0]) && frame < bar(SECTIONS[s][1])) ??
  'outro';

/** 0..1 through the current beat. */
export const beatPhase = (frame: number) => ((frame / FPS) % BEAT) / BEAT;

/** The kick's envelope, as the beat draws it: 1 on the beat, decaying. Zero where the kick drops out. */
export const kick = (frame: number) => {
  const s = sectionAt(frame);
  if (s === 'origin' || s === 'breakdown' || s === 'outro') return 0;
  return Math.exp(-beatPhase(frame) * BEAT * 7);
};
