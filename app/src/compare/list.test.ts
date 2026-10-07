import { describe, expect, it } from 'vitest';
import type { Approval, Listed } from './api.ts';
import { basename, filter, step, tilde, windowAround } from './list.ts';
import { bands, xorshift } from './butterchurn.ts';
import { cacheKey, latin1 } from './convert.ts';

const preset = (group: string, name: string): Listed => ({ path: `/p/${group}/${name}.milk`, name, group, id: `${group}/${name}.milk` });
const list = [preset('Geometric', 'Cube'), preset('Geometric', 'Sphere'), preset('Fractal', 'Fern'), preset('Fractal', 'Snow')];
const verdict = (v: Approval['verdict'], note = ''): Approval => ({ verdict: v, note, score: null, at: '' });
const approvals = { 'Geometric/Cube.milk': verdict('approve'), 'Fractal/Fern.milk': verdict('reject', 'too dark'), 'Fractal/Snow.milk': verdict(null, 'check') };

describe('the approvals file as the view names it', () => {
  it('shortens the home directory to ~ and nothing else', () => {
    expect(tilde('/Users/ryan/.openflow/visuals/compare/approvals.json')).toBe('~/.openflow/visuals/compare/approvals.json');
    expect(tilde('/home/ryan/a.json')).toBe('~/a.json');
    expect(tilde('/Users/ryan')).toBe('~');
    expect(tilde('/opt/Users/ryan/a.json')).toBe('/opt/Users/ryan/a.json');
    expect(tilde('/Users')).toBe('/Users');
  });
  it('says only the file name', () => {
    expect(basename('/Users/ryan/.openflow/visuals/compare/approvals.json')).toBe('approvals.json');
    expect(basename('C:\\x\\approvals.json')).toBe('approvals.json');
    expect(basename('')).toBe('');
  });
});

describe('the compare list', () => {
  it('filters by every word and by verdict', () => {
    expect(filter(list, approvals, 'geo sph', 'all').map((p) => p.name)).toEqual(['Sphere']);
    expect(filter(list, approvals, '', 'open').map((p) => p.name)).toEqual(['Sphere', 'Snow']);
    expect(filter(list, approvals, '', 'approve').map((p) => p.name)).toEqual(['Cube']);
    expect(filter(list, approvals, '', 'reject').map((p) => p.name)).toEqual(['Fern']);
    expect(filter(list, approvals, '', 'noted').map((p) => p.name)).toEqual(['Fern', 'Snow']);
  });

  it('steps and wraps', () => {
    expect(step(list, list[0].path, 1)?.name).toBe('Sphere');
    expect(step(list, list[0].path, -1)?.name).toBe('Snow');
    expect(step(list, '/nowhere', -1)?.name).toBe('Snow');
    expect(step([], null, 1)).toBeNull();
  });

  it('draws a window around the current row', () => {
    expect(windowAround(10, 3, 20)).toEqual([0, 10]);
    expect(windowAround(1000, 500, 100)).toEqual([450, 550]);
    expect(windowAround(1000, 990, 100)).toEqual([900, 1000]);
    expect(windowAround(1000, -1, 100)).toEqual([0, 100]);
  });
});

describe('the reference side', () => {
  it('draws from the engine generator', () => {
    // The first values of eel::Memory::random seeded with 1, as harness/compare.ts has them.
    const a = xorshift(1n);
    const b = xorshift(7n);
    b.reseed(1n);
    const first = [a.random(), a.random()];
    expect([b.random(), b.random()]).toEqual(first);
    expect(first.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it('tunes the bands to the sample rate', () => {
    expect(bands(44_100)).toEqual({ starts: [0, 6, 64], stops: [6, 64, 255] });
    expect(bands(48_000).starts[2]).toBe(59);
  });

  it('keys the cache as Node does', async () => {
    // createHash('sha256').update(Buffer.from([0x61, 0xe9]).toString('latin1')).digest('hex')
    const text = latin1(new Uint8Array([0x61, 0xe9]));
    expect(text).toBe('aé');
    const { createHash } = await import('node:crypto');
    expect(await cacheKey(text)).toBe(createHash('sha256').update(text).digest('hex'));
  });
});
