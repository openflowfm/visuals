// @vitest-environment happy-dom
//
// `useTransport` (StageDock.tsx): the Stage dock's transport props, driven by `useLive` on the
// fixtures' fake backend. Behaviour only: no layout props are asserted.
//
// Spec:
// 1. `playing` is the ring's state: true while the deck is not held, false while HOLD is on, and
//    it follows the `live` event.
// 2. `onPlayPause` toggles HOLD: it sends `act` with `{ kind: 'hold' }` (on: null flips it).
// 3. `onStep(-1 | 1 | 0)` sends `act` with previous, next and random.
// 4. `stepIn` is " in the playlist" while a playlist plays, '' when none does.
// 5. `now` is the preset playing's name and where it plays from (`playsFrom`); null with nothing playing.
// 6. `position` is null with nothing playing; playing, it counts seconds from 0 with the preset's
//    length (the deck's seconds on a clock, null while held).
// 7. `moves` says whether the deck moves on by itself (`movesByItself`), held or not.
// 8. `audio` is false: no audio input on the dock (it is in the header).
// 9. `star` is the playing preset's star (`on` follows it) and toggling it stars it; null when
//    nothing plays or the library doesn't list the preset.
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { currentBridge, localEvents, setBridge, type InvokeArgs } from '../model/ipc';
import { movesByItself, playsFrom } from '../model/home';
import type { LiveState } from '../model/live-model';
import type * as pl from '../model/playlists';
import { nameOf } from '../model/shell';
import { useLive } from '../model/useLive';
import { install, type World } from '../fixtures/backend';
import * as F from '../fixtures/fixtures';
import { useTransport } from './StageDock';

let restore: (() => void)[] = [];
afterEach(() => {
  for (const r of restore.reverse()) r();
  restore = [];
});

/** The fixtures' app behind the page, every command it is sent recorded. */
function backend(over: Partial<World> = {}) {
  restore.push(install(over));
  const app = currentBridge();
  const calls: [string, InvokeArgs | undefined][] = [];
  restore.push(
    setBridge({
      ...app,
      invoke: <T,>(cmd: string, args?: InvokeArgs) => {
        calls.push([cmd, args]);
        return app.invoke(cmd, args) as Promise<T>;
      },
    }),
  );
  const sent = (cmd: string) => calls.filter(([c]) => c === cmd).map(([, a]) => a);
  /** The actions sent with `act`. */
  const acts = () => sent('act').map((a) => (a as { action?: { kind: string; on?: boolean | null } } | undefined)?.action);
  return { sent, acts };
}

const settle = () => act(() => new Promise<void>((done) => setTimeout(done, 0)));
const emit = (event: string, payload: unknown) => act(() => localEvents().emit(event, payload));
const now = (deck: pl.Deck, path: string | null): pl.Now => ({ deck, opened: null, path, error: null });

/**
 * `useLive` and `useTransport` over it, as the Stage dock reads them. `as` changes the live state
 * the transport is handed, for states `useLive` never reaches on the fixtures (it always starts
 * something, so the picture is never black).
 */
async function mount(over: Partial<World> = {}, as: (live: LiveState) => LiveState = (l) => l) {
  const b = backend(over);
  const hook = renderHook(() => {
    const live = useLive({ start: null });
    return { live, t: useTransport(as(live)) };
  });
  await settle();
  return { ...b, ...hook };
}

const nothingPlays = (l: LiveState): LiveState => ({ ...l, current: null, key: null });

describe('useTransport', () => {
  it('spec 1: playing is the deck not held, following HOLD as it changes', async () => {
    const { result } = await mount();
    expect(result.current.live.held).toBe(false);
    expect(result.current.t.playing).toBe(true);
    await act(async () => result.current.t.onPlayPause());
    await settle();
    expect(result.current.live.held).toBe(true);
    expect(result.current.t.playing).toBe(false);
    await act(async () => result.current.t.onPlayPause());
    await settle();
    expect(result.current.live.held).toBe(false);
    expect(result.current.t.playing).toBe(true);
  });

  it('spec 2: play/pause toggles HOLD', async () => {
    const { result, acts } = await mount();
    await act(async () => result.current.t.onPlayPause());
    await settle();
    const holds = acts().filter((a) => a?.kind === 'hold');
    expect(holds).toHaveLength(1);
    expect([null, true]).toContain(holds[0]!.on);
  });

  it('spec 3: the step keys send previous, next and random', async () => {
    const { result, acts } = await mount();
    await act(async () => result.current.t.onStep(-1));
    await act(async () => result.current.t.onStep(1));
    await act(async () => result.current.t.onStep(0));
    await settle();
    const steps = acts();
    expect(steps).toEqual([{ kind: 'previous' }, { kind: 'next' }, { kind: 'random' }]);
  });

  it('spec 4: the step tooltips say "in the playlist" only while one plays', async () => {
    const { result } = await mount();
    expect(F.LISTS.deck.playlist).not.toBeNull();
    expect(result.current.t.stepIn).toBe(' in the playlist');
    await emit('live', now({ ...F.LISTS.deck, playlist: null }, F.LISTS.deck.current));
    expect(result.current.t.stepIn).toBe('');
  });

  it('spec 5: now is the preset playing and where it plays from; null with nothing playing', async () => {
    const { result } = await mount();
    const current = F.LISTS.deck.current!;
    expect(result.current.t.now?.name).toBe(nameOf(current));
    expect(result.current.t.now?.from).toBe(playsFrom(F.LISTS.deck, F.LISTS.playlists));
    const empty = await mount({}, nothingPlays);
    expect(empty.result.current.t.now ?? null).toBeNull();
  });

  it('spec 6: position counts from 0 with the length on a clock, null while held or with nothing playing', async () => {
    const { result } = await mount();
    expect(result.current.t.position?.length).toBe(F.LISTS.deck.seconds);
    expect(result.current.t.position?.elapsed).toBeGreaterThanOrEqual(0);
    expect(result.current.t.position?.elapsed).toBeLessThan(1);
    await act(async () => result.current.t.onPlayPause());
    await settle();
    expect(result.current.live.held).toBe(true);
    expect(result.current.t.position).not.toBeNull();
    expect(result.current.t.position?.length ?? null).toBeNull();
    const empty = await mount({}, nothingPlays);
    expect(empty.result.current.t.position).toBeNull();
  });

  it('spec 7: moves says whether the deck moves on by itself, held or not', async () => {
    const { result } = await mount();
    expect(result.current.t.moves).toBe(movesByItself(F.LISTS.deck));
    expect(result.current.t.moves).toBe(true);
    await emit('live', now({ ...F.LISTS.deck, hold: true }, F.LISTS.deck.current));
    expect(result.current.t.moves).toBe(true);
    const off = { ...F.LISTS.deck, auto: false, bars: 0 };
    await emit('live', now(off, off.current));
    expect(result.current.t.moves).toBe(movesByItself(off));
  });

  it('spec 8: no audio input on the dock', async () => {
    const { result } = await mount();
    expect(result.current.t.audio).toBe(false);
  });

  it("spec 9: the star is the playing preset's, and toggling it stars it", async () => {
    const path = F.row(5).path;
    const deck = { ...F.LISTS.deck, current: path };
    const { result, sent } = await mount({ lists: { ...F.LISTS, deck } });
    expect(result.current.live.key).not.toBeNull();
    const was = result.current.live.star;
    expect(result.current.t.star?.on).toBe(was);
    await act(async () => result.current.t.star!.onToggle());
    await settle();
    expect(sent('library_set').length).toBeGreaterThan(0);
    expect(result.current.t.star?.on).toBe(!was);

    const empty = await mount({}, nothingPlays);
    expect(empty.result.current.t.star ?? null).toBeNull();
    // A preset the library doesn't list has no key.
    const unlisted = await mount({}, (l) => ({ ...l, key: null }));
    expect(unlisted.result.current.t.star ?? null).toBeNull();
  });
});
