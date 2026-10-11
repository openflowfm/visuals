import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test';
import { Home } from './Home.tsx';
import { PLAYING_DECK, row, WARM_UP } from './stories/fixtures.ts';

/** The preset the deck plays: Warm-up's third, `row(7)`. */
const PLAYING = row(7);

/** The hero is the picture alone (decision 71); the inspector, where it shows, names the deck's preset, not one picked at random. */
const heroNamesPlaying = async (canvasElement: HTMLElement) => {
  await expect(canvasElement.querySelector('.hero .hero-info')).toBeNull();
  if (canvasElement.querySelector('.insp')) await waitFor(() => expect(canvasElement.querySelector('.insp .insp-name')?.textContent).toBe(PLAYING.title));
};

/**
 * The whole home as an inspector view (decision 70): the sidebar picking a
 * source, the Now Playing hero over a grid of the source's presets, the
 * inspector about what is picked (else the source), and the transport bar,
 * playing from Warm-up. The sidebar docks from 900 px and the inspector from
 * 1200 px; narrower, each is laid over the grid when opened.
 */
const meta = {
  title: 'Home/Home',
  component: Home,
  args: { start: null, onMode: () => {} },
  // Picked up where the app left off, as at a launch: without a resume the home opens a random preset, and the hero wouldn't name the deck's.
  parameters: { scope: 'bare', layout: 'fullscreen', tauri: { resume: { playlist: WARM_UP.id, index: PLAYING_DECK.index, current: PLAYING_DECK.current, source: null } } },
} satisfies Meta<typeof Home>;
export default meta;
type Story = StoryObj<typeof meta>;

/** At 1440×900: Warm-up's grid, the sidebar and the inspector docked. */
export const Wide: Story = {
  globals: { viewport: { value: 'home1440', isRotated: false } },
  play: async ({ canvas, canvasElement }) => {
    await expect(await canvas.findByRole('list', { name: `${WARM_UP.name}, in the order it plays` })).toBeTruthy();
    await heroNamesPlaying(canvasElement);
  },
};

/** At 900×800: the sidebar docked, the inspector closed at first. */
export const At900: Story = {
  name: 'At 900 px',
  globals: { viewport: { value: 'home900', isRotated: false } },
  play: async ({ canvas, canvasElement }) => {
    await expect(await canvas.findByRole('list', { name: `${WARM_UP.name}, in the order it plays` })).toBeTruthy();
    await heroNamesPlaying(canvasElement);
  },
};

/** Under 900 px: both panes put away, opened over the grid from the header. */
export const Narrow: Story = {
  globals: { viewport: { value: 'narrow', isRotated: false } },
};

/** Opened on the library (`VISUALS_VIEW=library`) while Warm-up plays, with a preset picked (⌘-click; a plain click plays): the inspector shows it. */
export const Library: Story = {
  args: { library: true },
  globals: { viewport: { value: 'home1440', isRotated: false } },
  play: async ({ canvas, canvasElement }) => {
    const grid = await canvas.findByRole('listbox', { name: 'presets' });
    const first = (await within(grid).findAllByRole('option'))[0];
    fireEvent.click(first, { metaKey: true });
    await waitFor(() => expect(first.getAttribute('aria-selected')).toBe('true'));
    await expect(canvasElement.querySelector('.vf-header .lib-toolbar')).toBeTruthy();
  },
};

/** Quick add on Warm-up (its card's "Add presets", from its row picked again): the library with the strip over it, ✓ on what Warm-up holds. */
export const QuickAdd: Story = {
  name: 'Quick add',
  globals: { viewport: { value: 'home1440', isRotated: false } },
  play: async ({ canvas, canvasElement }) => {
    await canvas.findByRole('list', { name: `${WARM_UP.name}, in the order it plays` });
    // In a narrow frame the sidebar and the inspector start put away: open them from the header.
    if (!canvasElement.querySelector('.lay-side')) await userEvent.click(canvas.getByRole('button', { name: 'sidebar' }));
    const side = within(canvasElement.querySelector('.lay-side') as HTMLElement);
    const row = (await side.findAllByRole('button', { name: new RegExp(`^${WARM_UP.name}`) })).find((b) => b.classList.contains('isb-row'))!;
    await userEvent.click(row);
    if (!canvasElement.querySelector('.insp')) await userEvent.click(canvas.getByRole('button', { name: 'info' }));
    await userEvent.click(await canvas.findByRole('button', { name: 'Add presets' }));
    await waitFor(() => expect(canvasElement.querySelector('.home-quickadd')?.textContent).toContain(WARM_UP.name));
    await waitFor(() => expect(canvasElement.querySelectorAll('.lib-grid .tile[data-added]').length).toBeGreaterThan(0));
  },
};
