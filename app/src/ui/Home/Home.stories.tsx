import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test';
import { withLibraryTheme, withStoryFrame } from '@satoramoto/zen/storybook';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import { PLAYING_DECK, row, WARM_UP } from '../fixtures/fixtures';
import { INSPECTOR_ID, SIDEBAR_ID } from '../HomeLayout/HomeLayout';
import { Home } from './Home';

/** The preset the deck plays: Warm-up's third, `row(7)`. */
const PLAYING = row(7);

/**
 * The original's `.storybook/preview.tsx` viewports, as design windows (`parameters.frame`): the
 * one where it turns narrow, and the narrowest it goes. The stories named for them are drawn at
 * that window, scaled down only when the canvas is smaller (storybook.tsx's `withStoryFrame`).
 * The rest are the fluid window (`frame: 'fill'`): the canvas at its real size, the panels at
 * their sizes and the central column taking what is left, as in the app.
 */
const WINDOWS = {
  narrow: { w: 560, h: 800 },
  home900: { w: 900, h: 800 },
};

/**
 * The hero is the picture alone (decision 71); the inspector, where it shows, names the deck's
 * preset, not one picked at random. (The original looked for `.hero-info` and `.insp-name`; the
 * port asks the inspector's panel, by its id, for the name.)
 */
const heroNamesPlaying = async (canvasElement: HTMLElement) => {
  const inspector = canvasElement.querySelector(`#${INSPECTOR_ID}`);
  if (inspector) await waitFor(() => expect(inspector.textContent).toContain(PLAYING.title));
};

/**
 * The inspector's two parts, where it shows: the details on top and the library map pinned at the
 * region's bottom, under them, the preset playing lit.
 */
const mapUnderDetails = async (canvasElement: HTMLElement) => {
  const inspector = canvasElement.querySelector<HTMLElement>(`#${INSPECTOR_ID}`);
  if (!inspector) return;
  const map = within(inspector).getByRole('group', { name: 'Library map' });
  const details = inspector.querySelector('.vs-inspector-details')!;
  await expect(details.getBoundingClientRect().bottom).toBeLessThanOrEqual(map.getBoundingClientRect().top + 0.5);
  await expect(inspector.getBoundingClientRect().bottom - map.getBoundingClientRect().bottom).toBeLessThan(48);
  await expect(map.querySelector('.vs-field-lit')).not.toBeNull();
};

/**
 * The whole home as an inspector view (decision 70): the sidebar picking a
 * source, the Now Playing hero over a grid of the source's presets, the
 * inspector about what is picked (else the source), and the transport bar,
 * playing from Warm-up. The sidebar docks from 900 px and the inspector from
 * 1200 px; narrower, each is laid over the grid when opened.
 */
const meta = {
  title: 'open[flow]/visuals/Home/Home',
  component: Home,
  decorators: [withVisualsFrame, withStoryFrame, withLibraryTheme],
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
  // The window buttons' stand-in, so the title's and the header's room beside them can be judged.
  args: { start: null, onMode: () => {}, lights: true },
  // Picked up where the app left off, as at a launch: without a resume the home opens a random preset, and the hero wouldn't name the deck's.
  parameters: {
    scope: 'bare',
    layout: 'fullscreen',
    frame: 'fill',
    world: { resume: { playlist: WARM_UP.id, index: PLAYING_DECK.index, current: PLAYING_DECK.current, source: null } },
  },
} satisfies Meta<typeof Home>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The canvas's window: Warm-up's grid scrolling up behind the pinned preview; the sidebar and the inspector docked where the canvas has room for them. */
export const Wide: Story = {
  parameters: { frame: 'fill' },
  play: async ({ canvas, canvasElement }) => {
    const list = await canvas.findByRole('list', { name: `${WARM_UP.name}, in the order it plays` });
    await heroNamesPlaying(canvasElement);
    // The tiles carry their names; their place is said, not shown: the order is the order.
    const first = (await within(list).findAllByRole('listitem'))[0];
    await expect(first.getAttribute('aria-label')).toMatch(/^1\. /);
    await expect(first.querySelector('.vs-home-tile-n')).toBeNull();
    // The sidebar's first row and the column's preview start on one line (HomeLayout's content line).
    const headrow = canvasElement.querySelector('.vs-isb-headrow');
    const hero = canvasElement.querySelector('.vs-lay-hero');
    if (headrow && hero) await expect(Math.abs(headrow.getBoundingClientRect().top - hero.getBoundingClientRect().top)).toBeLessThanOrEqual(1);
    await mapUnderDetails(canvasElement);
  },
};

/** At 900×800: the sidebar docked, the inspector closed at first. */
export const At900: Story = {
  name: 'At 900 px',
  parameters: { frame: WINDOWS.home900 },
  play: async ({ canvas, canvasElement }) => {
    await expect(await canvas.findByRole('list', { name: `${WARM_UP.name}, in the order it plays` })).toBeTruthy();
    await heroNamesPlaying(canvasElement);
  },
};

/** Under 900 px: both panes put away, opened over the grid from the header. */
export const Narrow: Story = {
  parameters: { frame: WINDOWS.narrow },
};

/** Opened on the library (`VISUALS_VIEW=library`) while Warm-up plays, with a preset picked (⌘-click; a plain click plays): the inspector shows it. */
export const Library: Story = {
  args: { library: true },
  parameters: { frame: 'fill' },
  play: async ({ canvas, canvasElement }) => {
    const grid = await canvas.findByRole('listbox', { name: 'presets' });
    const first = (await within(grid).findAllByRole('option'))[0];
    fireEvent.click(first, { metaKey: true });
    await waitFor(() => expect(first.getAttribute('aria-selected')).toBe('true'));
    // The library's search and "Filter ▾" sit in the header's toolbar slot.
    await expect(canvasElement.querySelector('.vs-header .vs-home-toolbar input')).toBeTruthy();
  },
};

/** The library with several presets picked (⌘-click): the inspector's details show them and their pictures, and the library map stays under them, lighting what plays. */
export const SeveralPicked: Story = {
  name: 'Several picked',
  args: { library: true },
  parameters: { frame: 'fill' },
  play: async ({ canvas, canvasElement }) => {
    const grid = await canvas.findByRole('listbox', { name: 'presets' });
    const options = await within(grid).findAllByRole('option');
    for (const o of options.slice(0, 3)) fireEvent.click(o, { metaKey: true });
    const inspector = canvasElement.querySelector<HTMLElement>(`#${INSPECTOR_ID}`);
    if (!inspector) return;
    await waitFor(() => expect(within(inspector).getByRole('heading', { name: '3 selected' })).toBeVisible());
    await mapUnderDetails(canvasElement);
  },
};

/** Quick add on Warm-up (its card's "Add presets", from its row picked again): the library with the strip over it, ✓ on what Warm-up holds. */
export const QuickAdd: Story = {
  name: 'Quick add',
  parameters: { frame: 'fill' },
  play: async ({ canvas, canvasElement }) => {
    await canvas.findByRole('list', { name: `${WARM_UP.name}, in the order it plays` });
    // In a narrow frame the sidebar and the inspector start put away: open them from the header.
    if (!canvasElement.querySelector(`#${SIDEBAR_ID}`)) await userEvent.click(canvas.getByRole('button', { name: 'sidebar' }));
    const side = within(canvasElement.querySelector(`#${SIDEBAR_ID}`) as HTMLElement);
    // The row itself, not its menu's button (which names the playlist too).
    const row = (await side.findAllByRole('button', { name: new RegExp(`^${WARM_UP.name}`) })).find((b) => !b.hasAttribute('aria-haspopup'))!;
    await userEvent.click(row);
    if (!canvasElement.querySelector(`#${INSPECTOR_ID}`)) await userEvent.click(canvas.getByRole('button', { name: 'info' }));
    await userEvent.click(await canvas.findByRole('button', { name: 'Add presets' }));
    await waitFor(() => expect(canvasElement.querySelector('.vs-home-quickadd')?.textContent).toContain(WARM_UP.name));
    await waitFor(() =>
      expect(
        within(canvas.getByRole('listbox', { name: 'presets' }))
          .getAllByRole('option')
          .some((o) => o.hasAttribute('data-added')),
      ).toBe(true),
    );
  },
};
