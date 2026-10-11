// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryRow, Look, Mine } from '../../api.ts';
import { prepareRow } from '../../librarySearch.ts';
import { TuneCard } from './Tune.tsx';

afterEach(cleanup);

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
    expect(text(reacts())).toBe('1×');
    await userEvent.click(screen.getByRole('button', { name: 'as made' }));
    expect(onSet).toHaveBeenLastCalledWith([BLOOM.key], { clear_tune: true });
    expect(text(speed())).toBe('1×');
    expect(screen.queryByRole('button', { name: 'as made' })).toBeNull();
  });

  it('nudges with Shift+arrows and sends once the slider rests, not every step', async () => {
    // A key a frame apart, as a held key repeats.
    const user = userEvent.setup({ delay: 40 });
    const onSet = vi.fn();
    render(<TuneCard subjects={[bloom()]} onSet={onSet} />);
    speed().focus();
    await user.keyboard('{Shift>}{ArrowLeft}{ArrowLeft}{ArrowLeft}{/Shift}');
    await waitFor(() => expect(text(speed())).toBe('0.84×'));
    // "as made" shows as soon as it differs, before it is sent.
    expect(screen.getByRole('button', { name: 'as made' })).toBeTruthy();
    await waitFor(() => expect(onSet).toHaveBeenCalled());
    expect(onSet).toHaveBeenCalledTimes(1);
    expect(onSet).toHaveBeenLastCalledWith([BLOOM.key], { tune: { speed: 0.841 } });
  });

  it('Home and End go to the ends, ¼× and 4×, and both sliders go out together', async () => {
    const user = userEvent.setup();
    const onSet = vi.fn();
    render(<TuneCard subjects={[bloom()]} onSet={onSet} />);
    speed().focus();
    await user.keyboard('{End}');
    reacts().focus();
    await user.keyboard('{Home}');
    await waitFor(() => expect(text(reacts())).toBe('¼×'));
    expect(text(speed())).toBe('4×');
    await waitFor(() => expect(onSet).toHaveBeenCalled());
    expect(onSet).toHaveBeenCalledTimes(1);
    expect(onSet).toHaveBeenLastCalledWith([BLOOM.key], { tune: { speed: 4, sensitivity: 0.25 } });
  });

  it('a step back onto the middle lands on exactly 1×, and is sent as 1 (which takes it off)', async () => {
    const user = userEvent.setup();
    const onSet = vi.fn();
    render(<TuneCard subjects={[bloom({ tune: { sensitivity: 1.059 } })]} onSet={onSet} />);
    reacts().focus();
    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(onSet).toHaveBeenCalled());
    expect(onSet).toHaveBeenLastCalledWith([BLOOM.key], { tune: { sensitivity: 1 } });
    expect(text(reacts())).toBe('1×');
  });

  it('a change still waiting is sent for its preset when the card goes', async () => {
    const user = userEvent.setup();
    const onSet = vi.fn();
    const { rerender } = render(<TuneCard key={BLOOM.key} subjects={[bloom()]} onSet={onSet} />);
    speed().focus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(text(speed())).toBe('2×'));
    expect(onSet).not.toHaveBeenCalled();
    rerender(<TuneCard key={CINDER.key} subjects={[cinder({ tune: { speed: 3 } })]} onSet={onSet} />);
    expect(onSet).toHaveBeenCalledWith([BLOOM.key], { tune: { speed: 2 } });
    expect(text(speed())).toBe('3.00×');
  });

  it('follows a change to what is kept made elsewhere', () => {
    const { rerender } = render(<TuneCard subjects={[bloom()]} onSet={vi.fn()} />);
    rerender(<TuneCard subjects={[bloom({ tune: { sensitivity: 2 } })]} onSet={vi.fn()} />);
    expect(text(reacts())).toBe('2×');
  });
});

describe("the inspector's tune for several presets, or none", () => {
  it('names the group for them, shows a shared value, and reads "Mixed" where they differ', () => {
    render(<TuneCard subjects={[bloom({ tune: { speed: 2 } }), cinder({ tune: { speed: 0.5 } })]} onSet={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'for these presets' })).toBeTruthy();
    expect(text(speed())).toBe('Mixed');
    expect(text(reacts())).toBe('1×');
    expect(document.querySelectorAll('.tune-slider-knob')).toHaveLength(1);
  });

  it('a move on a mixed slider sets it on all of them', async () => {
    const user = userEvent.setup();
    const onSet = vi.fn();
    render(<TuneCard subjects={[bloom({ tune: { speed: 2 } }), cinder({ tune: { speed: 0.5 } })]} onSet={onSet} />);
    speed().focus();
    await user.keyboard('{ArrowRight}');
    expect(text(speed())).toBe('2×');
    await waitFor(() => expect(onSet).toHaveBeenCalled());
    expect(onSet).toHaveBeenLastCalledWith([BLOOM.key, CINDER.key], { tune: { speed: 2 } });
  });

  it('"as made" shows when any differs from 1×, and clears them all', async () => {
    const onSet = vi.fn();
    render(<TuneCard subjects={[bloom(), cinder({ tune: { sensitivity: 3 } })]} onSet={onSet} />);
    await userEvent.click(screen.getByRole('button', { name: 'as made' }));
    expect(onSet).toHaveBeenLastCalledWith([BLOOM.key, CINDER.key], { clear_tune: true });
    expect(text(reacts())).toBe('1×');
  });

  it('with none stays in place, disabled, reading "–", and sends nothing', async () => {
    const user = userEvent.setup();
    const onSet = vi.fn();
    render(<TuneCard subjects={[]} onSet={onSet} />);
    expect(screen.getByRole('group', { name: 'for this preset' })).toBeTruthy();
    for (const s of [speed(), reacts()]) {
      expect(s.getAttribute('aria-disabled')).toBe('true');
      expect(text(s)).toBe('–');
    }
    expect(document.querySelector('.tune-slider-knob')).toBeNull();
    expect(screen.queryByRole('button', { name: 'as made' })).toBeNull();
    speed().focus();
    await user.keyboard('{End}');
    await new Promise((r) => setTimeout(r, 350));
    expect(onSet).not.toHaveBeenCalled();
  });
});
