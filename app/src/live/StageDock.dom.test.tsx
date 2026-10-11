// @vitest-environment happy-dom
//
// The Stage's dock: the transport's pause is HOLD, the Next line names what
// comes and when (or why nothing does), the effect keys press as Live's pads
// did (blackout toggles, strobe and freeze hold while pressed and latch on
// Shift), Intensity moves from the keyboard and goes back to the middle on a
// double-click, and More effects… opens its sheet.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as pl from '../playlists.ts';
import { FX, LISTS, PLAYING_DECK } from '../stories/fixtures.ts';
import { SHEET_EVENT, sheetOf } from '../views.tsx';
import type { LiveState } from './live-model.ts';
import { StageDock } from './StageDock.tsx';

/** What the app's commands answer: the bar's meter and audio input, the frame rate, no Link session; nothing else. */
const answer = (cmd: string): unknown => (cmd === 'levels' ? [0.5, 0.5] : cmd === 'stats' ? { fps: 60, cpu_ms: 1 } : ['audio_sources', 'inputs'].includes(cmd) ? [] : null);
vi.mock('@tauri-apps/api/core', () => ({ invoke: (cmd: string) => Promise.resolve(answer(cmd)), convertFileSrc: (p: string) => p }));
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => {}) }));

afterEach(cleanup);

/** Live's state playing Warm-up, its actions spies; `held` and `lists` change what the Next line says. */
function liveState(over: Partial<LiveState> = {}): LiveState {
  const lists = over.lists ?? LISTS;
  const held = over.held ?? false;
  return {
    lists,
    setLists: vi.fn(),
    deck: lists.deck,
    current: lists.deck.current,
    held,
    effects: FX,
    status: { display: null, size: null },
    displays: [],
    inWindow: false,
    data: null,
    key: null,
    star: false,
    rating: null,
    says: pl.nextSays(lists, held),
    up: pl.upNext(lists),
    error: null,
    setError: vi.fn(),
    fail: () => () => {},
    dismiss: vi.fn(),
    act: vi.fn(),
    actFx: vi.fn(),
    show: vi.fn(),
    intensity: 0.5,
    setIntensity: vi.fn(),
    favourite: vi.fn(),
    rate: vi.fn(),
    since: 0,
    ...over,
  };
}

const dock = (live: LiveState) => render(<StageDock live={live} />);

describe('the transport', () => {
  it("holds the preset with the bar's pause, and lets go with its play", () => {
    const live = liveState();
    const { rerender } = dock(live);
    fireEvent.click(screen.getByRole('button', { name: 'pause' }));
    expect(live.actFx).toHaveBeenCalledWith({ kind: 'hold', on: null });

    const held = liveState({ held: true });
    rerender(<StageDock live={held} />);
    fireEvent.click(screen.getByRole('button', { name: 'play' }));
    expect(held.actFx).toHaveBeenCalledWith({ kind: 'hold', on: null });
    expect(screen.getByText('Hold')).toBeTruthy();
  });

  it('steps the deck: previous, next and random', () => {
    const live = liveState();
    dock(live);
    fireEvent.click(screen.getByRole('button', { name: 'previous preset' }));
    fireEvent.click(screen.getByRole('button', { name: 'next preset' }));
    fireEvent.click(screen.getByRole('button', { name: 'random preset' }));
    expect(vi.mocked(live.act).mock.calls.map(([a]) => a.kind)).toEqual(['previous', 'next', 'random']);
  });
});

describe('the Next line', () => {
  it('names the next preset and when it comes', () => {
    const live = liveState();
    if (live.says.kind !== 'item') throw new Error('Warm-up has a next item');
    const { container } = dock(live);
    const line = container.querySelector('.sd-next-line')!;
    expect(within(line as HTMLElement).getByText(live.says.item.name)).toBeTruthy();
    expect(line.textContent).toContain(`every ${PLAYING_DECK.seconds} s`);
    expect(line.textContent).toContain(', from Warm-up');
  });

  it('says nothing comes while held', () => {
    const { container } = dock(liveState({ held: true }));
    expect(container.querySelector('.sd-next-line')!.textContent).toContain('held — nothing changes until you let go of HOLD (H)');
    expect(container.querySelector('.sd-when')).toBeNull();
  });
});

describe('the effect keys', () => {
  it('toggles blackout on a press, named with its key', () => {
    const live = liveState();
    dock(live);
    const blackout = screen.getByRole('button', { name: 'Blackout (B)' });
    expect(blackout.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(blackout);
    expect(live.actFx).toHaveBeenCalledWith({ kind: 'blackout', on: null });
  });

  it('holds strobe while pressed, latches it on Shift, toggles it from the keyboard', () => {
    const live = liveState();
    dock(live);
    const strobe = screen.getByRole('button', { name: /^Strobe/ });
    fireEvent.pointerDown(strobe, { button: 0, pointerId: 1 });
    fireEvent.pointerUp(strobe, { button: 0, pointerId: 1 });
    fireEvent.pointerDown(strobe, { button: 0, pointerId: 2, shiftKey: true });
    fireEvent.keyDown(strobe, { key: 'Enter' });
    expect(vi.mocked(live.actFx).mock.calls.map(([a]) => a)).toEqual([
      { kind: 'strobe', on: true },
      { kind: 'strobe', on: false },
      { kind: 'strobe', on: null },
      { kind: 'strobe', on: null },
    ]);
  });

  it('shows an effect that is on as pressed', () => {
    dock(liveState({ effects: { ...FX, freeze: true } }));
    expect(screen.getByRole('button', { name: /^Freeze/ }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Intensity', () => {
  // The gesture sends at most one value a frame, so each change lands on the next one.
  it('reads as a percentage, moves on the arrows without stepping the deck, and goes back to the middle on a double-click', async () => {
    const live = liveState({ intensity: 0.25 });
    const keys = vi.fn();
    window.addEventListener('keydown', keys);
    dock(live);
    const fader = screen.getByRole('slider', { name: 'Intensity' });
    expect(fader.getAttribute('aria-valuetext')).toBe('25%');
    fireEvent.keyDown(fader, { key: 'ArrowRight' });
    await waitFor(() => expect(vi.mocked(live.setIntensity).mock.calls.at(-1)?.[0]).toBeGreaterThan(0.25));
    expect(keys).not.toHaveBeenCalled();
    fireEvent.doubleClick(fader);
    await waitFor(() => expect(live.setIntensity).toHaveBeenLastCalledWith(0.5));
    window.removeEventListener('keydown', keys);
  });
});

describe('More effects', () => {
  it('opens the More effects sheet', () => {
    const sheets: unknown[] = [];
    const on = (e: Event) => sheets.push(sheetOf(e));
    window.addEventListener(SHEET_EVENT, on);
    dock(liveState());
    fireEvent.click(screen.getByRole('button', { name: 'More effects…' }));
    window.removeEventListener(SHEET_EVENT, on);
    expect(sheets).toEqual(['effects']);
  });
});

describe('the notice', () => {
  it('shows over the dock and is dismissed', () => {
    const live = liveState({ error: { message: "Couldn't change that effect.", detail: null } });
    dock(live);
    expect(screen.getByRole('alert').textContent).toContain("Couldn't change that effect.");
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(live.dismiss).toHaveBeenCalled();
  });
});
