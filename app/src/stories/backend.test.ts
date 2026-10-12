import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type * as pl from '../playlists.ts';
import type { CameraFrame } from '../camera/api.ts';
import { handler, seeded, world } from './backend.ts';
import * as F from './fixtures.ts';

// The events it sends go nowhere here: no Tauri to hear them.
vi.mock('@tauri-apps/api/event', () => ({ emit: () => Promise.resolve() }));

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..');

/** The page's own source: no tests, stories, fixtures or the dev bridge. */
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === 'stories' || n === 'dev' ? [] : files(p);
    return /\.tsx?$/.test(n) && !/\.(test|stories)\.tsx?$/.test(n) ? [p] : [];
  });

/** The lab editor's commands: the stories don't show the editor. */
const LAB_ONLY = ['apply', 'default_shader', 'set_value'];

describe("the stories' fake app", () => {
  it('answers every command the page invokes', () => {
    const invoked = new Map<string, string>();
    for (const f of files(src)) for (const m of readFileSync(f, 'utf8').matchAll(/invoke(?:<[^(]*?>)?\(\s*'([a-z_]+)'/g)) invoked.set(m[1], relative(src, f));
    const backend = readFileSync(join(here, 'backend.ts'), 'utf8');
    const handled = new Set([...backend.matchAll(/case '([a-z_]+)':/g)].map((m) => m[1]));
    // The scrape itself works: a few the page is known to send.
    expect([...invoked.keys()]).toEqual(expect.arrayContaining(['library_index', 'playlists', 'act', 'fx_state']));
    const missing = [...invoked].filter(([cmd]) => !handled.has(cmd) && !LAB_ONLY.includes(cmd)).map(([cmd, file]) => `${cmd} (${file})`);
    expect(missing).toEqual([]);
  });

  it('makes up the same values from the same seed', () => {
    const a = seeded(1);
    const b = seeded(1);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect(first.every((n) => n >= 0 && n < 1)).toBe(true);
    expect(seeded(2)()).not.toBe(first[0]);
  });

  it('steps under Hold, as the app’s deck does: next, previous and random', () => {
    const w = world({ lists: { ...F.LISTS, deck: { ...F.PLAYING_DECK, hold: true } } });
    const call = handler(w);
    call('act', { action: { kind: 'next' } });
    expect([w.lists.deck.index, w.lists.deck.hold]).toEqual([3, true]);
    call('act', { action: { kind: 'previous' } });
    expect(w.lists.deck.index).toBe(2);
    call('act', { action: { kind: 'random' } });
    expect(w.lists.deck.current).toBe(F.WARM_UP.items[w.lists.deck.index!].path);
  });

  it('puts back the playlist’s own timing after a live change', () => {
    const tweaked: pl.Deck = {
      ...F.PLAYING_DECK,
      auto: false,
      bars: 8,
      every: { every: 8, unit: 'bars' },
      settings: { ...F.WARM_UP.settings, change: { unit: 'bars', every: 8 } },
      differs: ['change'],
    };
    const w = world({ lists: { ...F.LISTS, deck: tweaked } });
    handler(w)('act', { action: { kind: 'put_back' } });
    const d = w.lists.deck;
    expect([d.auto, d.seconds, d.bars, d.differs, d.settings?.change]).toEqual([true, 30, 0, [], { unit: 'seconds', every: 30 }]);
  });

  it('adds a playlist from a file under the first free name, saying so', () => {
    const w = world();
    const got = handler(w)('playlist_import', { text: JSON.stringify({ name: 'Warm-up' }) }) as pl.Imported;
    expect([got.name, got.renamed]).toEqual(['Warm-up 2', 'A playlist called “Warm-up” was already here, so this one is “Warm-up 2”.']);
    expect(got.lists.playlists.at(-1)).toMatchObject({ id: got.id, name: 'Warm-up 2' });
    expect((handler(w)('playlist_import', { text: JSON.stringify({ name: 'New' }) }) as pl.Imported).renamed).toBeNull();
  });
});

/** Build the transport envelope independently of the fake backend. */
function cameraPacket(sessionToken: string, sequence = 1, width = 1): Uint8Array<ArrayBuffer> {
  const frame: CameraFrame = {
    sessionToken,
    sequence,
    sourceEpoch: 0,
    width,
    height: 1,
    remainingFreshMs: 180,
    feedMix: 0.3,
    cameraOpacity: 0,
    outlineOpacity: 0.65,
    outlineWidth: 0.85,
    interpolationMs: 65,
    paths: [],
  };
  const json = new TextEncoder().encode(JSON.stringify(frame));
  const packet = new Uint8Array(8 + json.length + 4);
  packet.set([67, 65, 77, 49]);
  new DataView(packet.buffer).setUint32(4, json.length, true);
  packet.set(json, 8);
  return packet;
}

describe('camera fixture transport', () => {
  it('acknowledges ordered frames and rejects old sessions without changing audio', () => {
    const w = world();
    const heard = structuredClone(w.heard);
    const call = handler(w);
    const old = call('camera_begin') as string;
    const token = call('camera_begin') as string;
    expect(token).not.toBe(old);
    expect(() => call('camera_submit', cameraPacket(old))).toThrow(/session ended/);
    call('camera_end', { sessionToken: old });
    expect(call('camera_submit', cameraPacket(token))).toBe(1);
    expect(() => call('camera_submit', cameraPacket(token))).toThrow(/out of order/);
    expect(call('camera_submit', cameraPacket(token, 2).buffer)).toBe(2);
    call('camera_end', { sessionToken: token });
    expect(() => call('camera_submit', cameraPacket(token, 3))).toThrow(/session ended/);
    expect(w.heard).toEqual(heard);
  });
  it('rejects invalid or oversized binary frames before acknowledging a sequence', () => {
    const call = handler(world());
    const token = call('camera_begin') as string;
    expect(() => call('camera_submit', {})).toThrow(/binary/);
    expect(() => call('camera_submit', new Uint8Array(2 * 1024 * 1024 + 1))).toThrow(/packet/);
    const badHeader = cameraPacket(token);
    new DataView(badHeader.buffer).setUint32(4, 1024 * 1024 + 1, true);
    expect(() => call('camera_submit', badHeader)).toThrow(/metadata length/);
    expect(() => call('camera_submit', cameraPacket(token, 1, 641))).toThrow(/dimensions/);
    expect(call('camera_submit', cameraPacket(token))).toBe(1);
  });
});
