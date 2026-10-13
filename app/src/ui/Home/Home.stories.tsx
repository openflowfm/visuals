import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test';
import { withLibraryTheme, withStoryFrame } from '@satoramoto/zen/storybook';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import { PLAYING_DECK, row, WARM_UP } from '../fixtures/fixtures';
import { INSPECTOR_ID, SIDEBAR_ID } from '../HomeLayout/HomeLayout';
import { DEFAULT_AXES } from '../model/field';
import { setMapAxes } from '../model/mapPrefs';
import { LIBRARY_VIEW_KEY } from '../model/libraryView';
import { Home } from './Home';

/** Map view's stories start on the map's default axes (the choice is the page's, shared by every map) and leave them so. */
const defaultAxes = () => {
  setMapAxes(DEFAULT_AXES);
  return () => setMapAxes(DEFAULT_AXES);
};

/** The room's map: the listbox its dots are reached by, outside the inspector. */
const roomMap = (canvasElement: HTMLElement) => canvasElement.querySelector<HTMLElement>('.vs-map-room [role="listbox"]');

/** How many dots the room's map draws: one `M…h0` per preset in its paths. */
const dotsIn = (canvasElement: HTMLElement) => [...canvasElement.querySelectorAll('.vs-map-room .vs-field-dots path')].reduce((n, p) => n + (p.getAttribute('d')?.match(/M/g)?.length ?? 0), 0);

/** The inspector, where it shows, has no map section of its own while the room shows the map. */
const noInspectorMap = async (canvasElement: HTMLElement) => {
  const inspector = canvasElement.querySelector<HTMLElement>(`#${INSPECTOR_ID}`);
  if (inspector) await expect(within(inspector).queryByRole('group', { name: 'Library map' })).toBeNull();
};

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

/** The inspector, where it shows, has the library map, the preset playing lit. */
const mapLitsPlaying = async (canvasElement: HTMLElement) => {
  const inspector = canvasElement.querySelector<HTMLElement>(`#${INSPECTOR_ID}`);
  if (!inspector) return;
  const map = within(inspector).getByRole('group', { name: 'Library map' });
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
    await mapLitsPlaying(canvasElement);
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
    await mapLitsPlaying(canvasElement);
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
    // The row itself (its accessible name says it's a playlist).
    const row = await side.findByRole('button', { name: new RegExp(`^${WARM_UP.name}, playlist`) });
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

/**
 * The library in Map view (wireframe B): the hero as ever, the library's head with Grid | Map and
 * the colour picker, and the map in the grid's room, of what the grid would show. A search thins
 * the dots and the head's count follows; the inspector's own map section is gone.
 */
export const MapView: Story = {
  name: 'Map view',
  args: { library: true },
  beforeEach: defaultAxes,
  parameters: { frame: 'fill', storage: { [LIBRARY_VIEW_KEY]: 'map' } },
  play: async ({ canvas, canvasElement }) => {
    const views = await canvas.findByRole('radiogroup', { name: 'Show the library as' });
    await expect(within(views).getByRole('radio', { name: 'Map' })).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(roomMap(canvasElement)).not.toBeNull());
    await expect(roomMap(canvasElement)!.getAttribute('aria-label')).toBe('The library by speed and brightness');
    await expect(canvas.queryByRole('listbox', { name: 'presets' })).toBeNull();
    await noInspectorMap(canvasElement);
    await waitFor(() => expect(dotsIn(canvasElement)).toBeGreaterThan(20));
    const all = dotsIn(canvasElement);
    const count = () => Number(canvasElement.querySelector('.vs-libhead-count')?.textContent?.replace(/,/g, '') ?? NaN);
    const allCount = count();

    // A search narrows the dots, and the head's count follows.
    const search = canvasElement.querySelector<HTMLInputElement>('.vs-header .vs-home-toolbar input')!;
    await userEvent.type(search, PLAYING.style);
    await waitFor(() => expect(dotsIn(canvasElement)).toBeLessThan(all));
    await expect(dotsIn(canvasElement)).toBeGreaterThan(0);
    await waitFor(() => expect(count()).toBeLessThan(allCount));
    await expect(count()).toBeGreaterThanOrEqual(dotsIn(canvasElement));
  },
};

/** Map view on a playlist (Warm-up, playing): its presets as dots, the one playing lit. */
export const MapViewPlaylist: Story = {
  name: 'Map view, a playlist',
  beforeEach: defaultAxes,
  parameters: { frame: 'fill', storage: { [LIBRARY_VIEW_KEY]: 'map' } },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(roomMap(canvasElement)?.getAttribute('aria-label')).toBe(`${WARM_UP.name} by speed and brightness`));
    // Its presets, once each: no more dots than it lists.
    await waitFor(() => expect(dotsIn(canvasElement)).toBeGreaterThan(0));
    await expect(dotsIn(canvasElement)).toBeLessThanOrEqual(new Set(WARM_UP.items.map((i) => i.path)).size);
    await waitFor(() => expect(canvasElement.querySelector('.vs-map-room .vs-field-lit')).not.toBeNull());
    await expect(canvasElement.querySelector('.vs-libhead-title')?.textContent).toBe(WARM_UP.name);
    await noInspectorMap(canvasElement);
  },
};

/** The switch: Grid (the room's grid, the inspector's map), Map (the room's map, none in the inspector), and Grid again. */
export const GridMapSwitch: Story = {
  name: 'Grid | Map switch',
  beforeEach: defaultAxes,
  parameters: { frame: 'fill' },
  play: async ({ canvas, canvasElement }) => {
    await canvas.findByRole('list', { name: `${WARM_UP.name}, in the order it plays` });
    const views = canvas.getByRole('radiogroup', { name: 'Show the library as' });
    await expect(within(views).getByRole('radio', { name: 'Grid' })).toHaveAttribute('aria-checked', 'true');
    await expect(roomMap(canvasElement)).toBeNull();
    await userEvent.click(within(views).getByRole('radio', { name: 'Map' }));
    await waitFor(() => expect(roomMap(canvasElement)).not.toBeNull());
    await expect(canvas.queryByRole('list', { name: `${WARM_UP.name}, in the order it plays` })).toBeNull();
    await noInspectorMap(canvasElement);
    await userEvent.click(within(views).getByRole('radio', { name: 'Grid' }));
    await canvas.findByRole('list', { name: `${WARM_UP.name}, in the order it plays` });
    await expect(roomMap(canvasElement)).toBeNull();
    const inspector = canvasElement.querySelector<HTMLElement>(`#${INSPECTOR_ID}`);
    if (inspector) await expect(within(inspector).getByRole('group', { name: 'Library map' })).toBeTruthy();
  },
};
