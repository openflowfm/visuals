// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryRow } from '../api.ts';
import { Section } from './Section.tsx';

afterEach(cleanup);

const row = (n: number, over: Partial<LibraryRow> = {}): LibraryRow =>
  ({ key: `k${n}`, path: `/p/${n}.milk`, hash: `h${n}`, style: 'Hypnotic', sub_style: null, authors: ['geiss'], title: `preset ${n}`, thumbnail: null, look: null, ...over }) as LibraryRow;
const ROWS = [row(1), row(2), row(3)];

describe('Section in a DOM', () => {
  it('is a region named by its title, its tiles buttons that play from a click, Enter or Space', async () => {
    const user = userEvent.setup();
    const onPlay = vi.fn();
    render(<Section title="Hypnotic" rows={ROWS} onPlay={onPlay} />);
    const region = screen.getByRole('region', { name: 'Hypnotic' });
    const tiles = within(region).getAllByRole('button');
    expect(tiles).toHaveLength(3);

    await user.click(tiles[0]);
    expect(onPlay).toHaveBeenLastCalledWith(ROWS[0]);
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(tiles[1]);
    await user.keyboard('{Enter}');
    expect(onPlay).toHaveBeenLastCalledWith(ROWS[1]);
    await user.tab();
    await user.keyboard(' ');
    expect(onPlay).toHaveBeenLastCalledWith(ROWS[2]);
  });

  it('marks the playing tile as current and says playing and starred', () => {
    render(<Section title="Now" rows={ROWS} playing="/p/2.milk" starred={['k3']} onPlay={() => {}} />);
    const now = screen.getByRole('button', { current: true });
    expect(now.getAttribute('aria-label')).toBe('preset 2 — Hypnotic, by geiss · playing');
    expect(now.querySelector('.tile-live')).not.toBeNull();
    expect(screen.getByRole('button', { name: /preset 3/ }).getAttribute('aria-label')).toMatch(/ · starred$/);
  });

  it('calls its action back, and says its empty line with no row', async () => {
    const onPress = vi.fn();
    render(<Section title="Starred" rows={[]} action={{ label: 'See all', onPress }} empty="Nothing starred" />);
    expect(screen.getByText('Nothing starred')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'See all' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('keeps tiles as pictures, out of the tab order, when nothing plays them', () => {
    render(<Section title="Pictures" rows={ROWS} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });
});
