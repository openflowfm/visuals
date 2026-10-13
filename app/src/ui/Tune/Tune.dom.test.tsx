// @vitest-environment happy-dom
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { LibraryRow, Look, Mine } from '../model/api';
import { prepareRow } from '../model/librarySearch';
import { TuneCard } from './Tune';

const look: Look = { hues: [200], brightness: 0.5, speed: 2, intensity: 10, brightness_level: 'mid', speed_level: 'mid', intensity_level: 'mid' };
const row = (key: string): LibraryRow => ({ key, path: `/p/${key}.milk`, hash: '', style: 'Hypnotic', sub_style: null, authors: [], title: key, thumbnail: null, look, starter: true });
const BLOOM = row('Bloom');
const CINDER = row('Cinder');
const bloom = (mine?: Mine) => prepareRow(BLOOM, mine);
const cinder = (mine?: Mine) => prepareRow(CINDER, mine);

const speed = () => screen.getByRole('slider', { name: 'speed' });
const reacts = () => screen.getByRole('slider', { name: 'how much it reacts' });
const text = (el: HTMLElement) => el.getAttribute('aria-valuetext');

describe("the inspector's tune for one preset", () => {
  it('shows speed and how much it reacts at 1×, under "for this preset", with no reset', () => {
    render(<TuneCard subjects={[bloom()]} onSet={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'for this preset' })).toBeTruthy();
    expect(text(speed())).toBe('1×');
    expect(text(reacts())).toBe('1×');
    expect(screen.queryByRole('button', { name: 'as made' })).toBeNull();
  });

  it('shows what is kept, and "as made" sends the reset', async () => {
    const onSet = vi.fn();
    render(<TuneCard subjects={[bloom({ tune: { speed: 0.5 } })]} onSet={onSet} />);
    expect(text(speed())).toBe('½×');
    await userEvent.click(screen.getByRole('button', { name: 'as made' }));
    expect(onSet).toHaveBeenLastCalledWith([BLOOM.key], { clear_tune: true });
    expect(text(speed())).toBe('1×');
    expect(screen.queryByRole('button', { name: 'as made' })).toBeNull();
  });

  it('sends once the slider rests, not every step', async () => {
    const user = userEvent.setup();
    const onSet = vi.fn();
    render(<TuneCard subjects={[bloom()]} onSet={onSet} />);
    speed().focus();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(text(speed())).toBe('¼×');
    expect(screen.getByRole('button', { name: 'as made' })).toBeTruthy();
    await waitFor(() => expect(onSet).toHaveBeenCalled());
    expect(onSet).toHaveBeenCalledTimes(1);
    expect(onSet).toHaveBeenLastCalledWith([BLOOM.key], { tune: { speed: 0.25 } });
  });

  it('sends what still waits when it goes', async () => {
    const user = userEvent.setup();
    const onSet = vi.fn();
    const { unmount } = render(<TuneCard subjects={[bloom()]} onSet={onSet} />);
    reacts().focus();
    await user.keyboard('{ArrowRight}');
    act(() => unmount());
    expect(onSet).toHaveBeenCalledWith([BLOOM.key], { tune: { sensitivity: 2 } });
  });
});

describe("the inspector's tune for several presets", () => {
  it('says "for these presets", shows a shared value, and "Mixed" where they differ', () => {
    render(<TuneCard subjects={[bloom({ tune: { speed: 2, sensitivity: 0.5 } }), cinder({ tune: { speed: 2 } })]} onSet={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'for these presets' })).toBeTruthy();
    expect(text(speed())).toBe('2×');
    expect(text(reacts())).toBe('Mixed');
    expect(screen.getByRole('button', { name: 'as made' })).toBeTruthy();
  });

  it('sets a Mixed value on all of them, and "as made" clears all of them', async () => {
    const user = userEvent.setup();
    const onSet = vi.fn();
    render(<TuneCard subjects={[bloom({ tune: { sensitivity: 0.5 } }), cinder()]} onSet={onSet} />);
    reacts().focus();
    await user.keyboard('{ArrowRight}');
    expect(text(reacts())).toBe('2×');
    await waitFor(() => expect(onSet).toHaveBeenCalledWith([BLOOM.key, CINDER.key], { tune: { sensitivity: 2 } }));
    await user.click(screen.getByRole('button', { name: 'as made' }));
    expect(onSet).toHaveBeenLastCalledWith([BLOOM.key, CINDER.key], { clear_tune: true });
  });
});
