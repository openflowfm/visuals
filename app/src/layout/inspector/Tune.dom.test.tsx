// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryRow, Look, Mine } from '../../api.ts';
import { prepareRow } from '../../librarySearch.ts';
import { Inspector, type InspectorProps } from './Inspector.tsx';

afterEach(cleanup);

const look: Look = { hues: [200], brightness: 0.5, speed: 2, intensity: 10, brightness_level: 'mid', speed_level: 'mid', intensity_level: 'mid' };
const row = (key: string): LibraryRow => ({ key, path: `/p/${key}.milk`, hash: '', style: 'Hypnotic', sub_style: null, authors: [], title: key, thumbnail: null, look, starter: true });
const BLOOM = row('Bloom');
const CINDER = row('Cinder');

function props(mine: Mine | undefined, over: Partial<InspectorProps> = {}): InspectorProps {
  return {
    subject: prepareRow(BLOOM, mine),
    playing: BLOOM.key,
    from: '',
    playlists: [],
    library: [BLOOM, CINDER],
    onSet: vi.fn(),
    onAddTo: vi.fn(),
    onPick: vi.fn(),
    onBack: vi.fn(),
    ...over,
  };
}

const speed = () => screen.getByRole('slider', { name: 'speed' });
const reacts = () => screen.getByRole('slider', { name: 'how much it reacts' });

describe("the inspector's tune for one preset", () => {
  it('shows speed and how much it reacts at 1×, under "for this preset", with no reset', () => {
    render(<Inspector {...props(undefined)} />);
    expect(screen.getByRole('group', { name: 'for this preset' })).toBeTruthy();
    expect(speed().getAttribute('aria-valuetext')).toBe('1×');
    expect(reacts().getAttribute('aria-valuetext')).toBe('1×');
    expect(screen.queryByRole('button', { name: 'as made' })).toBeNull();
  });

  it('shows what is kept, and "as made" sends the reset', async () => {
    const p = props({ tune: { speed: 0.5 } });
    render(<Inspector {...p} />);
    expect(speed().getAttribute('aria-valuetext')).toBe('0.5×');
    expect(reacts().getAttribute('aria-valuetext')).toBe('1×');
    await userEvent.click(screen.getByRole('button', { name: 'as made' }));
    expect(p.onSet).toHaveBeenLastCalledWith([BLOOM.key], { clear_tune: true });
    expect(speed().getAttribute('aria-valuetext')).toBe('1×');
    expect(screen.queryByRole('button', { name: 'as made' })).toBeNull();
  });

  it('steps with the arrow keys and sends once the slider rests, not every step', async () => {
    // A key a frame apart, as a held key repeats: the slider takes each value back before the next step.
    const user = userEvent.setup({ delay: 40 });
    const p = props(undefined);
    render(<Inspector {...p} />);
    speed().focus();
    await user.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}');
    await waitFor(() => expect(speed().getAttribute('aria-valuetext')).toBe('0.84×'));
    // "as made" shows as soon as it differs, before it is sent.
    expect(screen.getByRole('button', { name: 'as made' })).toBeTruthy();
    await waitFor(() => expect(p.onSet).toHaveBeenCalled());
    expect(p.onSet).toHaveBeenCalledTimes(1);
    expect(p.onSet).toHaveBeenLastCalledWith([BLOOM.key], { tune: { speed: 0.841 } });
  });

  it('Home and End go to the ends, ¼× and 4×, and both sliders go out together', async () => {
    const user = userEvent.setup();
    const p = props(undefined);
    render(<Inspector {...p} />);
    speed().focus();
    await user.keyboard('{End}');
    reacts().focus();
    await user.keyboard('{Home}');
    await waitFor(() => expect(reacts().getAttribute('aria-valuetext')).toBe('0.25×'));
    expect(speed().getAttribute('aria-valuetext')).toBe('4×');
    await waitFor(() => expect(p.onSet).toHaveBeenCalled());
    expect(p.onSet).toHaveBeenCalledTimes(1);
    expect(p.onSet).toHaveBeenLastCalledWith([BLOOM.key], { tune: { speed: 4, sensitivity: 0.25 } });
  });

  it('a step back onto the middle lands on exactly 1×, and is sent as 1 (which takes it off)', async () => {
    const user = userEvent.setup();
    const p = props({ tune: { sensitivity: 1.059 } });
    render(<Inspector {...p} />);
    reacts().focus();
    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(p.onSet).toHaveBeenCalled());
    expect(p.onSet).toHaveBeenLastCalledWith([BLOOM.key], { tune: { sensitivity: 1 } });
    expect(reacts().getAttribute('aria-valuetext')).toBe('1×');
  });

  it('a change still waiting is sent for its preset when another is shown', async () => {
    const user = userEvent.setup();
    const p = props(undefined);
    const { rerender } = render(<Inspector {...p} />);
    speed().focus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(speed().getAttribute('aria-valuetext')).toBe('1.1×'));
    expect(p.onSet).not.toHaveBeenCalled();
    rerender(<Inspector {...p} subject={prepareRow(CINDER, { tune: { speed: 2 } })} />);
    expect(p.onSet).toHaveBeenCalledWith([BLOOM.key], { tune: { speed: 1.059 } });
    expect(speed().getAttribute('aria-valuetext')).toBe('2×');
  });

  it('follows a change to what is kept made elsewhere', () => {
    const p = props(undefined);
    const { rerender } = render(<Inspector {...p} />);
    rerender(<Inspector {...p} subject={prepareRow(BLOOM, { tune: { sensitivity: 3 } })} />);
    expect(reacts().getAttribute('aria-valuetext')).toBe('3×');
  });

  it('shows none for several picked together', () => {
    render(<Inspector {...props(undefined, { chosen: [prepareRow(BLOOM, undefined), prepareRow(CINDER, undefined)] })} />);
    expect(screen.queryByRole('group', { name: 'for this preset' })).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
  });
});
