import { useMemo, useState } from 'react';
import type { Scheme, Show, Track } from '../../protocol.ts';
import type { Transport } from './useTransport.ts';

/**
 * The room, faked — so a flow can be judged against conditions that are not
 * happening.
 *
 * The designer already ran on [its own clock](./useTransport.ts), and the
 * argument generalises: if *Ableton running* must not be a precondition for
 * drawing a picture, then neither must **a chorus being played in F# minor with
 * the third colourway up**. Every one of those is a condition a flow behaves
 * differently under, every one of them is a fact a node can read, and waiting
 * for a rehearsal to reach one is not a way to build a library.
 *
 * So this holds a stand-in for each of them and hands back the `Show` the
 * designer should draw. Nothing downstream learns that the room is invented —
 * the bench, the node faces and the compositor all take a `Show` and cannot
 * tell, which is the same trick and the same reason as the clock: what you
 * build at a desk is what will play.
 *
 * ## One switch, not one per fact
 *
 * `following` is the transport's, widened. It used to mean *take the beat from
 * the room* and now means *take the room from the room*, because a half-followed
 * room is a state that exists nowhere: the stage's beat under a desk's section,
 * or the real colourway with an invented key, is neither what you are building
 * nor what will play, and judging a flow against it teaches nothing. Two
 * switches would also be two things to leave in the wrong position.
 */
export interface Room {
  /** Reading the real show rather than these controls. The transport's flag. */
  following: boolean;
  energy: number;
  setEnergy(next: number): void;
  /** The `[ROLE]` a `song section` node reports. */
  section: string;
  setSection(next: string): void;
  /** Every section on offer: the set's own, or the stand-ins below. */
  sections: readonly string[];
  colorway: string;
  setColorway(next: string): void;
  colorways: readonly string[];
  /** Which of `KEYS` is up. An index, because that is what `Select` speaks. */
  keyAt: number;
  setKeyAt(next: number): void;
  /** The show as the designer should draw it, real or invented. */
  show: Show;
}

/**
 * The twelve pitch classes, sharp-spelled.
 *
 * One spelling rather than both because a picker offering `C#` and `Db` would
 * ask you to choose between two names for one number — `server/show.ts` reads
 * either off the set and lands on the same pitch class, and a stand-in only has
 * to reach every value the real thing can.
 */
export const KEYS: readonly string[] = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
];

/**
 * Sections to stand in for a set's own, alphabetical.
 *
 * Alphabetical rather than in song order, which looks like a mistake and is not:
 * `sectionOf` reports where a role sits in `Show.roles`, and the server builds
 * that list sorted. A stand-in ordered intro-to-outro would hand the number a
 * different meaning here from the one it has on stage, which is precisely the
 * disagreement this whole hook exists to avoid.
 */
export const SECTIONS: readonly string[] = ['BRIDGE', 'CHORUS', 'INTRO', 'JAM', 'OUTRO', 'VERSE'];

/** Hex, `#rrggbb` or `#rgb`, to the packed integer the renderer wants. */
function packColor(text: string): number {
  const clean = text.trim().replace(/^#/, '');
  const full = clean.length === 3 ? clean.replace(/./g, '$&$&') : clean;
  const value = Number.parseInt(full, 16);
  return Number.isFinite(value) ? value & 0xffffff : 0xffffff;
}

/**
 * The show with a stand-in set in it, when there is no set.
 *
 * The last invented thing, and the one that could not go in the memo below: it
 * runs off the beat, so it changes sixty times a second and belongs in whatever
 * loop is drawing rather than in React state.
 *
 * Exported because **both** things that draw a flow at a desk need it — the
 * bench and the node faces — and a flow built on the set would otherwise be
 * black in one of them. The stand-ins are deliberately obvious rather than
 * convincing, they take their colours from whatever colourway is up, and they
 * disappear the moment a real set arrives.
 */
export function withStandIns(show: Show, beat: number): Show {
  if (show.connected && show.tracks.length > 0) return show;
  const energy = show.master;
  const pulse = (i: number) => {
    const phase = (beat * (0.5 + i * 0.25)) % 1;
    return Math.max(0, (1 - phase) ** 3) * (0.35 + energy * 0.65);
  };
  const tracks: Track[] = ['Drums', 'Bass', 'Keys', 'Pad'].map((name, i) => ({
    t: i,
    name,
    color: show.colors[i % Math.max(1, show.colors.length)] ?? 0xffb347,
    opacity: 1,
    level: pulse(i),
    playing: 0,
    clipName: '',
  }));
  return { ...show, tracks };
}

export function useRoom(show: Show, scheme: Scheme, transport: Transport): Room {
  const [energy, setEnergy] = useState(0.6);
  const [section, setSection] = useState<string>(SECTIONS[1]);
  const [colorway, setColorway] = useState<string>('');
  const [keyAt, setKeyAt] = useState(0);

  // The set's own names whenever there is a set, because the whole point of the
  // console is that it never asks you to type one. The stand-ins are for the
  // desk, and they go away the moment a real list arrives.
  const sections: readonly string[] = show.roles.length > 0 ? show.roles : SECTIONS;
  const colorways = Object.keys(scheme.colorways);

  // Held by name rather than by index so a set connecting, or a colourway being
  // renamed, moves the picker to something that still exists instead of
  // silently selecting whatever slid into that position.
  const way = colorways.includes(colorway) ? colorway : (colorways[0] ?? '');
  const role = sections.includes(section) ? section : (sections[0] ?? null);

  const invented = useMemo((): Show => {
    // White for a colourway with nothing in it, as the server does: a palette
    // somebody emptied should not be a black screen for every track at once.
    const hex = scheme.colorways[way];
    const colors = (hex?.length ? hex : ['#ffffff']).map(packColor);
    return {
      ...show,
      // The designer's own tempo, so a `song tempo` node reads the number on the
      // transport rather than one no clock in the building is running.
      tempo: transport.bpm,
      quantum: transport.quantum,
      // `uEnergy` is the room's energy — the default an unwired energy inlet
      // falls back to — so the control is the master meter rather than a fifth
      // signal beside it.
      master: energy,
      colorway: way || null,
      colors,
      // A colourway reaches two places: the flow pass takes the first colour,
      // and the set's own pass takes one per track. Recolouring here by position
      // in the set — the rule `server/show.ts` follows — is what makes picking a
      // colourway change a flow that draws the set, which is most of them.
      tracks: show.tracks.map((track, depth) => ({
        ...track,
        color: colors[depth % colors.length],
      })),
      role,
      roles: [...sections],
      key: keyAt / KEYS.length,
    };
  }, [show, scheme, transport.bpm, transport.quantum, energy, way, role, sections, keyAt]);

  return {
    following: transport.following,
    energy,
    setEnergy,
    section: role ?? '',
    setSection,
    sections,
    colorway: way,
    setColorway,
    colorways,
    keyAt,
    setKeyAt,
    show: transport.following ? show : invented,
  };
}
