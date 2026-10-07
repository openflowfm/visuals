// Everything in the teaser lands on the music's grid. The placeholder beat is
// 128 bpm, 23 bars (43.1 s); a real track changes BPM, BARS and the sections below.

export const FPS = 60;
export const BPM = 128;
export const BEAT = 60 / BPM; // seconds
export const BAR = BEAT * 4;
export const BARS = 23;

/** The frame at `bars` bars in. */
export const bar = (bars: number) => Math.round(bars * BAR * FPS);
export const beat = (beats: number) => Math.round(beats * BEAT * FPS);
export const LENGTH = bar(BARS);

/** The sections, in bars — the same lines as ../cuts.txt and the beat's arrangement. */
export const SECTIONS = {
  // 2001: MilkDrop in a little Winamp-era window, pad only.
  origin: [0, 3],
  intro: [3, 5],
  // Two facts of two bars, then three bars of Link.
  facts: [5, 12],
  breakdown: [12, 15],
  drop: [15, 19],
  outro: [19, 23],
} as const;

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
