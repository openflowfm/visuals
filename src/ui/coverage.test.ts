import { describe, expect, it } from 'vitest';
import type { GridRow, Scheme, SetGrid } from '../../protocol.ts';
import { cellFor, cellForColumn, columnsOf, passes } from './coverage.ts';
import { applyEdits, reachOf, stage, type Edit } from './pending.ts';

/**
 * Reading the set, and staging a change to it.
 *
 * Both of these are the kind of pure logic that is invisible when it is wrong:
 * a mis-read cell looks like a colour choice, and an edit folded in the wrong
 * order looks like a knob that did not take. Neither shows up as an error.
 */

const scheme = (over: Partial<Scheme> = {}): Scheme => ({
  colorways: { default: ['#fff'] },
  songs: {},
  archetypes: {},
  layers: {},
  clips: {},
  looks: {},
  defaults: {
    colorway: 'default',
    energy: 0.4,
    blend: ['over'],
    looks: ['bars'],
    maxLooks: 3,
    pace: 0,
  },
  ...over,
});

const row = (clips: Record<number, string[]>): GridRow => ({
  name: 'Nightfall',
  key: 'nightfall',
  roles: ['CHORUS'],
  clips,
});

describe('who answered for a cell', () => {
  const track = { t: 3, name: 'Pad' };

  it('is absent when the row never uses the track', () => {
    // Not a gap. A track this song does not play is nothing to decide about,
    // and colouring it like unfinished work would bury the real gaps.
    expect(cellFor(scheme(), row({}), track).answer).toBe('absent');
  });

  it('is on the backstop when nothing is bound', () => {
    expect(cellFor(scheme(), row({ 3: ['pad loop'] }), track).answer).toBe('backstop');
  });

  it('is inherited when the track is bound', () => {
    const s = scheme({ layers: { Pad: { looks: ['rings'] } } });
    expect(cellFor(s, row({ 3: ['pad loop'] }), track).answer).toBe('inherited');
  });

  it('is said here when a clip in this row carries an exception', () => {
    const s = scheme({ layers: { Pad: { looks: ['rings'] } }, clips: { 'pad loop': { hide: true } } });
    const cell = cellFor(s, row({ 3: ['pad loop', 'pad swell'] }), track);
    expect(cell.answer).toBe('said');
    expect(cell.exceptions).toEqual(['pad loop']);
  });

  it('does not let one row\'s exception answer for another', () => {
    const s = scheme({ clips: { 'other song pad': { hide: true } } });
    expect(cellFor(s, row({ 3: ['pad loop'] }), track).answer).toBe('backstop');
  });
});

describe('a group column', () => {
  const grid: SetGrid = {
    tracks: [
      { t: 0, name: 'Kick', group: 'Drums' },
      { t: 1, name: 'Snare', group: 'Drums' },
      { t: 2, name: 'Pad', group: null },
    ],
    songs: [],
    sections: [],
  };

  it('collapses on the group and leaves loose tracks alone', () => {
    const columns = columnsOf(grid, 'groups');
    expect(columns.map((c) => c.label)).toEqual(['Drums', 'Pad']);
    expect(columns[0].tracks).toHaveLength(2);
  });

  it('takes the strongest answer any member gave', () => {
    // The lie that matters runs the other way: a group reading "backstop" while
    // a track inside it is already bound sends you to do work twice.
    const s = scheme({ layers: { Snare: { looks: ['strobe'] } } });
    const column = columnsOf(grid, 'groups')[0];
    expect(cellForColumn(s, row({ 0: ['kick'], 1: ['snare'] }), column).answer).toBe('inherited');
  });
});

describe('the toolbar filter', () => {
  const cell = (answer: 'said' | 'backstop' | 'absent') => ({ answer, clips: [], exceptions: [] });

  it('shows only what nobody has decided', () => {
    expect(passes(cell('backstop'), 'gaps')).toBe(true);
    expect(passes(cell('said'), 'gaps')).toBe(false);
  });

  it('never counts an absent cell as a gap', () => {
    expect(passes(cell('absent'), 'gaps')).toBe(false);
    expect(passes(cell('absent'), 'bound')).toBe(false);
  });
});

describe('staging an edit', () => {
  const edit = (field: Edit['field'], to: Edit['to']): Edit => ({
    scope: 'track',
    key: 'Pad',
    field,
    to,
  });

  it('replaces an earlier staging of the same field', () => {
    // A knob emits on every pointer move. Keeping each one would make "the
    // change" read .58 to .59 to .60 where it should read .58 to .63.
    const staged = stage(stage([], edit('bias', 0.1)), edit('bias', 0.3));
    expect(staged).toHaveLength(1);
    expect(staged[0].to).toBe(0.3);
  });

  it('keeps a different field on the same key', () => {
    const staged = stage(stage([], edit('bias', 0.1)), edit('looks', ['rings']));
    expect(staged).toHaveLength(2);
  });

  it('folds into a scheme without touching the one it came from', () => {
    const base = scheme();
    const next = applyEdits(base, [edit('looks', ['rings'])]);
    expect(next.layers.Pad).toEqual({ looks: ['rings'] });
    expect(base.layers.Pad).toBeUndefined();
  });

  it('drops a binding once its last field is cleared', () => {
    // A binding left behind would claim a decision nobody made, and would stop
    // the name hint ever applying to that track again.
    const base = scheme({ layers: { Pad: { looks: ['rings'] } } });
    expect(applyEdits(base, [edit('looks', undefined)]).layers.Pad).toBeUndefined();
  });
});

describe('how far a change reaches', () => {
  const grid: SetGrid = {
    tracks: [{ t: 0, name: 'Pad', group: null }],
    songs: [
      { name: 'One', key: 'one', roles: ['VERSE'], clips: { 0: ['a', 'b'] } },
      { name: 'Two', key: 'two', roles: ['CHORUS'], clips: { 0: ['c'] } },
      { name: 'Three', key: 'three', roles: ['VERSE'], clips: {} },
    ],
    sections: [],
  };

  it('counts every song a track binding lands on, not the one in front of you', () => {
    // The readout exists to be wider than you expected. A track binding is
    // global, and the level that means "this song's pad" is the clip.
    const reach = reachOf('track', 'Pad', grid, 0);
    expect(reach.songs).toBe(2);
    expect(reach.clips).toBe(3);
    expect(reach.lands).toContain('every song');
  });

  it('narrows to one clip when the scope is the clip', () => {
    const reach = reachOf('clip', 'a', grid, 0);
    expect(reach.clips).toBe(1);
    expect(reach.songs).toBe(1);
  });
});
