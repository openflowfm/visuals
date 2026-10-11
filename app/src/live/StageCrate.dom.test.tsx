// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as pl from '../playlists.ts';
import type { LiveState } from './live-model.ts';
import { StageCrate } from './StageCrate.tsx';
import type { CrateMode } from './stage-model.ts';

vi.mock('../playlists.ts', async (original) => ({ ...(await original<typeof import('../playlists.ts')>()), moveItem: vi.fn(), deckItems: vi.fn().mockResolvedValue([]) }));

const item = (name: string): pl.Item => ({ path: `pack/${name}.milk`, name, group: 'pack', missing: false, hash: null });
const LISTS: pl.Lists = { playlists: [pl.manual('m', 'Set', ['a', 'b', 'c'].map(item))], deck: { ...pl.EMPTY_DECK, playlist: 'm', index: 0, current: 'pack/a.milk', next_index: 1 } };

/** Live's state as the crate reads it: the playlists, and `act` to watch. */
function liveOf(lists: pl.Lists | null, act = vi.fn()): LiveState {
  const noop = () => {};
  return {
    lists,
    setLists: noop,
    deck: lists?.deck ?? null,
    current: lists?.deck.current ?? null,
    held: false,
    effects: null,
    status: { display: null, size: null },
    displays: null,
    inWindow: false,
    data: null,
    key: null,
    star: false,
    rating: null,
    says: { kind: 'held' },
    up: null,
    error: null,
    setError: noop,
    fail: () => (e) => expect.unreachable(String(e)),
    dismiss: noop,
    act,
    actFx: noop,
    show: noop,
    intensity: 0.5,
    setIntensity: noop,
    favourite: noop,
    rate: noop,
  };
}

const mount = (mode: CrateMode, live = liveOf(LISTS), onAway = vi.fn()) => {
  render(<StageCrate live={live} mode={mode} onAway={onAway} />);
  return onAway;
};

afterEach(cleanup);

describe('The Stage crate', () => {
  it('shows the mark over the crate, and plays a playlist picked', () => {
    const act = vi.fn();
    mount('docked', liveOf(LISTS, act));
    expect(document.querySelector('.scr-mark .vf-mark')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Set, playing' }));
    expect(act).toHaveBeenCalledWith({ kind: 'load', playlist: 0, index: null });
  });

  it('draws nothing put away', () => {
    mount('hidden');
    expect(document.querySelector('.scr-content')).toBeNull();
  });

  it('says it is reading before the playlists are in', () => {
    mount('overlay', liveOf(null));
    expect(screen.getByText('Reading the playlists…')).toBeTruthy();
  });

  it('leaves Esc to the shell (which puts a laid-over crate away), and keeps its walk to itself', () => {
    const seen = vi.fn();
    window.addEventListener('keydown', seen);
    try {
      const onAway = mount('overlay');
      const set = screen.getByRole('button', { name: 'Set, playing' });
      fireEvent.keyDown(set, { key: 'ArrowDown' });
      expect(seen).not.toHaveBeenCalled();
      fireEvent.keyDown(set, { key: 'Escape' });
      expect(seen).toHaveBeenCalledTimes(1);
      expect(onAway).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', seen);
    }
  });
});
