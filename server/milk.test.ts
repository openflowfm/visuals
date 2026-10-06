import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { afterAll, describe, expect, it } from 'vitest';
import type { Scheme } from '../protocol.ts';
import { milkId } from '../milk.ts';
import { poolsOf, whatIsUp } from '../resolve.ts';
import { emptySet } from './bridge.ts';
import type { LinkFrame } from './link.ts';
import { openPresets } from './presets.ts';
import { merge } from './scheme.ts';
import { buildShow, choose, noTurning } from './show.ts';

/**
 * MilkDrop on the wheel, and the library behind it.
 *
 * The bugs worth being sure of are the ones that black a wall: a mode that
 * empties the pool, a "play this" that never lets go, a library that converts a
 * file nobody asked about — or one that will serve a path outside its folder.
 */

const scheme = (rotation: Partial<Scheme['rotation']> = {}): Scheme =>
  merge({
    flows: { a: { name: 'A', circuit: { nodes: [], cords: [] } } },
    colorways: { one: ['#111111'] },
    rotation: { flows: [], colorways: [], bars: 4, onClip: true, colorEvery: 4, ...rotation },
  });

const PRESETS = ['x.milk', 'y.milk', 'z.milk'];

describe('the wheel with presets', () => {
  it('turns through presets only by default, and through flows when there are none', () => {
    expect(poolsOf(scheme(), undefined, PRESETS).flows).toEqual(PRESETS.map(milkId));
    expect(poolsOf(scheme(), undefined, []).flows).toEqual(['a']);
  });

  it('mixes or leaves them out when told to', () => {
    expect(poolsOf(scheme({ milk: 'mix' }), undefined, PRESETS).flows).toEqual([
      'a',
      ...PRESETS.map(milkId),
    ]);
    expect(poolsOf(scheme({ milk: 'off' }), undefined, PRESETS).flows).toEqual(['a']);
  });

  it('deals from starred presets, ignoring ones that have gone', () => {
    const starred = scheme({ presets: ['y.milk', 'gone.milk'] });
    expect(poolsOf(starred, undefined, PRESETS).flows).toEqual([milkId('y.milk')]);
    // Every star gone is "nothing narrowed", not "nothing to draw".
    expect(poolsOf(scheme({ presets: ['gone.milk'] }), undefined, PRESETS).flows).toHaveLength(3);
  });

  it('lets a song pin a preset', () => {
    const pinned = merge({
      ...scheme(),
      songs: { sandstorm: { flows: [milkId('z.milk')] } },
    });
    expect(whatIsUp(pinned, 'sandstorm', { flow: 7, color: 0 }, PRESETS).flow).toBe(milkId('z.milk'));
  });

  it('keeps the pool identical between asks, so the shuffle is not redone every tick', () => {
    const s = scheme();
    expect(poolsOf(s, undefined, PRESETS).flows).toBe(poolsOf(s, undefined, PRESETS).flows);
  });
});

describe('play', () => {
  const LINK: LinkFrame = {
    tempo: 120, beat: 0, phase: 0, quantum: 4, peers: 0, playing: true, at: 0, since: 0,
  };
  const source = (s: Scheme) => ({ current: () => s, error: () => null });

  it('holds what was picked until the wheel next turns', () => {
    const s = scheme();
    const turning = noTurning();
    choose(turning, s, 0, 4, milkId('x.milk'));
    // Four bars a turn at four beats a bar: beat 8 is the same turn, 16 is the next.
    const now = buildShow(emptySet(), { ...LINK, beat: 8 }, source(s), turning, PRESETS);
    expect(now.flow).toBe(milkId('x.milk'));
    const later = buildShow(emptySet(), { ...LINK, beat: 16 }, source(s), turning, PRESETS);
    expect(turning.chosen).toBeNull();
    expect(later.flow).not.toBeNull();
  });

  it('ignores a pick that names nothing drawable', () => {
    const s = scheme();
    const turning = noTurning();
    choose(turning, s, 0, 4, milkId('missing.milk'));
    const now = buildShow(emptySet(), LINK, source(s), turning, PRESETS);
    expect(now.flow).not.toBe(milkId('missing.milk'));
  });
});

describe('the preset library', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'visuals-presets-'));
  fs.mkdirSync(path.join(root, 'Fixtures'));
  fs.copyFileSync(
    path.join(import.meta.dirname, '../test/fixtures/milk/Fixture - Spiral Test.milk'),
    path.join(root, 'Fixtures', 'Spiral.milk'),
  );
  fs.writeFileSync(path.join(root, 'outside.txt'), 'not a preset');
  const library = openPresets(root, { bundled: false });
  afterAll(() => {
    library.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const ask = (id: string) =>
    new Promise<{ status: number; body: string }>((resolve) => {
      let status = 0;
      const res = {
        headersSent: false,
        writeHead(code: number) {
          status = code;
          return this;
        },
        end(body: string) {
          resolve({ status, body });
        },
      } as unknown as http.ServerResponse;
      library.serve(res, id);
    });

  const scanned = async () => {
    for (let i = 0; i < 100 && library.ids().length === 0; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
  };

  it('finds .milk files and names them by folder', async () => {
    await scanned();
    expect(library.shelf().entries).toEqual([
      { id: 'Fixtures/Spiral.milk', name: 'Spiral', group: 'Fixtures' },
    ]);
  });

  it('converts a preset the first time it is asked for, and caches it', async () => {
    await scanned();
    const first = await ask('Fixtures/Spiral.milk');
    expect(first.status).toBe(200);
    const preset = JSON.parse(first.body);
    expect(preset.frame_eqs_str).toContain("a['q8']");
    expect(preset.waves[0].point_eqs_str).toContain("a['x']");
    expect(preset.warp).toContain('shader_body');
    const cached = fs.readdirSync(path.join(root, '.converted'), { recursive: true });
    expect(cached.some((file) => String(file).endsWith('.json'))).toBe(true);
    // Second time from the cache, byte for byte.
    expect((await ask('Fixtures/Spiral.milk')).body).toBe(first.body);
  }, 20_000);

  it('refuses anything the scan did not find', async () => {
    await scanned();
    expect((await ask('outside.txt')).status).toBe(404);
    expect((await ask('../outside.txt')).status).toBe(404);
    expect((await ask('Fixtures/../Fixtures/Spiral.milk')).status).toBe(404);
  });
});
