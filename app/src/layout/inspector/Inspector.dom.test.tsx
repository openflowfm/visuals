// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryRow, Look } from '../../api.ts';
import { prepareRow } from '../../librarySearch.ts';
import { manual } from '../../playlists.ts';
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

  it('edits my tags with the tag editor', async () => {
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

  it('picking the dot playing while it is shown does nothing', async () => {
    const user = userEvent.setup();
    const p = mount();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('listbox'));
    await user.keyboard('{Enter}');
    expect(p.onBack).not.toHaveBeenCalled();
    expect(p.onPick).not.toHaveBeenCalled();
  });

  it('with nothing picked and a source passed, shows the source in place of the field', () => {
    mount({ subject: null, source: <section aria-label="the playlist">Warm-up</section> });
    expect(screen.getByRole('region', { name: 'the playlist' })).toBeTruthy();
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.queryByText(/nothing playing/i)).toBeNull();
  });

  it('a preset shown wins over the source', () => {
    mount({ source: <section aria-label="the playlist">Warm-up</section> });
    expect(screen.getByRole('heading', { name: 'Bloom' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'the playlist' })).toBeNull();
  });

  it('says what failed in an alert line, in every view', () => {
    mount({ error: 'Couldn’t star it: the disk is full' });
    expect(screen.getByRole('alert').textContent).toBe('Couldn’t star it: the disk is full');
    cleanup();
    mount({ subject: null, playing: null, error: 'Couldn’t read the library' });
    expect(screen.getByRole('alert').textContent).toBe('Couldn’t read the library');
    cleanup();
    mount({ error: null });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('with onClose, ✕ and Escape close it; without, neither does', async () => {
    const user = userEvent.setup();
    const p = mount({ onClose: vi.fn() });
    await user.click(screen.getByRole('button', { name: 'close info' }));
    expect(p.onClose).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    expect(p.onClose).toHaveBeenCalledTimes(2);
    cleanup();
    mount();
    expect(screen.queryByRole('button', { name: 'close info' })).toBeNull();
  });

  it('Escape in the tag box or an open menu closes that, not the inspector', async () => {
    const user = userEvent.setup();
    const p = mount({ onClose: vi.fn() });
    await user.click(screen.getByRole('button', { name: '+ Tag' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'add tags' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'add to a playlist' }));
    expect(screen.getByRole('menu', { name: 'add to a playlist' })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(p.onClose).not.toHaveBeenCalled();
  });

  it('with no onClose, Escape does nothing', async () => {
    const user = userEvent.setup();
    mount();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('heading', { name: 'Bloom' })).toBeTruthy();
  });

  it('with nothing playing, says so and offers no action, the field still drawn', () => {
    mount({ subject: null, playing: null });
    expect(screen.getByText(/nothing playing/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'star' })).toBeNull();
    expect(screen.getByRole('listbox', { name: 'The library by speed and brightness' })).toBeTruthy();
    // Three of the four drawn: the library's real count, never the measured three as if they were all of it.
    expect(screen.getByText(/The library by speed and brightness: 3 of its 4 presets drawn so far/)).toBeTruthy();
  });
});

describe('the inspector over several picked', () => {
  // Amber starred and tagged "warm", Bloom tagged "warm" and "intro", Cinder neither.
  const several = () => [prepareRow(AMBER, { star: true, tags: ['warm'] }), prepareRow(BLOOM, { star: false, hidden: true, tags: ['warm', 'intro'] }), prepareRow(CINDER, { star: false, tags: [] })];
  const keys = [AMBER.key, BLOOM.key, CINDER.key];
  const LISTS = [manual('w', 'Warm-up', []), { ...manual('s', 'Fast', []), kind: 'smart' as const }];

  it('says how many and their styles, with no field and no single preset', () => {
    mount({ chosen: several() });
    expect(screen.getByRole('heading', { name: '3 selected' })).toBeTruthy();
    expect(screen.getByText('Hypnotic')).toBeTruthy();
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Bloom' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'play it' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'open in the editor' })).toBeNull();
  });

  it('one in chosen is no selection: the subject shows', () => {
    mount({ chosen: [prepareRow(CINDER, undefined)] });
    expect(screen.getByRole('heading', { name: 'Bloom' })).toBeTruthy();
  });

  it('star and never play are mixed over some, and turn on for all of them', async () => {
    const p = mount({ chosen: several() });
    const star = screen.getByRole('button', { name: 'star' });
    expect(star.getAttribute('aria-pressed')).toBe('mixed');
    await userEvent.click(star);
    expect(p.onSet).toHaveBeenLastCalledWith(keys, { star: true });
    const never = screen.getByRole('button', { name: 'never play' });
    expect(never.getAttribute('aria-pressed')).toBe('mixed');
    await userEvent.click(never);
    expect(p.onSet).toHaveBeenLastCalledWith(keys, { hidden: true });
  });

  it('star takes the star off all of them when every one has it', async () => {
    const all = several().map((x) => ({ ...x, star: true }));
    const p = mount({ chosen: all });
    expect(screen.getByRole('button', { name: 'star' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'star' }));
    expect(p.onSet).toHaveBeenLastCalledWith(keys, { star: false });
  });

  it('adds all of them to a manual playlist', async () => {
    const p = mount({ chosen: several(), playlists: LISTS });
    await userEvent.click(screen.getByRole('button', { name: 'add to a playlist' }));
    expect(screen.queryByRole('menuitem', { name: 'Fast' })).toBeNull();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Warm-up' }));
    expect(p.onAddTo).toHaveBeenCalledWith('w', [AMBER.path, BLOOM.path, CINDER.path]);
  });

  it('edits the tags on all of them, a tag on some showing its count', async () => {
    const p = mount({ chosen: several() });
    const tags = screen.getByRole('group', { name: 'my tags' });
    expect(tags.textContent).toContain('warm2');
    await userEvent.click(screen.getByRole('button', { name: '+ Tag' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'add tags' }), 'peak{Enter}');
    expect(p.onSet).toHaveBeenLastCalledWith(keys, { add_tags: ['peak'] });
    await userEvent.click(screen.getByRole('button', { name: 'take the tag intro off (on 1 of 3)' }));
    expect(p.onSet).toHaveBeenLastCalledWith(keys, { remove_tags: ['intro'] });
  });

  it('keeps the close and the error line', async () => {
    const p = mount({ chosen: several(), onClose: vi.fn(), error: 'Couldn’t tag them' });
    expect(screen.getByRole('alert').textContent).toBe('Couldn’t tag them');
    await userEvent.click(screen.getByRole('button', { name: 'close info' }));
    expect(p.onClose).toHaveBeenCalled();
  });
});
