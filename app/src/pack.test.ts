import { describe, expect, it } from 'vitest';
import { authorsOf, credits, megabytes, packAction, TAKEDOWN, type PackStatus } from './pack.ts';

describe('takedown', () => {
  it('goes to the presets repo, where the pack lives', () => {
    expect(TAKEDOWN).toBe('https://github.com/openflowfm/visual-presets/issues/new?title=Preset%20takedown');
  });
});

const status = (s: Partial<PackStatus> = {}): PackStatus => ({
  starter: 250,
  installed: 250,
  total: 9795,
  size: 10_847_153,
  state: 'idle',
  received: 0,
  error: null,
  ...s,
});

describe('megabytes', () => {
  it('rounds to whole megabytes', () => {
    expect(megabytes(10_847_153)).toBe('11 MB');
    expect(megabytes(1_400_000)).toBe('1 MB');
  });
  it('never says 0 MB for something', () => {
    expect(megabytes(1)).toBe('1 MB');
    expect(megabytes(0)).toBe('0 MB');
  });
});

describe('packAction', () => {
  it('offers the full library with its count and size when idle', () => {
    expect(packAction(status())).toEqual({ state: 'idle', label: 'Get the full library: 9,795 presets (11 MB)', progress: null, error: null });
  });
  it('leaves the size out before it is known', () => {
    expect(packAction(status({ size: 0 }))?.label).toBe('Get the full library: 9,795 presets');
  });
  it('shows a percent while downloading', () => {
    const a = packAction(status({ state: 'downloading', received: 10_847_153 / 4 }));
    expect(a?.label).toBe('Getting the full library… 25%');
    expect(a?.progress).toBeCloseTo(0.25);
    expect(a?.error).toBeNull();
  });
  it('offers a retry with the error when the download failed', () => {
    const a = packAction(status({ state: 'failed', received: 100, error: 'The connection dropped.' }));
    expect(a?.label).toBe('Try getting the full library again');
    expect(a?.error).toBe('The connection dropped.');
    expect(packAction(status({ state: 'failed' }))?.error).toBeTruthy();
  });
  it('is gone once every preset is in', () => {
    expect(packAction(status({ installed: 9795 }))).toBeNull();
    expect(packAction(status({ installed: 9800, state: 'downloading' }))).toBeNull();
  });
});

describe('authorsOf', () => {
  it('splits collaborators joined with +', () => {
    expect(authorsOf('EoS + Phat - chasers 11 sentinel C_poltergeist_Blue_mix loavthepsyq')).toEqual(['EoS', 'Phat']);
  });
  it('adds the editor of a "--- X edit" and ignores dashes inside the title', () => {
    expect(authorsOf('TonyMilkdrop - This Is A Painting [Flexi - let go + alien complex] --- Isosceles edit')).toEqual(['TonyMilkdrop', 'Isosceles']);
    expect(authorsOf('suksma - sick star bloat --- Isosceles edit17')).toEqual(['suksma', 'Isosceles']);
  });
  it('reads each === segment and drops a title that is no name', () => {
    expect(authorsOf('Slow transition to black - gas effect === Tripgnosis - FlameOrb --- Isosceles edit')).toEqual(['Tripgnosis', 'Isosceles']);
  });
  it('credits nobody without " - "', () => {
    expect(authorsOf('370')).toEqual([]);
    expect(authorsOf('phliping out ovre normal duqs')).toEqual([]);
  });
  it('splits commas and drops bracketed counts', () => {
    expect(authorsOf('goody(4), hexcollie(3), fed(2), flexi(3) - #12 (less spasticity)')).toEqual(['goody', 'hexcollie', 'fed', 'flexi']);
  });
  it('splits &, and, vs; drops numbers and repeats', () => {
    expect(authorsOf('Reenen & Telek - Slow Shift Matrix')).toEqual(['Reenen', 'Telek']);
    expect(authorsOf('Krash and Fvese - Molten Indecision (Fvese Remix)')).toEqual(['Krash', 'Fvese']);
    expect(authorsOf('Geiss vs Rovastar - x')).toEqual(['Geiss', 'Rovastar']);
    expect(authorsOf('12 - x')).toEqual([]);
    expect(authorsOf('Flexi + flexi - x --- FLEXI edit')).toEqual(['Flexi']);
  });
});

describe('credits', () => {
  it('counts presets per author, most first, then by name, keeping the first spelling', () => {
    const entries = ['Flexi - a', 'flexi + Geiss - b', 'Rovastar - c', 'geiss - d', 'FLEXI - e', 'Aderrasi - f', '370'].map((name) => ({ name }));
    expect(credits(entries)).toEqual([
      { author: 'Flexi', count: 3 },
      { author: 'Geiss', count: 2 },
      { author: 'Aderrasi', count: 1 },
      { author: 'Rovastar', count: 1 },
    ]);
  });
  it('is empty for an empty library', () => {
    expect(credits([])).toEqual([]);
  });
});
