// @vitest-environment happy-dom
//
// `useLive` and `useLinkFrame` (useLive.ts) on the fixtures' fake backend: what
// going live sends, how the `live` event moves it, and what leaving puts back.
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { currentBridge, localEvents, setBridge, type InvokeArgs } from './ipc';
import type * as link from './link';
import type * as pl from './playlists';
import { useLinkFrame, useLive } from './useLive';
import { install, type World } from '../fixtures/backend';
import * as F from '../fixtures/fixtures';

/** A promise and what settles it, for a command that answers when the test says. */
function later<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((y, n) => {
    resolve = y;
    reject = n;
  });
  return { promise, resolve, reject };
}

let restore: (() => void)[] = [];
afterEach(() => {
  for (const r of restore.reverse()) r();
  restore = [];
});

/** The fixtures' app behind the page, every command it is sent recorded; `held` commands answer only when the test settles them. */
function backend(over: Partial<World> = {}, held: Record<string, Promise<unknown>> = {}) {
  restore.push(install(over));
  const app = currentBridge();
  const calls: [string, InvokeArgs | undefined][] = [];
  restore.push(
    setBridge({
      ...app,
      invoke: <T,>(cmd: string, args?: InvokeArgs) => {
        calls.push([cmd, args]);
        return (cmd in held ? held[cmd] : app.invoke(cmd, args)) as Promise<T>;
      },
    }),
  );
  const sent = (cmd: string) => calls.filter(([c]) => c === cmd).map(([, a]) => a);
  return { calls, sent };
}

/** Let the commands answer and their effects render. */
const settle = () => act(() => new Promise<void>((done) => setTimeout(done, 0)));

const emit = (event: string, payload: unknown) => act(() => localEvents().emit(event, payload));

const now = (deck: pl.Deck, path: string | null, error: string | null = null): pl.Now => ({ deck, opened: null, path, error });

const EMPTY: pl.Lists = { ...F.LISTS, deck: { ...F.LISTS.deck, current: null } };

describe('useLive', () => {
  it('reads the deck and follows the live event', async () => {
    backend();
    const { result } = renderHook(() => useLive({ start: null }));
    await settle();
    expect(result.current.deck).toEqual(F.LISTS.deck);
    expect(result.current.current).toBe(F.LISTS.deck.current);

    const deck = { ...F.LISTS.deck, index: 3, current: F.row(5).path };
    const since = result.current.since;
    await emit('live', now(deck, deck.current));
    expect(result.current.deck).toEqual(deck);
    expect(result.current.current).toBe(F.row(5).path);
    expect(result.current.since).toBeGreaterThanOrEqual(since);
  });

  it("follows the deck's current when an open says no path", async () => {
    backend();
    const { result } = renderHook(() => useLive({ start: null }));
    await settle();
    await emit('live', now({ ...F.LISTS.deck, current: F.row(7).path }, null));
    expect(result.current.current).toBe(F.row(7).path);
  });

  it('a failed open shows the notice; the next preset that opens clears it', async () => {
    backend();
    const { result } = renderHook(() => useLive({ start: null }));
    await settle();
    await emit('live', now(F.LISTS.deck, F.row(5).path, 'bad shader'));
    expect(result.current.error?.message).toMatch(/^Couldn't open .* the last preset keeps playing\.$/);
    expect(result.current.error?.detail).toBe('bad shader');
    await emit('live', now(F.LISTS.deck, F.row(6).path));
    expect(result.current.error).toBeNull();
  });

  it('plays in the window: no output opened on the way in', async () => {
    const b = backend();
    const { result } = renderHook(() => useLive({ start: null }));
    await settle();
    expect(b.sent('output_open')).toEqual([]);
    expect(b.sent('set_previews')).toEqual([{ which: [], width: expect.any(Number), height: expect.any(Number) }]);
    expect(result.current.displays).toEqual(F.DISPLAYS);
    expect(result.current.inWindow).toBe(true);
  });

  it('started in live mode with another display: opens the output', async () => {
    const b = backend();
    const { result } = renderHook(() => useLive({ start: null, windowed: false }));
    await settle();
    expect(b.sent('output_open')).toEqual([{ id: null }]);
    expect(result.current.status.display).not.toBeNull();
    expect(result.current.inWindow).toBe(false);
  });

  it('started in live mode with the displays unknown (the call failed): opens it all the same', async () => {
    const b = backend({ fail: { displays: 'no displays' } });
    renderHook(() => useLive({ start: null, windowed: false }));
    await settle();
    expect(b.sent('output_open')).toEqual([{ id: null }]);
  });

  it('left before the displays came back: opens nothing', async () => {
    const displays = later<unknown>();
    const b = backend({}, { displays: displays.promise });
    const { unmount } = renderHook(() => useLive({ start: null, windowed: false }));
    await settle();
    unmount();
    displays.resolve(F.DISPLAYS);
    await settle();
    expect(b.sent('output_open')).toEqual([]);
  });

  it('left before the displays call failed: opens nothing', async () => {
    const displays = later<unknown>();
    const b = backend({}, { displays: displays.promise });
    const { unmount } = renderHook(() => useLive({ start: null, windowed: false }));
    await settle();
    unmount();
    displays.reject('gone');
    await settle();
    expect(b.sent('output_open')).toEqual([]);
  });

  it('leaving closes the output and puts the effects back', async () => {
    const b = backend();
    const { unmount } = renderHook(() => useLive({ start: null }));
    await settle();
    expect(b.sent('output_close')).toEqual([]);
    unmount();
    expect(b.sent('output_close')).toHaveLength(1);
    expect(b.sent('act')).toContainEqual({ action: { kind: 'fx_reset' } });
  });

  it('nothing playing: opens the preset asked for', async () => {
    const b = backend({ lists: EMPTY });
    const { result } = renderHook(() => useLive({ start: F.row(4).path }));
    await settle();
    expect(b.sent('open')).toEqual([{ path: F.row(4).path }]);
    expect(result.current.current).toBe(F.row(4).path);
    expect(result.current.error).toBeNull();
  });

  it("nothing playing and the preset asked for won't open: the notice says so", async () => {
    backend({ lists: EMPTY, fail: { open: 'no such file' } });
    const { result } = renderHook(() => useLive({ start: F.row(4).path }));
    await settle();
    expect(result.current.error?.message).toMatch(/^Couldn't open .* the last preset keeps playing\.$/);
    expect(result.current.error?.detail).toBe('no such file');
  });

  it('nothing playing, nothing asked for and nothing to resume: a random preset', async () => {
    const b = backend({ lists: EMPTY, resume: null });
    renderHook(() => useLive({ start: null }));
    await settle();
    expect(b.sent('open')).toEqual([]);
    expect(b.sent('act')).toContainEqual({ action: { kind: 'random' } });
  });

  it('something playing: opens nothing of its own', async () => {
    const b = backend();
    renderHook(() => useLive({ start: F.row(4).path }));
    await settle();
    expect(b.sent('open')).toEqual([]);
    expect(b.sent('act')).toEqual([]);
  });

  describe('rating and starring the preset playing', () => {
    const rated = F.row(0); // ★, rated 5 in F.DATA
    const playing: pl.Lists = { ...F.LISTS, deck: { ...F.LISTS.deck, current: rated.path } };

    it('rates it; the same number again takes the rating off', async () => {
      const b = backend({ lists: playing });
      const { result } = renderHook(() => useLive({ start: null }));
      await settle();
      expect(result.current.key).toBe(rated.key);
      expect(result.current.rating).toBe(5);
      act(() => result.current.rate(3));
      await settle();
      expect(result.current.rating).toBe(3);
      act(() => result.current.rate(3));
      await settle();
      expect(b.sent('library_set')).toEqual([
        { keys: [rated.key], change: { rating: 3 } },
        { keys: [rated.key], change: { rating: 0 } },
      ]);
      expect(result.current.rating).toBeNull();
    });

    it('stars it, or takes its star off', async () => {
      const b = backend({ lists: playing });
      const { result } = renderHook(() => useLive({ start: null }));
      await settle();
      expect(result.current.star).toBe(true);
      act(() => result.current.favourite());
      await settle();
      expect(b.sent('library_set')).toEqual([{ keys: [rated.key], change: { star: false } }]);
      expect(result.current.star).toBe(false);
    });

    it("a preset the library doesn't list: a notice, nothing sent", async () => {
      const b = backend({ lists: { ...F.LISTS, deck: { ...F.LISTS.deck, current: 'elsewhere/Not In The Library.milk' } } });
      const { result } = renderHook(() => useLive({ start: null }));
      await settle();
      expect(result.current.key).toBeNull();
      act(() => result.current.rate(4));
      expect(result.current.error?.message).toBe("This preset isn't in the library, so it can't be rated.");
      act(() => result.current.favourite());
      expect(result.current.error?.message).toBe("This preset isn't in the library, so it can't be starred.");
      await settle();
      expect(b.sent('library_set')).toEqual([]);
    });
  });

  it('a step that fails says which', async () => {
    backend({ fail: { act: 'deck gone' } });
    const { result } = renderHook(() => useLive({ start: null }));
    await settle();
    act(() => result.current.act({ kind: 'next' }));
    await settle();
    expect(result.current.error).toEqual({ message: "Couldn't go to the next preset.", detail: 'deck gone' });
  });
});

describe('useLinkFrame', () => {
  const frame = (beat: number): link.Frame => ({ ...F.LINK, beat, at: 0 });

  it("reads Link's frame, then follows its event", async () => {
    backend();
    const { result } = renderHook(() => useLinkFrame());
    await settle();
    expect(result.current?.tempo).toBe(F.LINK.tempo);
    await emit('link', frame(70));
    expect(result.current?.beat).toBe(70);
  });

  it('an event before the first read answers wins over the read', async () => {
    const state = later<link.Frame>();
    backend({}, { link_state: state.promise });
    const { result } = renderHook(() => useLinkFrame());
    await settle();
    await emit('link', frame(80));
    state.resolve(frame(10));
    await settle();
    expect(result.current?.beat).toBe(80);
  });

  it('stops listening once unmounted', async () => {
    backend();
    const { unmount } = renderHook(() => useLinkFrame());
    await settle();
    expect(localEvents().count('link')).toBe(1);
    unmount();
    await settle();
    expect(localEvents().count('link')).toBe(0);
  });
});
