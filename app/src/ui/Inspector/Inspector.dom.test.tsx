// @vitest-environment happy-dom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryRow } from '../model/api';
import { prepareRow } from '../model/librarySearch';
import { DATA, PLAYLISTS, ROWS } from '../fixtures/fixtures';
import { NOW } from '../fixtures/layout';
import { Inspector, TOAST_FOR, type InspectorProps } from './Inspector';

const PLAYING = NOW.preset!;
const prep = (r: LibraryRow) => prepareRow(r, DATA.presets[r.key]);
/** Presets the user hasn't marked never play. */
const SHOWN = ROWS.filter((r) => !DATA.presets[r.key]?.hidden && r.key !== PLAYING.key);

function props(over: Partial<InspectorProps> = {}): InspectorProps {
  return {
    subject: prep(PLAYING),
    playing: PLAYING.key,
    playingPreset: prep(PLAYING),
    from: '',
    playlists: PLAYLISTS,
    library: ROWS,
    mine: DATA.presets,
    onSet: vi.fn(),
    onAddTo: () => {},
    onPick: vi.fn(),
    onBack: vi.fn(),
    map: false,
    ...over,
  } as InspectorProps;
}

const never = () => screen.getByRole('button', { name: 'never play' });
const toast = () => screen.queryByRole('status');

afterEach(() => vi.useRealTimers());

describe('the Never toast', () => {
  it('turns never play on at once, and Undo puts it back', () => {
    const p = props({ subject: prep(SHOWN[0]) });
    render(<Inspector {...p} />);
    fireEvent.click(never());
    expect(p.onSet).toHaveBeenCalledWith([SHOWN[0].key], { hidden: true });
    expect(toast()).toHaveTextContent('Won’t play it on its own');
    fireEvent.click(within(toast()!).getByRole('button', { name: 'Undo' }));
    expect(p.onSet).toHaveBeenLastCalledWith([SHOWN[0].key], { hidden: false });
    expect(toast()).toBeNull();
  });

  it('says "them" for several, and Undo puts back only those it turned on', () => {
    const was = { ...prep(SHOWN[2]), hidden: true };
    const chosen = [prep(SHOWN[0]), prep(SHOWN[1]), was];
    const p = props({ subject: chosen[0], chosen });
    render(<Inspector {...p} />);
    fireEvent.click(never());
    expect(p.onSet).toHaveBeenCalledWith([SHOWN[0].key, SHOWN[1].key, SHOWN[2].key], { hidden: true });
    expect(toast()).toHaveTextContent('Won’t play them on their own');
    fireEvent.click(within(toast()!).getByRole('button', { name: 'Undo' }));
    expect(p.onSet).toHaveBeenLastCalledWith([SHOWN[0].key, SHOWN[1].key], { hidden: false });
  });

  it('goes away on its own', () => {
    vi.useFakeTimers();
    render(<Inspector {...props({ subject: prep(SHOWN[0]) })} />);
    fireEvent.click(never());
    expect(toast()).not.toBeNull();
    act(() => vi.advanceTimersByTime(TOAST_FOR - 1));
    expect(toast()).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(toast()).toBeNull();
  });

  it('shows none for turning never play off', () => {
    const p = props({ subject: { ...prep(SHOWN[0]), hidden: true } });
    render(<Inspector {...p} />);
    fireEvent.click(never());
    expect(p.onSet).toHaveBeenCalledWith([SHOWN[0].key], { hidden: false });
    expect(toast()).toBeNull();
  });

  it('is dismissed by the first Escape, and the next closes the panel', () => {
    const onClose = vi.fn();
    render(<Inspector {...props({ subject: prep(SHOWN[0]), onClose })} />);
    fireEvent.click(never());
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(toast()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('the tune in the inspector', () => {
  it('shows for several picked, "for these presets", and sets all of them', () => {
    const chosen = [prep(SHOWN[0]), prep(SHOWN[1])];
    render(<Inspector {...props({ subject: chosen[0], chosen })} />);
    expect(screen.getByRole('group', { name: 'for these presets' })).toBeTruthy();
    expect(screen.getAllByRole('slider')).toHaveLength(2);
  });
});
