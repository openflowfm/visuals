// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { install } from '../fixtures/backend';
import { LISTS, PLAYING_DECK, WARM_UP } from '../fixtures/fixtures';
import { INSPECTOR_LABEL } from '../HomeLayout/HomeLayout';
import { Home } from './Home';

/** The field in the inspector's library map: the listbox its dots are reached by from the keyboard. */
const fieldOf = (panel: HTMLElement) => within(panel).getByRole('listbox', { name: 'The library by speed and brightness' });
const panelOf = () => screen.getByRole('complementary', { name: INSPECTOR_LABEL });
/** The inspector's name for what it is about. */
const shownName = (panel: HTMLElement) => within(panel).getByRole('heading', { level: 2 }).textContent ?? '';
/** What the transport bar says plays. */
const transportName = () => document.querySelector('.vs-transport-now')?.textContent ?? '';

/** Moves the field's keyboard cursor one dot `key`-wards and presses Enter on it: the dot it played, by name. */
function playNext(panel: HTMLElement, key: string): string {
  const field = fieldOf(panel);
  fireEvent.keyDown(field, { key });
  const option = within(field).getByRole('option');
  // The option says "Name, by Authors, at 0.5× speed, playing": the name is what comes before those.
  const name = (option.textContent ?? '').split(', by ')[0].split(', at ')[0];
  fireEvent.keyDown(field, { key: 'Enter' });
  return name;
}

let undo: () => void;
beforeEach(() => {
  // A window wide enough for the inspector to dock beside the column.
  Object.assign(window, { innerWidth: 1600, innerHeight: 1000 });
  // A fresh page's storage (Node's own `localStorage` stands in for jsdom's, and is undefined without a file).
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  });
  undo = install({ lists: LISTS, resume: { playlist: WARM_UP.id, index: PLAYING_DECK.index, current: PLAYING_DECK.current, source: null } });
});
afterEach(() => {
  cleanup();
  undo();
  vi.unstubAllGlobals();
});

describe('the field in the Home', () => {
  it('plays a dot at once, and the inspector, the field and the transport follow what plays', async () => {
    render(<Home start={null} onMode={() => {}} />);
    const panel = await waitFor(panelOf);
    const first = await waitFor(() => {
      const n = shownName(panel);
      expect(n).not.toBe('');
      expect(transportName()).toContain(n);
      return n;
    });
    const field = fieldOf(panel);
    act(() => field.focus());

    // A dot played: no "picked but not playing" state in between.
    const a = playNext(panel, 'ArrowRight');
    await waitFor(() => expect(shownName(panel)).toBe(a));
    expect(a).not.toBe(first);
    await waitFor(() => expect(transportName()).toContain(a));
    expect(within(panel).queryByRole('button', { name: 'back to now playing' })).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'play it' })).toBeNull();
    // The map lights one dot, the one playing.
    expect(panel.querySelectorAll('.vs-field-lit')).toHaveLength(1);

    // Another dot: the same again.
    const b = playNext(panel, 'ArrowUp');
    await waitFor(() => expect(shownName(panel)).toBe(b));
    await waitFor(() => expect(transportName()).toContain(b));
    expect(within(panel).queryByRole('button', { name: 'back to now playing' })).toBeNull();
    expect(panel.querySelectorAll('.vs-field-lit')).toHaveLength(1);

    // The deck moving on by itself (next): the inspector follows it, not the dot played before.
    fireEvent.click(screen.getByRole('button', { name: 'next preset' }));
    await waitFor(() => expect(transportName()).not.toContain(b));
    const now = transportName();
    await waitFor(() => expect(now).toContain(shownName(panel)));
    expect(within(panel).queryByRole('button', { name: 'back to now playing' })).toBeNull();
    expect(panel.querySelectorAll('.vs-field-lit')).toHaveLength(1);
  });
});

describe("the library's Map view", () => {
  const viewSwitch = () => screen.getByRole('radiogroup', { name: 'Show the library as' });
  const warmUpGrid = `${WARM_UP.name}, in the order it plays`;
  const warmUpMap = `${WARM_UP.name} by speed and brightness`;

  it("swaps the room's grid for the map, the inspector's map goes, and Grid puts both back", async () => {
    render(<Home start={null} onMode={() => {}} />);
    const panel = await waitFor(panelOf);
    // Warm-up plays, so its grid is the room; the inspector has its map.
    await screen.findByRole('list', { name: warmUpGrid });
    expect(fieldOf(panel)).toBeTruthy();

    fireEvent.click(within(viewSwitch()).getByRole('radio', { name: 'Map' }));
    const room = await screen.findByRole('listbox', { name: warmUpMap });
    expect(panel.contains(room)).toBe(false);
    expect(within(panel).queryByRole('listbox')).toBeNull();
    expect(screen.queryByRole('list', { name: warmUpGrid })).toBeNull();
    expect(localStorage.getItem('visuals.library.view')).toBe('map');

    // A dot played from the room: the transport follows it.
    act(() => room.focus());
    fireEvent.keyDown(room, { key: 'ArrowRight' });
    const name = (within(room).getByRole('option').textContent ?? '').split(', by ')[0].split(', at ')[0];
    fireEvent.keyDown(room, { key: 'Enter' });
    await waitFor(() => expect(transportName()).toContain(name));

    fireEvent.click(within(viewSwitch()).getByRole('radio', { name: 'Grid' }));
    await screen.findByRole('list', { name: warmUpGrid });
    expect(fieldOf(panel)).toBeTruthy();
    expect(localStorage.getItem('visuals.library.view')).toBe('grid');
  });

  it('opens on the view chosen last', async () => {
    localStorage.setItem('visuals.library.view', 'map');
    render(<Home start={null} onMode={() => {}} />);
    expect(await screen.findByRole('listbox', { name: warmUpMap })).toBeTruthy();
    expect(within(await waitFor(panelOf)).queryByRole('listbox')).toBeNull();
  });
});
