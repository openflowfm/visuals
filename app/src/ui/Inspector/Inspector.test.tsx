// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryRow } from '../model/api';
import { prepareRow } from '../model/librarySearch';
import { DATA, PLAYLISTS, ROWS } from '../fixtures/fixtures';
import { NOW } from '../fixtures/layout';
import { mapCount } from '../Field/LibraryMap';
import { Inspector, type InspectorProps } from './Inspector';

const PLAYING = NOW.preset!;
/** A preset other than the one playing. */
const OTHER = ROWS.find((r) => r.look && r.key !== PLAYING.key)!;
const prep = (r: LibraryRow) => prepareRow(r, DATA.presets[r.key]);

function props(over: Partial<InspectorProps> = {}): InspectorProps {
  return {
    subject: prep(PLAYING),
    playing: PLAYING.key,
    playingPreset: prep(PLAYING),
    from: '',
    playlists: PLAYLISTS,
    library: ROWS,
    mine: DATA.presets,
    onSet: () => {},
    onAddTo: () => {},
    onPick: vi.fn(),
    onBack: vi.fn(),
    ...over,
  };
}

const mapOf = () => screen.getByRole('group', { name: 'Library map' });
const fieldOf = () => within(mapOf()).getByRole('listbox', { name: 'The library by speed and brightness' });
/** Focuses the field from the keyboard: its cursor starts on the lit dot. The option under it. */
function cursor() {
  act(() => fieldOf().focus());
  return within(fieldOf()).getByRole('option');
}
/** Whether `a` comes before `b` in the document. */
const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

afterEach(cleanup);

describe('the library map in the inspector', () => {
  it('sits under the details, its own section, with the count and the axes', () => {
    render(<Inspector {...props()} />);
    const details = document.querySelector('.vs-inspector-details')!;
    expect(details.contains(mapOf())).toBe(false);
    expect(before(details, mapOf())).toBe(true);
    expect(mapOf()).toHaveTextContent(`${mapCount(ROWS.filter((r) => r.look).length, ROWS.length)} · Speed × Brightness`);
  });

  it('lights the preset playing while a picked one is shown', () => {
    render(<Inspector {...props({ subject: prep(OTHER) })} />);
    const option = cursor();
    expect(option.textContent).toMatch(/playing$/);
    expect(option).toHaveAttribute('aria-selected', 'true');
  });

  it('stays, under their pictures, for several picked', () => {
    const several = ROWS.filter((r) => r.look)
      .slice(0, 4)
      .map(prep);
    render(<Inspector {...props({ subject: several[0], chosen: several })} />);
    expect(screen.getByRole('heading', { name: '4 selected' })).toBeTruthy();
    const pictures = document.querySelector('.vs-inspector-pictures')!;
    expect(before(pictures, mapOf())).toBe(true);
    expect(cursor().textContent).toMatch(/playing$/);
  });

  it('stays under a source, and with nothing playing says what the dots are', () => {
    const { unmount } = render(<Inspector {...props({ subject: null, source: <h2>Warm-up</h2> })} />);
    expect(before(screen.getByRole('heading', { name: 'Warm-up' }), mapOf())).toBe(true);
    expect(cursor().textContent).toMatch(/playing$/);
    unmount();
    render(<Inspector {...props({ subject: null, playing: null, playingPreset: null })} />);
    expect(within(mapOf()).getByText(/each dot is a preset/i)).toBeTruthy();
    expect(document.querySelector('.vs-field-lit')).toBeNull();
    // The details' own words no longer speak of the dots or the map.
    expect(document.querySelector('.vs-inspector-details')!.textContent).not.toMatch(/dot|map/i);
  });

  it('plays another dot, and the dot playing brings the details back to it', () => {
    const p = props({ subject: prep(OTHER) });
    render(<Inspector {...p} />);
    // The cursor is on the dot playing: Enter on it goes back, rather than playing it again.
    cursor();
    fireEvent.keyDown(fieldOf(), { key: 'Enter' });
    expect(p.onBack).toHaveBeenCalledTimes(1);
    expect(p.onPick).not.toHaveBeenCalled();
    // Another dot plays.
    fireEvent.keyDown(fieldOf(), { key: 'ArrowRight' });
    fireEvent.keyDown(fieldOf(), { key: 'Enter' });
    expect(p.onPick).toHaveBeenCalledTimes(1);
    expect((p.onPick as ReturnType<typeof vi.fn>).mock.calls[0][0].key).not.toBe(PLAYING.key);
  });

  it("leaves its map section out while the library's room shows the map (map={false})", () => {
    render(<Inspector {...props()} map={false} />);
    expect(screen.queryByRole('group', { name: 'Library map' })).toBeNull();
    expect(screen.queryByRole('listbox')).toBeNull();
    // The details are all there.
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(prep(PLAYING).title);
  });

  it('does nothing for the dot playing while the details show it', () => {
    const p = props();
    render(<Inspector {...p} />);
    cursor();
    fireEvent.keyDown(fieldOf(), { key: 'Enter' });
    expect(p.onBack).not.toHaveBeenCalled();
    expect(p.onPick).not.toHaveBeenCalled();
  });
});

describe('mapCount', () => {
  it('says how many it draws, and of how many while the index is drawing them', () => {
    expect(mapCount(9791, 9791)).toBe('9,791 presets');
    expect(mapCount(1, 1)).toBe('1 preset');
    expect(mapCount(250, 9791)).toBe('250 of 9,791 presets');
  });
});
