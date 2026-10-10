// @vitest-environment happy-dom
//
// The home's inset sidebar mounted in a DOM: its order (the library, starred and
// recently played, then the playlists, then the smart playlists), its counts,
// picking and playing rows, making and adding a playlist, drop targets while a
// preset is dragged, the empty sections' hints, and a row's menu (play, rename,
// save to a file, delete) from the pointer and the keyboard.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pane } from '../home.ts';
import { drags, type DragHandlers, type Payload } from '../drag.ts';
import { DEFAULT_SETTINGS, EMPTY_DECK, manual, type Lists, type Playlist } from '../playlists.ts';
import type { SidebarActions } from './home-model.ts';
import { InsetSidebar, sidebarSections } from './InsetSidebar.tsx';

vi.mock('@tauri-apps/api/core', () => ({ invoke: () => Promise.resolve(null), convertFileSrc: (p: string) => p }));
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => {}) }));

const item = (k: string) => ({ path: `/p/${k}.milk`, name: k, group: 'A', missing: false, hash: k });
const smart = (id: string, name: string, recent?: number): Playlist => ({
  id,
  name,
  items: [],
  kind: 'smart',
  query: { groups: {}, text: '', ...(recent === undefined ? {} : { recent }) },
  settings: DEFAULT_SETTINGS,
});

const chill = manual('chill', 'Chill', [item('a'), item('b')]);
const warm = manual('warm', 'Warm up', []);
const calm = smart('calm', 'Calm');
const recent = smart('recent', 'Recently played', 50);
const lists: Lists = { playlists: [chill, calm, recent, warm], deck: EMPTY_DECK };

function fakeActions() {
  return {
    onPlay: vi.fn<(id: string) => void>(),
    onStop: vi.fn<() => void>(),
    onCreate: vi.fn<() => void>(),
    onImport: vi.fn<(text: string) => void>(),
    onRename: vi.fn<(id: string, name: string) => void>(),
    onExport: vi.fn<(id: string) => void>(),
    onDelete: vi.fn<(id: string) => void>(),
    count: vi.fn((p: Playlist) => (p.kind === 'manual' ? p.items.length : p.id === 'calm' ? 318 : null)),
    onError: vi.fn((_what: string) => (_e: unknown) => {}),
  } satisfies SidebarActions;
}

/** The sidebar with its picked pane and folded sections kept, as the home keeps them. */
function Harness({ actions, theLists = lists, start = { kind: 'library' }, onSelect }: { actions?: SidebarActions; theLists?: Lists; start?: Pane | null; onSelect?: (p: Pane) => void }) {
  const [selected, setSelected] = useState<Pane | null>(start);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  return (
    <InsetSidebar
      sections={sidebarSections(theLists, { library: 9795, starred: 42 })}
      lists={theLists}
      actions={actions}
      selected={selected}
      collapsed={collapsed}
      onSelect={(p) => {
        setSelected(p);
        onSelect?.(p);
      }}
      onToggle={(id) => setCollapsed((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))}
    />
  );
}

const rows = () => [...document.querySelectorAll<HTMLLIElement>('li.isb-item')];
const rowFor = (name: string) => rows().find((r) => r.querySelector('.isb-name')?.textContent === name)!;
const rowButton = (name: string) => rowFor(name).querySelector<HTMLButtonElement>('button.isb-row')!;

afterEach(() => {
  drags.cancel();
  cleanup();
});

describe('the inset sidebar', () => {
  it('lists the library, starred and recently played, then the playlists, then the smart playlists', () => {
    render(<Harness actions={fakeActions()} />);
    expect(rows().map((r) => r.querySelector('.isb-name')?.textContent)).toEqual(['Library', 'Starred', 'Recently played', 'Chill', 'Warm up', 'Calm']);
    expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual(['Library', 'Playlists', 'Smart playlists']);
  });

  it("shows the counts, a playlist's from actions.count, and nothing for one unknown", () => {
    render(<Harness actions={fakeActions()} />);
    const count = (name: string) => rowFor(name).querySelector('.isb-count')?.textContent ?? null;
    expect(count('Library')).toBe('9,795');
    expect(count('Starred')).toBe('42');
    expect(count('Recently played')).toBeNull();
    expect(count('Chill')).toBe('2');
    expect(count('Warm up')).toBe('0');
    expect(count('Calm')).toBe('318');
  });

  it('picks a row on a click, and marks the one picked', () => {
    const onSelect = vi.fn();
    render(<Harness actions={fakeActions()} start={{ kind: 'list', id: 'chill' }} onSelect={onSelect} />);
    const current = () => [...document.querySelectorAll('[aria-current="true"]')];
    expect(current()).toEqual([screen.getByRole('button', { name: 'Chill, playlist, 2 presets' })]);
    fireEvent.click(rowButton('Starred'));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'starred' });
    fireEvent.click(rowButton('Recently played'));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'list', id: 'recent' });
    expect(current()).toEqual([rowButton('Recently played')]);
  });

  it('plays a playlist on a double-click, stops the one playing, and greys the play button of an empty one', () => {
    const actions = fakeActions();
    render(<Harness actions={actions} theLists={{ ...lists, deck: { ...EMPTY_DECK, playlist: 'calm' } }} />);
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Chill, playlist, 2 presets' }));
    expect(actions.onPlay).toHaveBeenCalledWith('chill');
    fireEvent.doubleClick(rowButton('Calm'));
    expect(actions.onStop).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Play Warm up' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Play Chill' }));
    expect(actions.onPlay).toHaveBeenCalledTimes(2);
  });

  it('marks the playlist playing with a green dot after its name', () => {
    render(<Harness actions={fakeActions()} theLists={{ ...lists, deck: { ...EMPTY_DECK, playlist: 'chill' } }} />);
    const playing = screen.getByRole('button', { name: 'Chill, playlist, 2 presets, playing' });
    expect(playing.querySelector('.isb-name')?.nextElementSibling?.className).toBe('isb-dot');
    expect(document.querySelectorAll('.isb-dot')).toHaveLength(1);
  });

  it('makes a new playlist with +', () => {
    const actions = fakeActions();
    render(<Harness actions={actions} />);
    fireEvent.click(screen.getByRole('button', { name: 'new playlist' }));
    expect(actions.onCreate).toHaveBeenCalledTimes(1);
  });

  it('adds a playlist from a file with ⤓: its hidden input reads the file and hands over the text', async () => {
    const actions = fakeActions();
    render(<Harness actions={actions} />);
    const input = screen.getByTestId('isb-import') as HTMLInputElement;
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'add from a file' }));
    expect(click).toHaveBeenCalled();
    const text = '{"name":"Shared"}';
    const file = new File([text], 'shared.json', { type: 'application/json' });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(actions.onImport).toHaveBeenCalledWith(text);
  });

  it('says what an empty section is for', () => {
    render(<Harness actions={fakeActions()} theLists={{ playlists: [], deck: EMPTY_DECK }} />);
    expect(screen.getByText('None yet: + makes one.')).toBeTruthy();
    expect(document.querySelectorAll('.isb-empty')).toHaveLength(2);
  });
});

describe('drop targets', () => {
  const payload: Payload = { kind: 'preset', path: '/p/x.milk', name: 'x', thumbnail: null };
  const handlers: DragHandlers = { accepts: (t) => t.startsWith('list:'), onDrop: vi.fn() };

  it("are manual playlists' rows; a smart one refuses while a preset is dragged", () => {
    render(<Harness actions={fakeActions()} />);
    expect(rowFor('Chill').dataset.drop).toBe('list:chill');
    expect(rowFor('Warm up').dataset.drop).toBe('list:warm');
    for (const name of ['Library', 'Starred', 'Recently played', 'Calm']) expect(rowFor(name).hasAttribute('data-drop')).toBe(false);
    expect(rowFor('Calm').hasAttribute('data-refuses')).toBe(false);

    act(() => {
      drags.press(0, 0, payload, handlers);
      drags.move(20, 20);
    });
    expect(rowFor('Calm').hasAttribute('data-refuses')).toBe(true);
    expect(rowFor('Recently played').hasAttribute('data-refuses')).toBe(true);
    expect(rowFor('Chill').hasAttribute('data-refuses')).toBe(false);

    act(() => drags.cancel());
    expect(rowFor('Calm').hasAttribute('data-refuses')).toBe(false);
  });

  it('light up the one under the pointer', () => {
    render(<Harness actions={fakeActions()} />);
    const chillRow = rowFor('Chill');
    const at = vi.spyOn(document, 'elementFromPoint').mockImplementation(() => chillRow);
    try {
      act(() => {
        drags.press(0, 0, payload, handlers);
        drags.move(20, 20);
      });
      expect(chillRow.hasAttribute('data-over')).toBe(true);
      expect(rowFor('Warm up').hasAttribute('data-over')).toBe(false);
    } finally {
      act(() => drags.cancel());
      at.mockRestore();
    }
    expect(chillRow.hasAttribute('data-over')).toBe(false);
  });
});

describe("a row's menu", () => {
  const menu = () => screen.getByRole('menu', { name: 'Chill' });
  const items = () => within(menu()).getAllByRole('menuitem');

  it('opens on a right-click, named after the playlist, with its first item focused', () => {
    render(<Harness actions={fakeActions()} />);
    fireEvent.contextMenu(rowButton('Chill'));
    expect(items().map((b) => b.textContent)).toEqual(['Play', 'Rename', 'Save to a file', 'Delete…']);
    expect(document.activeElement).toBe(items()[0]);
  });

  it('opens on Shift+F10 on the focused row, and from its "More" button', () => {
    render(<Harness actions={fakeActions()} />);
    const row = rowButton('Chill');
    row.focus();
    fireEvent.keyDown(row, { key: 'F10', shiftKey: true });
    expect(menu()).toBeTruthy();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More for Chill' }));
    expect(menu()).toBeTruthy();
  });

  it('walks its items with the arrow keys, Home and End', () => {
    render(<Harness actions={fakeActions()} />);
    fireEvent.contextMenu(rowButton('Chill'));
    const [play, rename, save, del] = items();
    const key = (k: string) => fireEvent.keyDown(document.activeElement!, { key: k });
    key('ArrowDown');
    expect(document.activeElement).toBe(rename);
    key('ArrowDown');
    expect(document.activeElement).toBe(save);
    key('ArrowUp');
    expect(document.activeElement).toBe(rename);
    key('End');
    expect(document.activeElement).toBe(del);
    key('ArrowDown');
    expect(document.activeElement).toBe(play);
    key('Home');
    expect(document.activeElement).toBe(play);
  });

  it('plays, and saves to a file', () => {
    const actions = fakeActions();
    render(<Harness actions={actions} />);
    fireEvent.contextMenu(rowButton('Chill'));
    fireEvent.click(within(menu()).getByRole('menuitem', { name: 'Play' }));
    expect(actions.onPlay).toHaveBeenCalledWith('chill');
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.contextMenu(rowButton('Chill'));
    fireEvent.click(within(menu()).getByRole('menuitem', { name: 'Save to a file' }));
    expect(actions.onExport).toHaveBeenCalledWith('chill');
  });

  it('renames in place: Enter keeps the new name', () => {
    const actions = fakeActions();
    render(<Harness actions={actions} />);
    fireEvent.contextMenu(rowButton('Chill'));
    fireEvent.click(within(menu()).getByRole('menuitem', { name: 'Rename' }));
    const box = screen.getByRole('textbox', { name: 'New name for Chill' });
    fireEvent.change(box, { target: { value: 'Chilled' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(actions.onRename).toHaveBeenCalledWith('chill', 'Chilled');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('renames in place: Escape puts it back, renames nothing, and focus returns to the row', () => {
    const actions = fakeActions();
    render(<Harness actions={actions} />);
    fireEvent.contextMenu(rowButton('Chill'));
    fireEvent.click(within(menu()).getByRole('menuitem', { name: 'Rename' }));
    const box = screen.getByRole('textbox', { name: 'New name for Chill' });
    fireEvent.change(box, { target: { value: 'Something else' } });
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(actions.onRename).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.activeElement).toBe(rowButton('Chill'));
  });

  it('asks before deleting: Keep keeps it, confirming deletes it', () => {
    const actions = fakeActions();
    render(<Harness actions={actions} />);
    fireEvent.contextMenu(rowButton('Chill'));
    fireEvent.click(within(menu()).getByRole('menuitem', { name: 'Delete…' }));
    expect(items().map((b) => b.textContent)).toEqual(['Delete Chill?', 'Keep']);
    fireEvent.click(within(menu()).getByRole('menuitem', { name: 'Keep' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(actions.onDelete).not.toHaveBeenCalled();

    fireEvent.contextMenu(rowButton('Chill'));
    fireEvent.click(within(menu()).getByRole('menuitem', { name: 'Delete…' }));
    fireEvent.click(within(menu()).getByRole('menuitem', { name: 'Delete Chill?' }));
    expect(actions.onDelete).toHaveBeenCalledWith('chill');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape, putting focus back on the row', () => {
    render(<Harness actions={fakeActions()} />);
    const row = rowButton('Chill');
    row.focus();
    fireEvent.keyDown(row, { key: 'F10', shiftKey: true });
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(rowButton('Chill'));
  });

  it('closes on a press outside it', () => {
    render(<Harness actions={fakeActions()} />);
    fireEvent.contextMenu(rowButton('Chill'));
    expect(menu()).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('for Recently played, only plays and saves', () => {
    render(<Harness actions={fakeActions()} />);
    fireEvent.contextMenu(rowButton('Recently played'));
    expect(
      within(screen.getByRole('menu', { name: 'Recently played' }))
        .getAllByRole('menuitem')
        .map((b) => b.textContent),
    ).toEqual(['Play', 'Save to a file']);
  });

  it("keeps the walk's keys from the window's listeners", () => {
    render(<Harness actions={fakeActions()} />);
    const seen: string[] = [];
    const listen = (e: KeyboardEvent) => seen.push(e.key);
    window.addEventListener('keydown', listen);
    try {
      for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End']) {
        const row = rowButton('Chill');
        row.focus();
        fireEvent.keyDown(row, { key });
      }
      const head = screen.getByRole('button', { name: /^Playlists/ });
      head.focus();
      fireEvent.keyDown(head, { key: 'ArrowRight' });
    } finally {
      window.removeEventListener('keydown', listen);
    }
    expect(seen).toEqual([]);
  });

  it('renames on leaving the box, leaving focus where it went', () => {
    const actions = fakeActions();
    render(<Harness actions={actions} />);
    fireEvent.contextMenu(rowButton('Chill'));
    fireEvent.click(within(menu()).getByRole('menuitem', { name: 'Rename' }));
    const box = screen.getByRole('textbox', { name: 'New name for Chill' });
    fireEvent.change(box, { target: { value: 'Chilled' } });
    const library = rowButton('Library');
    library.focus();
    fireEvent.blur(box);
    expect(actions.onRename).toHaveBeenCalledWith('chill', 'Chilled');
    expect(document.activeElement).toBe(library);
  });

  it('plays or stops by what is playing when chosen, not when it opened', () => {
    const actions = fakeActions();
    const { rerender } = render(<Harness actions={actions} />);
    fireEvent.contextMenu(rowButton('Chill'));
    rerender(<Harness actions={actions} theLists={{ ...lists, deck: { ...EMPTY_DECK, playlist: 'chill' } }} />);
    fireEvent.click(within(menu()).getByRole('menuitem', { name: 'Stop' }));
    expect(actions.onStop).toHaveBeenCalled();
    expect(actions.onPlay).not.toHaveBeenCalled();
  });

  it('after a delete, focuses the next row in the section, else the previous, else its heading', () => {
    function Live() {
      const [l, setL] = useState<Lists>({ playlists: [chill, warm], deck: EMPTY_DECK });
      const actions = { ...fakeActions(), onDelete: (id: string) => setL((x) => ({ ...x, playlists: x.playlists.filter((p) => p.id !== id) })) };
      return <Harness actions={actions} theLists={l} />;
    }
    render(<Live />);
    const del = (name: string) => {
      fireEvent.contextMenu(rowButton(name));
      fireEvent.click(within(screen.getByRole('menu', { name })).getByRole('menuitem', { name: 'Delete…' }));
      fireEvent.click(within(screen.getByRole('menu', { name })).getByRole('menuitem', { name: `Delete ${name}?` }));
    };
    const [first, second] = [...rowFor('Chill').parentElement!.querySelectorAll('.isb-name')].map((n) => n.textContent!);
    del(first);
    expect(document.activeElement).toBe(rowButton(second));
    del(second);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Playlists/ }));
  });

  it('leaves the rename box its own context menu', () => {
    render(<Harness actions={fakeActions()} />);
    fireEvent.contextMenu(rowButton('Chill'));
    fireEvent.click(within(menu()).getByRole('menuitem', { name: 'Rename' }));
    const box = screen.getByRole('textbox', { name: 'New name for Chill' });
    expect(fireEvent.contextMenu(box)).toBe(true);
    expect(fireEvent.contextMenu(rowButton('Library'))).toBe(false);
  });

  it('is not there for the library or starred', () => {
    render(<Harness actions={fakeActions()} />);
    fireEvent.contextMenu(rowButton('Library'));
    fireEvent.contextMenu(rowButton('Starred'));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(rowFor('Library').querySelector('.isb-more')).toBeNull();
    expect(rowFor('Starred').querySelector('.isb-more')).toBeNull();
  });
});
