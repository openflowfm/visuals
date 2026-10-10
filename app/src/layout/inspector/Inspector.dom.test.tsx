// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryRow, Look } from '../../api.ts';
import { prepareRow } from '../../librarySearch.ts';
import { Inspector, type InspectorProps } from './Inspector.tsx';

afterEach(cleanup);

const look = (speed: number, brightness: number): Look => ({ hues: [200], brightness, speed, intensity: 10, brightness_level: 'mid', speed_level: 'mid', intensity_level: 'mid' });
const row = (key: string, l: Look | null, authors: string[] = []): LibraryRow => ({
  key,
  path: `/p/${key}.milk`,
  hash: '',
  style: 'Hypnotic',
  sub_style: null,
  authors,
  title: key,
  thumbnail: null,
  look: l,
  starter: true,
});
// Along one row of brightness, slow to fast: Amber, Bloom (playing), Cinder.
const AMBER = row('Amber', look(0.5, 0.5), ['geiss']);
const BLOOM = row('Bloom', look(2, 0.5));
const CINDER = row('Cinder', look(6, 0.5));
const LIBRARY = [AMBER, BLOOM, CINDER, row('Undrawn', null)];

function mount(over: Partial<InspectorProps> = {}) {
  const props: InspectorProps = {
    subject: prepareRow(BLOOM, { star: false, tags: ['warm'] }),
    playing: BLOOM.key,
    from: 'from Warm-up',
    playlists: [],
    library: LIBRARY,
    onSet: vi.fn(),
    onAddTo: vi.fn(),
    onPick: vi.fn(),
    onBack: vi.fn(),
    ...over,
  };
  render(<Inspector {...props} />);
  return props;
}

describe('the inspector in a DOM', () => {
  it('shows the preset playing with where it plays from, and no way back', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Bloom' })).toBeTruthy();
    expect(screen.getByText(/^Now playing/)).toBeTruthy();
    expect(screen.getByText('from Warm-up')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'back to now playing' })).toBeNull();
  });

  it('shows one picked with back and Play, not where the playing one plays from', async () => {
    const p = mount({ subject: prepareRow(CINDER, undefined), onPlay: vi.fn() });
    expect(screen.getByText(/^Picked/)).toBeTruthy();
    expect(screen.queryByText('from Warm-up')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'back to now playing' }));
    expect(p.onBack).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'play it' }));
    expect(p.onPlay).toHaveBeenCalled();
  });

  it('star and never play toggle on the subject', async () => {
    const p = mount();
    const star = screen.getByRole('button', { name: 'star' });
    expect(star.getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(star);
    expect(p.onSet).toHaveBeenLastCalledWith([BLOOM.key], { star: true });
    await userEvent.click(screen.getByRole('button', { name: 'never play' }));
    expect(p.onSet).toHaveBeenLastCalledWith([BLOOM.key], { hidden: true });
  });

  it("edits my tags with NowPanel's tag editor", async () => {
    const p = mount();
    await userEvent.click(screen.getByRole('button', { name: '+ Tag' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'add tags' }), 'intro{Enter}');
    expect(p.onSet).toHaveBeenLastCalledWith([BLOOM.key], { add_tags: ['intro'] });
    await userEvent.click(screen.getByRole('button', { name: 'take the tag warm off' }));
    expect(p.onSet).toHaveBeenLastCalledWith([BLOOM.key], { remove_tags: ['warm'] });
  });

  it('the field is one stop: the arrows move among the dots, named, and Enter picks one', async () => {
    const user = userEvent.setup();
    const p = mount();
    const field = screen.getByRole('listbox', { name: 'The library by speed and brightness' });
    await user.tab();
    expect(document.activeElement).toBe(field);
    // Focus from the keyboard puts the cursor on the subject; the arrows move it.
    expect(screen.getByRole('option', { name: 'Bloom, playing' }).getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{ArrowRight}');
    expect(field.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: 'Cinder' }).id);
    await user.keyboard('{Enter}');
    expect(p.onPick).toHaveBeenLastCalledWith(CINDER);
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('option', { name: 'Amber, by geiss' })).toBeTruthy();
    await user.keyboard(' ');
    expect(p.onPick).toHaveBeenLastCalledWith(AMBER);
  });

  it('picking the dot playing goes back to it', async () => {
    const user = userEvent.setup();
    const p = mount({ subject: prepareRow(CINDER, undefined) });
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('listbox'));
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('option', { name: 'Bloom, playing' })).toBeTruthy();
    await user.keyboard('{Enter}');
    expect(p.onBack).toHaveBeenCalled();
    expect(p.onPick).not.toHaveBeenCalled();
  });

  it('with nothing playing, says so and offers no action, the field still drawn', () => {
    mount({ subject: null, playing: null });
    expect(screen.getByText(/nothing playing/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'star' })).toBeNull();
    expect(screen.getByRole('listbox', { name: 'The library by speed and brightness' })).toBeTruthy();
    expect(screen.getByText(/The library: 3 presets by speed and brightness/)).toBeTruthy();
  });
});
