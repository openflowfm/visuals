// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryRow, Level, Look } from '../../api.ts';
import { prepareRow } from '../../librarySearch.ts';
import { manual, type Item } from '../../playlists.ts';
import { Inspector, TOAST_FOR, type InspectorProps } from './Inspector.tsx';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const look = (speed: number, brightness: number, speed_level: Level = 'mid'): Look => ({ hues: [200], brightness, speed, intensity: 10, brightness_level: 'mid', speed_level, intensity_level: 'mid' });
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
// Along one row of brightness, slow to fast: Amber, Bloom (playing), Cinder (measured fast).
const AMBER = row('Amber', look(0.5, 0.5), ['geiss']);
const BLOOM = row('Bloom', look(2, 0.5));
const CINDER = row('Cinder', look(6, 0.5, 'high'));
const LIBRARY = [AMBER, BLOOM, CINDER, row('Undrawn', null)];
const item = (r: LibraryRow): Item => ({ path: r.path, name: r.title, group: '', missing: false, hash: null });
const SOURCE = <section aria-label="the playlist">Warm-up</section>;

function mount(over: Partial<InspectorProps> = {}) {
  const props: InspectorProps = {
    subject: prepareRow(BLOOM, { star: false, tags: ['warm'] }),
    playing: BLOOM.key,
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

/** Tab forward, as a keyboard user would, until `el` has focus (the field comes after the tags). */
async function tabTo(user: ReturnType<typeof userEvent.setup>, el: HTMLElement) {
  for (let i = 0; i < 20 && document.activeElement !== el; i++) await user.tab();
  expect(document.activeElement).toBe(el);
}

/** Whether `a` comes before `b` in the document. */
const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
const insp = () => document.querySelector('.insp')!;
/** The actions' accessible names, in order. */
const actions = () =>
  within(screen.getByRole('group', { name: /^on th/ }))
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label'));
const several = () => [prepareRow(AMBER, { star: true, tags: ['warm'] }), prepareRow(BLOOM, { star: false, hidden: true, tags: ['warm', 'intro'] }), prepareRow(CINDER, { star: false, tags: [] })];
const KEYS = [AMBER.key, BLOOM.key, CINDER.key];

describe('one skeleton in every state', () => {
  // header → identity → character → map → tune → playlists, each a direct section of the panel.
  const skeleton = (tune: 'for this preset' | 'for these presets' = 'for this preset') => {
    const parts = ['.insp-top', '.insp-id', '.insp-char', '.insp-map', '.insp-tune-slot', '.insp-lists'].map((s) => insp().querySelector(`:scope > ${s}`));
    for (const p of parts) expect(p).not.toBeNull();
    for (let i = 1; i < parts.length; i++) expect(before(parts[i - 1]!, parts[i]!)).toBe(true);
    const [top, id, char, map, slot, lists] = parts as Element[];
    expect(top.contains(screen.getByRole('group', { name: /^on th/ }))).toBe(true);
    expect(char).toBe(screen.getByRole('group', { name: /^about th/ }));
    expect(map.contains(screen.getByRole('listbox', { name: 'The library by speed and brightness' }))).toBe(true);
    expect(slot.contains(screen.getByRole('group', { name: tune }))).toBe(true);
    expect(lists).toBe(screen.getByRole('group', { name: 'In playlists' }));
    return { top, id, char, map, slot, lists };
  };

  it('the preset playing: name and artist with the style under them, then its character, map, tune and playlists', () => {
    mount({ subject: prepareRow(AMBER, { tags: ['warm'] }), playing: AMBER.key });
    const { id, char, lists } = skeleton();
    expect(insp().getAttribute('data-state')).toBe('playing');
    expect(within(id as HTMLElement).getByRole('heading', { level: 2, name: 'Amber' })).toBeTruthy();
    expect(id.textContent).toBe('AmbergeissHypnotic');
    expect(char.textContent).toContain('Speed');
    expect(char.contains(screen.getByRole('group', { name: 'my tags' }))).toBe(true);
    expect(lists.textContent).toBe('In playlistsNone yet');
  });

  it('one picked: the same order', () => {
    mount({ subject: prepareRow(CINDER, undefined), onPlay: vi.fn() });
    skeleton();
    expect(insp().getAttribute('data-state')).toBe('picked');
  });

  it('several picked: "n selected", their styles, the same order', () => {
    mount({ chosen: several() });
    const { id } = skeleton('for these presets');
    expect(within(id as HTMLElement).getByRole('heading', { level: 2, name: '3 selected' })).toBeTruthy();
    expect(id.querySelector('.insp-style')!.textContent).toBe('Hypnotic');
    expect(screen.getByRole('group', { name: 'about these presets' })).toBeTruthy();
  });

  it('nothing playing: says so with a prompt, the rest in place with dashes', () => {
    mount({ subject: null, playing: null });
    const { id, char, lists } = skeleton();
    expect(insp().getAttribute('data-state')).toBe('none');
    expect(within(id as HTMLElement).getByRole('heading', { name: 'Nothing playing yet' })).toBeTruthy();
    expect(id.querySelector('.insp-prompt')).not.toBeNull();
    expect([...char.querySelectorAll('dd')].map((d) => d.textContent)).toEqual(['–', '–', '–', '–', '–']);
    expect(lists.textContent).toBe('In playlists–');
  });

  it('the source: its card in the identity slot, the rest in place with dashes', () => {
    mount({ subject: null, source: SOURCE });
    const { id, char } = skeleton();
    expect(insp().getAttribute('data-state')).toBe('source');
    expect(id.contains(screen.getByRole('region', { name: 'the playlist' }))).toBe(true);
    expect(screen.queryByText(/nothing playing/i)).toBeNull();
    expect(char.getAttribute('aria-label')).toBe('about this preset');
    expect(char.querySelector('dd')!.textContent).toBe('–');
  });

  it('a preset shown wins over the source', () => {
    mount({ source: SOURCE });
    expect(screen.getByRole('heading', { name: 'Bloom' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'the playlist' })).toBeNull();
  });

  it('one in chosen is no selection: the subject shows', () => {
    mount({ chosen: [prepareRow(CINDER, undefined)] });
    expect(screen.getByRole('heading', { name: 'Bloom' })).toBeTruthy();
  });
});

describe('the character', () => {
  it('reads as caption-then-value rows of words, at full contrast, then my tags', () => {
    mount({ subject: prepareRow(AMBER, undefined), playing: AMBER.key });
    const rows = [...screen.getByRole('group', { name: 'about this preset' }).querySelectorAll('.insp-row')].map((r) => [r.querySelector('dt')!.textContent, r.querySelector('dd')!.textContent]);
    expect(rows.slice(0, 4)).toEqual([
      ['Speed', 'steady'],
      ['Brightness', 'dim'],
      ['Intensity', 'lively'],
      ['Colours', 'blue'],
    ]);
    expect(rows[4][0]).toBe('Tags');
  });

  it('several: the measures that agree said, those that differ Mixed, the colours over all', () => {
    mount({ chosen: [prepareRow(AMBER, undefined), prepareRow(CINDER, { overrides: { hues: [10] } })] });
    const values = [...screen.getByRole('group', { name: 'about these presets' }).querySelectorAll('dd')].map((d) => d.textContent);
    expect(values.slice(0, 4)).toEqual(['Mixed', 'dim', 'lively', 'blue and red']);
  });

  it('a preset not drawn yet: dashes, and says so where its colours would be', () => {
    mount({ subject: prepareRow(row('Undrawn', null), undefined), playing: null });
    const values = [...screen.getByRole('group', { name: 'about this preset' }).querySelectorAll('dd')].map((d) => d.textContent);
    expect(values.slice(0, 4)).toEqual(['–', '–', '–', 'Not drawn yet']);
  });

  it('edits my tags with the tag editor', async () => {
    const p = mount();
    await userEvent.click(screen.getByRole('button', { name: '+ Tag' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'add tags' }), 'intro{Enter}');
    expect(p.onSet).toHaveBeenLastCalledWith([BLOOM.key], { add_tags: ['intro'] });
    await userEvent.click(screen.getByRole('button', { name: 'take the tag warm off' }));
    expect(p.onSet).toHaveBeenLastCalledWith([BLOOM.key], { remove_tags: ['warm'] });
  });
});

describe('the actions in the header', () => {
  it('the preset playing: star, add, edit, then never play apart; no Play or back; glyphs with tooltips', () => {
    mount({ onEdit: vi.fn() });
    expect(actions()).toEqual(['star', 'add to a playlist', 'open in the editor', 'never play']);
    for (const n of ['star', 'add to a playlist', 'never play', 'open in the editor']) {
      const b = screen.getByRole('button', { name: n });
      expect(b.textContent).toBe('');
      expect(b.closest('[title]')).not.toBeNull();
    }
    expect(screen.getByRole('button', { name: 'never play' }).classList.contains('insp-key-never')).toBe(true);
    expect(screen.queryByRole('button', { name: 'play it' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'back to now playing' })).toBeNull();
    expect(screen.queryByText(/Now playing/)).toBeNull();
  });

  it('one picked: back at the far left, Play first and tinted, and both work', async () => {
    const p = mount({ subject: prepareRow(CINDER, undefined), onPlay: vi.fn(), onClose: vi.fn() });
    expect(actions()).toEqual(['play it', 'star', 'add to a playlist', 'never play']);
    const top = insp().querySelector('.insp-top')!;
    expect(top.firstElementChild).toBe(screen.getByRole('button', { name: 'back to now playing' }));
    expect(top.lastElementChild).toBe(screen.getByRole('button', { name: 'close info' }));
    expect(screen.getByRole('button', { name: 'play it' }).classList.contains('insp-key-play')).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'back to now playing' }));
    expect(p.onBack).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'play it' }));
    expect(p.onPlay).toHaveBeenCalled();
  });

  it('nothing playing and the source: the same set, disabled, not removed', () => {
    for (const over of [
      { subject: null, playing: null },
      { subject: null, source: SOURCE },
    ]) {
      const p = mount({ ...over, onEdit: vi.fn() });
      expect(actions()).toEqual(['star', 'add to a playlist', 'open in the editor', 'never play']);
      for (const n of ['star', 'add to a playlist', 'open in the editor', 'never play']) expect((screen.getByRole('button', { name: n }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'star' }));
      expect(p.onSet).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it('several: the same set, edit disabled', () => {
    mount({ chosen: several(), onEdit: vi.fn() });
    expect(actions()).toEqual(['star', 'add to a playlist', 'open in the editor', 'never play']);
    expect((screen.getByRole('button', { name: 'open in the editor' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'star' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('star toggles on the subject; never play on shows "Never" beside its glyph', async () => {
    const p = mount();
    const star = screen.getByRole('button', { name: 'star' });
    expect(star.getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(star);
    expect(p.onSet).toHaveBeenLastCalledWith([BLOOM.key], { star: true });
    expect(screen.getByRole('button', { name: 'never play' }).textContent).toBe('');
    cleanup();
    mount({ subject: prepareRow(BLOOM, { star: true, hidden: true }) });
    expect(screen.getByRole('button', { name: 'star' }).getAttribute('aria-pressed')).toBe('true');
    const never = screen.getByRole('button', { name: 'never play' });
    expect(never.getAttribute('aria-pressed')).toBe('true');
    expect(never.textContent).toBe('Never');
  });

  it('several: star and never play are mixed over some, and turn on for all of them', async () => {
    const p = mount({ chosen: several() });
    const star = screen.getByRole('button', { name: 'star' });
    expect(star.getAttribute('aria-pressed')).toBe('mixed');
    await userEvent.click(star);
    expect(p.onSet).toHaveBeenLastCalledWith(KEYS, { star: true });
    const never = screen.getByRole('button', { name: 'never play' });
    expect(never.getAttribute('aria-pressed')).toBe('mixed');
    await userEvent.click(never);
    expect(p.onSet).toHaveBeenLastCalledWith(KEYS, { hidden: true });
  });

  it('star takes the star off all of them when every one has it', async () => {
    const p = mount({ chosen: several().map((x) => ({ ...x, star: true })) });
    expect(screen.getByRole('button', { name: 'star' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'star' }));
    expect(p.onSet).toHaveBeenLastCalledWith(KEYS, { star: false });
  });

  it('adds all of them to a manual playlist', async () => {
    const p = mount({ chosen: several(), playlists: [manual('w', 'Warm-up', []), { ...manual('s', 'Fast', []), kind: 'smart' as const }] });
    await userEvent.click(screen.getByRole('button', { name: 'add to a playlist' }));
    expect(screen.queryByRole('menuitem', { name: 'Fast' })).toBeNull();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Warm-up' }));
    expect(p.onAddTo).toHaveBeenCalledWith('w', [AMBER.path, BLOOM.path, CINDER.path]);
  });
});

describe("never play's undo", () => {
  const toast = () => screen.queryByRole('status');

  it('turns never play on at once, with a toast under the header whose Undo puts back exactly what was there', () => {
    const p = mount({ chosen: several() });
    expect(toast()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'never play' }));
    expect(p.onSet).toHaveBeenLastCalledWith(KEYS, { hidden: true });
    const t = toast()!;
    expect(t.textContent).toContain('Won’t play them on their own');
    // Just under the header, not at the panel's foot.
    expect(insp().querySelector(':scope > .insp-top')!.nextElementSibling!.contains(t)).toBe(true);
    fireEvent.click(within(t).getByRole('button', { name: 'Undo' }));
    // Bloom was already never played: it stays so.
    expect(p.onSet).toHaveBeenLastCalledWith([AMBER.key, CINDER.key], { hidden: false });
    expect(toast()).toBeNull();
  });

  it('turning it off shows no toast', () => {
    mount({ subject: prepareRow(BLOOM, { hidden: true }) });
    fireEvent.click(screen.getByRole('button', { name: 'never play' }));
    expect(toast()).toBeNull();
  });

  it('hides by itself after a few seconds', () => {
    vi.useFakeTimers();
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'never play' }));
    expect(toast()!.textContent).toContain('Won’t play it on its own');
    act(() => vi.advanceTimersByTime(TOAST_FOR - 100));
    expect(toast()).not.toBeNull();
    act(() => vi.advanceTimersByTime(200));
    expect(toast()).toBeNull();
  });

  it('Escape dismisses the toast, not the inspector; the next Escape closes it', () => {
    const p = mount({ onClose: vi.fn() });
    fireEvent.click(screen.getByRole('button', { name: 'never play' }));
    fireEvent.keyDown(within(toast()!).getByRole('button', { name: 'Undo' }), { key: 'Escape' });
    expect(toast()).toBeNull();
    expect(p.onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'never play' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(toast()).toBeNull();
    expect(p.onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('the map', () => {
  it('the field is one stop: the arrows move among the dots, named, and Enter picks one', async () => {
    const user = userEvent.setup();
    const p = mount();
    const field = screen.getByRole('listbox', { name: 'The library by speed and brightness' });
    await tabTo(user, field);
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
    await tabTo(user, screen.getByRole('listbox'));
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('option', { name: 'Bloom, playing' })).toBeTruthy();
    await user.keyboard('{Enter}');
    expect(p.onBack).toHaveBeenCalled();
    expect(p.onPick).not.toHaveBeenCalled();
  });

  it('picking the dot playing while it is shown does nothing', async () => {
    const user = userEvent.setup();
    const p = mount();
    await tabTo(user, screen.getByRole('listbox'));
    await user.keyboard('{Enter}');
    expect(p.onBack).not.toHaveBeenCalled();
    expect(p.onPick).not.toHaveBeenCalled();
  });

  it('several picked: every pick ringed, none lit', () => {
    mount({ chosen: several() });
    const marks = document.querySelector('.insp-field-marked')!;
    expect(marks.getAttribute('d')!.match(/M/g)!.length).toBe(3);
    expect(document.querySelector('.insp-field-lit')).toBeNull();
    expect(screen.getByText(/3 picked, each ringed/)).toBeTruthy();
  });

  it('one shown: lit, no rings', () => {
    mount();
    expect(document.querySelector('.insp-field-lit')).not.toBeNull();
    expect(document.querySelector('.insp-field-marked')).toBeNull();
  });

  it('nothing playing: unmarked, the prompt said, the library counted truly', () => {
    mount({ subject: null, playing: null });
    expect(document.querySelector('.insp-field-lit')).toBeNull();
    expect(document.querySelector('.insp-field-marked')).toBeNull();
    // Three of the four drawn: the library's real count, never the measured three as if they were all of it.
    expect(screen.getByText(/The library by speed and brightness: 3 of its 4 presets drawn so far\. Pick one to see it here/)).toBeTruthy();
  });
});

describe('the playlists', () => {
  const lists = () => screen.getByRole('group', { name: 'In playlists' });

  it('one: the playlists holding it, quiet lines', () => {
    mount({ playlists: [manual('w', 'Warm-up', [item(BLOOM)]), manual('x', 'Other', [item(AMBER)])] });
    expect(
      within(lists())
        .getAllByRole('listitem')
        .map((l) => l.textContent),
    ).toEqual(['Warm-up']);
  });

  it('several: the union, with counts where only some are in it', () => {
    mount({
      chosen: several(),
      playlists: [manual('w', 'Warm-up', [item(AMBER), item(BLOOM)]), manual('a', 'All', [item(AMBER), item(BLOOM), item(CINDER)]), manual('f', 'Fast', [item(CINDER)]), manual('n', 'None', [])],
    });
    expect(
      within(lists())
        .getAllByRole('listitem')
        .map((l) => l.textContent),
    ).toEqual(['Warm-up (2 of 3)', 'All', 'Fast (1 of 3)']);
  });

  it('a long tail goes behind "+n more", which expands', async () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F'];
    mount({ playlists: names.map((n) => manual(n, n, [item(BLOOM)])) });
    expect(
      within(lists())
        .getAllByRole('listitem')
        .map((l) => l.textContent),
    ).toEqual(['A', 'B', 'C']);
    const more = within(lists()).getByRole('button', { name: '+3 more' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(more);
    expect(within(lists()).getAllByRole('listitem')).toHaveLength(6);
    expect(within(lists()).getByRole('button', { name: 'Fewer' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('a tail of one shows whole', () => {
    mount({ playlists: ['A', 'B', 'C', 'D'].map((n) => manual(n, n, [item(BLOOM)])) });
    expect(within(lists()).getAllByRole('listitem')).toHaveLength(4);
    expect(within(lists()).queryByRole('button')).toBeNull();
  });
});

describe('closing and errors', () => {
  it('says what failed in an alert line, in every state', () => {
    mount({ error: 'Couldn’t star it: the disk is full' });
    expect(screen.getByRole('alert').textContent).toBe('Couldn’t star it: the disk is full');
    cleanup();
    mount({ subject: null, playing: null, error: 'Couldn’t read the library' });
    expect(screen.getByRole('alert').textContent).toBe('Couldn’t read the library');
    cleanup();
    mount({ chosen: several(), error: 'Couldn’t tag them' });
    expect(screen.getByRole('alert').textContent).toBe('Couldn’t tag them');
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
    await user.keyboard('{Escape}');
    expect(screen.getByRole('heading', { name: 'Bloom' })).toBeTruthy();
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
});
