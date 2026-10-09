import { describe, expect, it } from 'vitest';
import { after, before, downloadText, haveAll, libraryLine, QUIET_MS, silenceWatch, sizeText, STEPS, stepsFor, testSoundGuard, vibes } from './Onboarding.tsx';
import type { PackStatus } from './pack.ts';
import { EMPTY_DECK, manual, type Lists } from './playlists.ts';

const status = (s: Partial<PackStatus> = {}): PackStatus => ({ starter: 40, installed: 0, total: 9795, size: 130_000_000, state: 'idle', received: 0, error: null, ...s });

describe('the test sound guard', () => {
  const recorder = () => {
    const sent: boolean[] = [];
    let answer: () => void = () => {};
    const send = (on: boolean) => {
      sent.push(on);
      return new Promise<void>((done) => (answer = done));
    };
    return { sent, send, answer: () => answer() };
  };

  it('stops the sound on leaving before the start has answered', () => {
    const r = recorder();
    const g = testSoundGuard(r.send);
    g.send(true);
    g.leave();
    expect(r.sent).toEqual([true, false]);
  });

  it('sends nothing on leaving when the sound was never started', () => {
    const r = recorder();
    testSoundGuard(r.send).leave();
    expect(r.sent).toEqual([]);
  });

  it('sends nothing on leaving after the sound ended by itself', () => {
    const r = recorder();
    const g = testSoundGuard(r.send);
    g.send(true);
    g.ended();
    g.leave();
    expect(r.sent).toEqual([true]);
  });

  it('sends nothing on leaving after a stop has answered', async () => {
    const r = recorder();
    const g = testSoundGuard(r.send);
    g.send(true);
    r.answer();
    const stopped = g.send(false);
    r.answer();
    await stopped;
    g.leave();
    expect(r.sent).toEqual([true, false]);
  });
});

describe('the welcome steps', () => {
  it('ask about Ableton only when it is on the network', () => {
    expect(stepsFor(0)).toEqual(['welcome', 'listen', 'library', 'warning', 'vibe']);
    expect(stepsFor(2)).toEqual([...STEPS]);
    expect(after('listen', 0)).toBe('library');
    expect(after('listen', 1)).toBe('link');
    expect(before('library', 0)).toBe('listen');
    expect(before('library', 1)).toBe('link');
  });

  it('end after the vibe and have nothing before the welcome', () => {
    expect(after('vibe', 0)).toBeNull();
    expect(before('welcome', 3)).toBeNull();
  });

  it('carry on past the Ableton step when Ableton leaves while it shows', () => {
    expect(after('link', 0)).toBe('library');
    expect(before('link', 0)).toBeNull();
  });

  it('go flashing-light warning, then the vibe, last', () => {
    const s = stepsFor(1);
    expect(s.slice(-2)).toEqual(['warning', 'vibe']);
  });
});

describe('the full library step', () => {
  it('says what there is now and what the download is', () => {
    expect(libraryLine(status())).toBe('You have 40 to start with. The full library is 9,795 presets (130 MB).');
    expect(libraryLine(status({ starter: 0 }))).toBe('The full library is 9,795 presets (130 MB).');
    expect(libraryLine(status({ size: 0 }))).toBe('You have 40 to start with. The full library is 9,795 presets.');
  });

  it('sizes downloads plainly', () => {
    expect(sizeText(130_000_000)).toBe('130 MB');
    expect(sizeText(2_400_000_000)).toBe('2.4 GB');
    expect(sizeText(1200)).toBe('1 KB');
    expect(sizeText(0)).toBe('');
  });

  it('follows the download', () => {
    expect(downloadText(status())).toBe('');
    expect(downloadText(status({ state: 'downloading', received: 65_000_000 }))).toBe('Downloading — 50%. It carries on while you play.');
    expect(downloadText(status({ state: 'downloading', size: 0 }))).toBe('Downloading — it carries on while you play.');
    expect(downloadText(status({ state: 'failed', error: 'offline' }))).toMatch(/stopped/);
    expect(downloadText(status({ installed: 9795 }))).toBe('You have the full library.');
  });

  it('knows when there is nothing to download', () => {
    expect(haveAll(status({ installed: 9795 }))).toBe(true);
    expect(haveAll(status({ installed: 40 }))).toBe(false);
    expect(haveAll(status({ total: 0 }))).toBe(false);
  });
});

describe('the vibes', () => {
  const lists = (playlists: Lists['playlists']): Lists => ({ playlists, deck: EMPTY_DECK });
  const item = (name: string, missing = false) => ({ path: `/p/${name}.milk`, name, group: '', missing, hash: null });

  it('offer the playlists with presets that are there, by their place in the list', () => {
    const offered = vibes(lists([manual('a', 'empty', []), manual('b', 'chill', [item('one'), item('gone', true)]), manual('c', 'gone', [item('x', true)])]));
    expect(offered).toEqual([{ index: 1, name: 'chill', size: 1 }]);
  });

  it('offer nothing before the playlists have been read', () => {
    expect(vibes(null)).toEqual([]);
  });
});

describe('the silence watch', () => {
  it('says quiet after five seconds of nothing, not before', () => {
    const w = silenceWatch();
    expect(w.hear(0, 0)).toBe(false);
    expect(w.hear(0, QUIET_MS - 1)).toBe(false);
    expect(w.hear(0, QUIET_MS)).toBe(true);
  });

  it('starts over when sound comes back', () => {
    const w = silenceWatch();
    w.hear(0, 0);
    expect(w.hear(0.2, 4000)).toBe(false);
    expect(w.hear(0, 5000)).toBe(false);
    expect(w.hear(0, 9999)).toBe(false);
    expect(w.hear(0, 10_000)).toBe(true);
  });

  it("counts a room's hum as silence and a bad reading as sound", () => {
    const w = silenceWatch();
    w.hear(0.001, 0);
    expect(w.hear(0.02, QUIET_MS)).toBe(true);
    expect(w.hear(Number.NaN, QUIET_MS + 1)).toBe(false);
  });
});
