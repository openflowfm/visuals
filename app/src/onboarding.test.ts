import { beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  after,
  before,
  downloadText,
  FLASH_WARNING,
  FlashWarningDialog,
  OLD_KEY,
  REDUCE_HINT,
  WARNING_TEXT,
  warningOwed,
  warningStore,
  welcomeEnded,
  resetWelcomeEnded,
  type WarningStore,
  haveAll,
  ReduceFlashing,
  libraryLine,
  QUIET_MS,
  silenceWatch,
  sizeText,
  STEPS,
  stepsFor,
  testSoundGuard,
  vibes,
} from './Onboarding.tsx';
import { REDUCE_WHAT } from './access.ts';
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

describe("the flashing-lights warning's answer, kept by the app", () => {
  /** The app's `access.json`, as `flash_warning_understood` and `flash_warning_understand` answer; `refuse` when it can't be written or read. */
  const app = (saved = false, refuse = false) => {
    const a = {
      saved,
      writes: 0,
      understood: () => (refuse ? Promise.reject(new Error('unreadable')) : Promise.resolve(a.saved)),
      understand: () => {
        a.writes++;
        if (refuse) return Promise.reject(new Error("Couldn't save"));
        a.saved = true;
        return Promise.resolve();
      },
    };
    return a;
  };
  /** The page's own storage, where the answer was kept before. */
  const page = (old: string | null = null) => {
    const m = new Map<string, string>(old === null ? [] : [[OLD_KEY, old]]);
    return { getItem: (k: string) => m.get(k) ?? null, removeItem: (k: string) => void m.delete(k) };
  };

  it('is asked of the app, and kept there for the next launch', async () => {
    const files = app();
    const store = warningStore(files, () => page());
    expect(await store.understood()).toBe(false);
    await store.understand();
    expect(files.saved).toBe(true);
    // The next launch, with a fresh page (a dev run's new origin, say): still understood.
    expect(await warningStore(files, () => page()).understood()).toBe(true);
  });

  it('carries an answer the page kept over to the app once, then forgets the old copy', async () => {
    const files = app();
    const storage = page('seen');
    expect(await warningStore(files, () => storage).understood()).toBe(true);
    expect(files.saved).toBe(true);
    expect(storage.getItem(OLD_KEY)).toBe(null);
    expect(await warningStore(files, () => storage).understood()).toBe(true);
    expect(files.writes).toBe(1);
  });

  it('carries nothing over from a warning that was only owed', async () => {
    const files = app();
    expect(await warningStore(files, () => page('owed')).understood()).toBe(false);
    expect(files.writes).toBe(0);
  });

  it('holds this run when the app refuses to keep it, and asks again next launch', async () => {
    const files = app(false, true);
    const storage = page('seen');
    const store = warningStore(files, () => storage);
    // Carried over, but not kept: the old copy stays to carry over next time.
    expect(await store.understood()).toBe(true);
    expect(storage.getItem(OLD_KEY)).toBe('seen');
    const fresh = warningStore(files, () => page());
    expect(await fresh.understood()).toBe(false);
    await fresh.understand();
    expect(await fresh.understood()).toBe(true);
    expect(await warningStore(files, () => page()).understood()).toBe(false);
  });

  it('reads as not understood when the app can’t say, so the warning shows', async () => {
    expect(await warningStore(app(true, true), () => undefined).understood()).toBe(false);
  });

  it('survives page storage that throws', async () => {
    const throwing = () => {
      throw new Error('denied');
    };
    const files = app();
    expect(await warningStore(files, throwing).understood()).toBe(false);
    await warningStore(files, throwing).understand();
    expect(files.saved).toBe(true);
  });
});

describe('the flashing-lights warning, when it is owed', () => {
  const store = (understood: boolean): WarningStore => ({ understood: () => Promise.resolve(understood), understand: () => Promise.resolve() });
  beforeEach(() => resetWelcomeEnded());

  it('is owed once the first run is done, until understood', async () => {
    expect(await warningOwed(store(false), () => Promise.resolve(false))).toBe(true);
    expect(await warningOwed(store(true), () => Promise.resolve(false))).toBe(false);
  });

  it('is not owed on a fresh install: the welcome shows it', async () => {
    expect(await warningOwed(store(false), () => Promise.resolve(true))).toBe(false);
  });

  it('is owed when the app can’t say whether the first run is done', async () => {
    expect(await warningOwed(store(false), () => Promise.reject(new Error('no')))).toBe(true);
  });

  it('is owed after the welcome ended this run, whatever the first-run file says yet', async () => {
    welcomeEnded();
    expect(await warningOwed(store(false), () => Promise.resolve(true))).toBe(true);
    expect(await warningOwed(store(true), () => Promise.resolve(true))).toBe(false);
  });
});

describe('the flashing-lights warning from the menu', () => {
  it("answers the menu item's event", () => {
    expect(FLASH_WARNING).toBe('flash-warning');
  });

  it('is a modal dialog, named by its heading and described by the warning', () => {
    const html = renderToStaticMarkup(createElement(FlashWarningDialog, { onClose: () => {} }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('tabindex="-1"');
    const labelled = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
    const described = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain(`<h2 id="${labelled}">Flashing lights</h2>`);
    expect(html).toContain(`id="${described}"`);
    expect(html).toContain('photosensitive epilepsy');
    expect(html).toContain('I understand');
  });

  it('says reduce flashing calms the app’s effects, and that presets can still flash', () => {
    expect(REDUCE_WHAT).toBe('Calms the app’s strobe, flashes and blackout. Presets can still flash on their own.');
    expect(REDUCE_HINT.startsWith(REDUCE_WHAT)).toBe(true);
    expect(WARNING_TEXT).toContain('Many presets flash');
  });

  it('offers the reduce-flashing switch, disabled until the app has said', () => {
    const off = renderToStaticMarkup(createElement(ReduceFlashing, { motion: null, onChange: () => {} }));
    expect(off).toContain('aria-label="Reduce flashing"');
    expect(off).toMatch(/disabled/);
    const on = renderToStaticMarkup(createElement(ReduceFlashing, { motion: { reduced: true, system: true }, onChange: () => {} }));
    expect(on).toMatch(/aria-(checked|pressed)="true"/);
    expect(on).not.toMatch(/disabled=""/);
  });
});
