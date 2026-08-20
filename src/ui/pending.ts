import type { Archetype, Blend, LayerSpec, Scheme, SetGrid, SongSpec } from '../../protocol.ts';
import { setLayer } from './edits.ts';

/**
 * An edit that has not landed yet.
 *
 * **Nothing is committed until it has been seen next to what it replaces.** That
 * is the one rule this module exists to make possible, and it is the difference
 * between this and a settings screen: a change here builds a *second scheme*,
 * which a second compositor draws on the same clock, so before and after are the
 * same instant of the same song and the only thing that differs is the edit.
 *
 * An edit is therefore a value rather than a mutation — a scope, a key, a field
 * and what it becomes. It has to be a value for three reasons: the proposed
 * scheme is built by folding a list of them, "the change" panel reads them back
 * to say what is about to happen, and discarding is dropping the list rather
 * than reversing anything.
 */

/**
 * How far a change reaches, which is the question the gesture is really about.
 *
 * Every one of these is a level of the cascade, and picking the wrong one is how
 * a show quietly drifts: the same annoyance can be fixed at any of them, and the
 * fix that was meant for one chorus lands on every song that uses the track.
 */
export type Scope = 'song' | 'section' | 'track' | 'clip';

export const SCOPES: readonly Scope[] = ['song', 'section', 'track', 'clip'];

export type Field = 'colorway' | 'energy' | 'blend' | 'bias' | 'floor' | 'hide' | 'looks';

export type Value = string | number | boolean | string[] | undefined;

export interface Edit {
  scope: Scope;
  /** Song name, role, track name or clip name — whatever the scope is keyed by. */
  key: string;
  field: Field;
  to: Value;
}

/** Which fields each level is actually in a position to decide. */
export const FIELDS: Record<Scope, Field[]> = {
  song: ['colorway', 'bias'],
  section: ['energy', 'looks'],
  track: ['looks', 'blend', 'bias', 'floor', 'hide'],
  clip: ['looks', 'blend', 'bias', 'floor', 'hide'],
};

/** What a field says right now, before anything is staged. */
export function valueAt(scheme: Scheme, scope: Scope, key: string, field: Field): Value {
  if (scope === 'song') {
    const song = scheme.songs[key];
    return field === 'colorway' ? song?.colorway : song?.bias;
  }
  if (scope === 'section') {
    const arch = scheme.archetypes[key];
    return field === 'energy' ? arch?.energy : arch?.looks;
  }
  const spec = scope === 'track' ? scheme.layers[key] : scheme.clips[key];
  return spec?.[field as keyof LayerSpec] as Value;
}

/**
 * The scheme as it would be, with every staged edit folded in.
 *
 * Later edits to the same field win, so staging twice is not staging twice —
 * turning a knob emits on every pointer move and a list that kept all of them
 * would say "density .61 ▸ .62 ▸ .63" where it should say ".58 ▸ .63".
 */
export function applyEdits(scheme: Scheme, edits: readonly Edit[]): Scheme {
  let next = scheme;
  for (const edit of edits) next = applyEdit(next, edit);
  return next;
}

function applyEdit(scheme: Scheme, edit: Edit): Scheme {
  const { scope, key, field, to } = edit;
  if (scope === 'song') {
    const song: SongSpec = { ...scheme.songs[key] };
    if (field === 'colorway') song.colorway = to as string | undefined;
    if (field === 'bias') song.bias = to as number | undefined;
    for (const k of Object.keys(song) as (keyof SongSpec)[]) {
      if (song[k] === undefined) delete song[k];
    }
    const songs = { ...scheme.songs };
    if (Object.keys(song).length === 0) delete songs[key];
    else songs[key] = song;
    return { ...scheme, songs };
  }
  if (scope === 'section') {
    // The default energy only stands in for an archetype that does not exist
    // yet: naming a section for the first time has to start it somewhere.
    const held = scheme.archetypes[key];
    const arch: Archetype = held ? { ...held } : { energy: scheme.defaults.energy };
    if (field === 'energy') arch.energy = to as number;
    if (field === 'looks') arch.looks = to as string[];
    return { ...scheme, archetypes: { ...scheme.archetypes, [key]: arch } };
  }
  const patch: Partial<LayerSpec> = {
    [field]: to as never,
  };
  return scope === 'track'
    ? { ...scheme, layers: setLayer(scheme.layers, key, patch) }
    : { ...scheme, clips: setLayer(scheme.clips, key, patch) };
}

/** Stage one field, replacing any earlier staging of the same one. */
export function stage(edits: readonly Edit[], next: Edit): Edit[] {
  const without = edits.filter(
    (e) => !(e.scope === next.scope && e.key === next.key && e.field === next.field),
  );
  return [...without, next];
}

/**
 * How far a scope reaches, in the set's own units.
 *
 * The whole point of saying it out loud is that the honest answer is often
 * wider than the one you had in mind. A track binding is **global** — the
 * scheme keys layers by track name, not by song and track — so "make the pad
 * calmer" said at track level makes it calmer in every song that has a pad. The
 * level that means *this song's pad* is the clip, which is why the clip is the
 * exception and why this readout counts songs rather than reassuring you.
 */
export interface Reach {
  /** What it lands on, spelled the way the set spells it. */
  lands: string;
  songs: number;
  sections: number;
  clips: number;
}

export function reachOf(
  scope: Scope,
  key: string,
  grid: SetGrid | null,
  trackIndex: number | null,
): Reach {
  const songs = grid?.songs ?? [];
  if (scope === 'song') {
    const row = songs.find((s) => s.key === key || s.name === key);
    return {
      lands: row?.name ?? key,
      songs: row ? 1 : 0,
      sections: row?.roles.length ?? 0,
      clips: row ? Object.values(row.clips).reduce((n, list) => n + list.length, 0) : 0,
    };
  }
  if (scope === 'section') {
    const row = (grid?.sections ?? []).find((s) => s.key === key);
    return {
      lands: `[${key}] in every song`,
      songs: songs.filter((s) => s.roles.includes(key)).length,
      sections: 1,
      clips: row ? Object.values(row.clips).reduce((n, list) => n + list.length, 0) : 0,
    };
  }
  if (scope === 'track') {
    const using = trackIndex === null ? [] : songs.filter((s) => s.clips[trackIndex]);
    return {
      lands: `${key} in every song`,
      songs: using.length,
      sections: new Set(using.flatMap((s) => s.roles)).size,
      clips:
        trackIndex === null
          ? 0
          : using.reduce((n, s) => n + (s.clips[trackIndex]?.length ?? 0), 0),
    };
  }
  const holding = songs.filter((s) => Object.values(s.clips).some((list) => list.includes(key)));
  return {
    lands: key,
    songs: holding.length,
    sections: new Set(holding.flatMap((s) => s.roles)).size,
    clips: 1,
  };
}

/** How one staged edit reads in "the change": what it was, and what it becomes. */
export function describe(scheme: Scheme, edit: Edit): { was: string; becomes: string } {
  const was = valueAt(scheme, edit.scope, edit.key, edit.field);
  return { was: spell(scheme, edit.field, was), becomes: spell(scheme, edit.field, edit.to) };
}

function spell(scheme: Scheme, field: Field, value: Value): string {
  if (value === undefined) return '—';
  if (Array.isArray(value)) {
    return value.length === 0
      ? 'none'
      : value.map((id) => scheme.looks[id]?.name || id).join(' → ');
  }
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number') return field === 'energy' ? value.toFixed(2) : fmt(value);
  return value;
}

function fmt(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return (rounded > 0 ? '+' : '') + String(rounded);
}

export type { Blend };
