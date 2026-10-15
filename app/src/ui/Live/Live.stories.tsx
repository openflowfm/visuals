import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { withLibraryTheme, withStoryFrame } from '@satoramoto/zen/storybook';
import { Lights } from '../HomeLayout/HomeLayout';
import { FX_BUSY, LISTS, PLAYING_DECK, WARM_UP } from '../fixtures/fixtures';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import { DEFAULT_AXES } from '../model/field';
import { setMapAxes } from '../model/mapPrefs';
import { resetTrail } from '../model/trail';
import { resetLiveMapScope } from '../LiveMap/scope';
import { HOME } from '../Views/Views';
import { Live } from './Live';

/**
 * Live mode, whole, as `App` shows it: the Stage — the picture full-bleed,
 * and over it, on hover, the header's bare type along the top (laid out as
 * Home's) and Home's floating transport: the preset at the top left, and at
 * the foot Effects, ◀ ring ▶ centred, the dice and star. Effects (or E) opens
 * the effects panel at the left; the header's map button (or G) the library
 * map at the right. No sidebar, no dock bar, no toasts. It plays
 * in the window on the way in, "Full screen on…" in the Output popover until a
 * display is picked (only a start in live mode, `windowed` false, opens the
 * output by itself). `\` pins the controls shown; ? lists every control. The
 * parts have stories of their own (Live/Stage…).
 */
/**
 * The fluid window (`parameters.frame: 'fill'`): the Stage fills the canvas at its real size, as
 * the app fills its window.
 */
const WINDOW = 'fill' as const;

/** The window buttons' stand-in over the Stage (the real ones are macOS's), so the header's room beside them can be judged. */
const withLights: Decorator = (Story) => (
  <div style={{ position: 'relative', height: '100%' }}>
    <Story />
    <Lights />
  </div>
);

const meta = {
  title: 'open[flow]/visuals/Live/Live',
  component: Live,
  decorators: [withLights, withVisualsFrame, withStoryFrame, withLibraryTheme],
  globals: VISUALS_GLOBALS,
  // The map's trail and scope are the page's session's (module state): each story starts them over.
  beforeEach: (ctx) => {
    resetTrail();
    resetLiveMapScope();
    return visualsBeforeEach(ctx);
  },
  args: { start: null, onMode: () => {} },
  parameters: { scope: 'bare', layout: 'fullscreen', frame: WINDOW },
} satisfies Meta<typeof Live>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Live's root: what it is doing, as data (it takes no box of its own). */
const root = (el: HTMLElement) => el.querySelector<HTMLElement>('.vs-live')!;

/**
 * Playing Warm-up with Link on (two peers, 124 BPM), the output put on the projector from the
 * Output popover; `\` pins the controls shown and lets them go.
 */
export const Playing: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(root(canvasElement)).toBeInTheDocument());
    // No sidebar in live.
    await expect(canvasElement.querySelector('nav')).toBeNull();
    // Going live plays in the window, with two displays too, until one is picked: the offer is in the Output popover (no toasts).
    await waitFor(() => expect(root(canvasElement).dataset.windowed).toBe(''));
    await expect(canvasElement.querySelector('.vs-stagelayout-toasts')).toBeNull();
    await userEvent.click(await canvas.findByRole('button', { name: 'Output, in this window' }));
    const go = await within(canvas.getByRole('dialog', { name: 'Output, in this window' })).findByRole('button', { name: 'Go full screen on Projector (HDMI)' });
    await userEvent.click(go);
    await waitFor(() => expect(root(canvasElement).dataset.windowed).toBeUndefined());
    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.keyboard('\\');
    await waitFor(() => expect(root(canvasElement).dataset.pinned).toBe(''));
    await expect(canvas.getByText('Pinned')).toBeVisible();
    await userEvent.keyboard('\\');
    await waitFor(() => expect(root(canvasElement).dataset.pinned).toBeUndefined());
  },
};

/**
 * Design C with the effects panel open (E, or the Effects button): docked at the left under the
 * header, in Home's side-panel material; the pads, Intensity, Speed, Colour and Trails, Mirror and
 * Invert, Back to normal. E closes it again.
 */
export const EffectsOpen: Story = {
  name: 'Effects open',
  play: async ({ canvas, canvasElement }) => {
    await waitFor(() => expect(root(canvasElement)).toBeInTheDocument());
    await userEvent.keyboard('e');
    const panel = await canvas.findByRole('complementary', { name: 'Effects' });
    // The overlay fades in with the panel open.
    await waitFor(() => expect(panel).toBeVisible());
    await expect(canvas.getByRole('button', { name: 'Effects' })).toHaveAttribute('aria-expanded', 'true');
    for (const name of ['Strobe (S)', 'Blackout (B)', 'Freeze (F)', 'Punch (P)']) await expect(within(panel).getByRole('button', { name })).toBeVisible();
    await expect(within(panel).getByRole('slider', { name: 'intensity' })).toBeVisible();
    for (const name of ['speed', 'hue', 'trails']) await expect(await within(panel).findByRole('slider', { name })).toBeVisible();
    await expect(within(panel).getByRole('button', { name: 'Back to normal' })).toBeVisible();
  },
};

/** The library map's panel and its button. */
const mapOf = (el: HTMLElement) => within(el).getByRole('complementary', { name: 'Library map' });
const mapButton = (el: HTMLElement) => within(el).getByRole('button', { name: 'Library map' });
/** What played this session before Warm-up's third preset (the deck's current): the map's dashed trail has somewhere to go. */
const PLAYED = [WARM_UP.items[5].path, WARM_UP.items[0].path, WARM_UP.items[1].path, WARM_UP.items[2].path];

/**
 * Wireframe D: G opens the library map at the right, 20px in and 64px down, with the session's
 * trail dashed through what played; the header's map button pressed. A dot picked from the
 * keyboard (→ then Enter on the field) plays, the lit dot moving to it; a short Esc puts the map
 * away and gives focus back to the map button.
 */
export const MapOpen: Story = {
  name: 'Map open',
  beforeEach: () => resetTrail(PLAYED),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(root(canvasElement)).toBeInTheDocument());
    await userEvent.keyboard('g');
    const map = await waitFor(() => mapOf(canvasElement));
    await expect(mapButton(canvasElement)).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(map.querySelector('.vs-field-trail')).not.toBeNull());
    // Another dot from the keyboard: the field's cursor starts on the preset playing; → moves it, Enter plays it.
    const field = await within(map).findByRole('listbox');
    await waitFor(() => expect(map.querySelector('.vs-field-lit')).not.toBeNull());
    const before = map.querySelector('.vs-field-lit')!.outerHTML;
    field.focus();
    await userEvent.keyboard('{ArrowRight}');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(map.querySelector('.vs-field-lit')?.outerHTML).not.toBe(before));
    await waitFor(() => expect(within(map).getByRole('option')).toHaveAccessibleName(/playing$/));
    // A short Esc (down and up) puts it away, and focus goes back to the map button.
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(within(canvasElement).queryByRole('complementary', { name: 'Library map' })).toBeNull());
    await expect(mapButton(canvasElement)).toHaveAttribute('aria-expanded', 'false');
    await expect(mapButton(canvasElement)).toHaveFocus();
  },
};

/** The map on other axes (intensity across, hue up, coloured by style): the pickers on its edges say so. */
export const MapOtherAxes: Story = {
  name: 'Map on other axes',
  beforeEach: () => {
    setMapAxes({ across: 'intensity', up: 'hue', colour: 'style' });
    return () => setMapAxes(DEFAULT_AXES);
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(root(canvasElement)).toBeInTheDocument());
    await userEvent.keyboard('g');
    const map = await waitFor(() => mapOf(canvasElement));
    await expect(within(map).getByRole('combobox', { name: /^Across/ })).toHaveTextContent('Intensity');
    await expect(within(map).getByRole('combobox', { name: /^Up/ })).toHaveTextContent('Hue');
  },
};

/** E and G: the effects panel at the left and the map at the right, both shown. */
async function effectsAndMap(canvasElement: HTMLElement) {
  await waitFor(() => expect(root(canvasElement)).toBeInTheDocument());
  await userEvent.keyboard('e');
  await userEvent.keyboard('g');
  const canvas = within(canvasElement);
  const effects = await canvas.findByRole('complementary', { name: 'Effects' });
  const map = await waitFor(() => mapOf(canvasElement));
  await waitFor(() => expect(effects).toBeVisible());
  await waitFor(() => expect(map).toBeVisible());
}

export const EffectsAndMap: Story = {
  name: 'Effects and map',
  play: async ({ canvasElement }) => effectsAndMap(canvasElement),
};

export const EffectsAndMapNarrow: Story = {
  name: 'Effects and map, 1000 × 700',
  parameters: { frame: { w: 1000, h: 700 } },
  play: async ({ canvasElement }) => effectsAndMap(canvasElement),
};

/** Pinned shown (`\`) at 1440 × 900, to judge the overlay's look. */
export const PinnedWide: Story = {
  name: 'Pinned, 1440 × 900',
  parameters: { frame: { w: 1440, h: 900 } },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(root(canvasElement)).toBeInTheDocument());
    await userEvent.keyboard('\\');
    await waitFor(() => expect(root(canvasElement).dataset.pinned).toBe(''));
  },
};

/** Pinned shown at 1000 × 700. */
export const PinnedNarrow: Story = {
  name: 'Pinned, 1000 × 700',
  parameters: { frame: { w: 1000, h: 700 } },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(root(canvasElement)).toBeInTheDocument());
    await userEvent.keyboard('\\');
    await waitFor(() => expect(root(canvasElement).dataset.pinned).toBe(''));
  },
};

/**
 * Esc held to leave live: "Hold Esc to leave live" with a ring filling over 3 s, the window fading
 * toward black under it (the output too, drawn by the app). Let go early, it goes back quickly
 * and the show carries on; held the whole 3 s, live is left as ever.
 */
const leftFor = fn();
export const EscHold: Story = {
  name: 'Esc held, let go, held',
  args: { onMode: leftFor },
  play: async ({ canvas, canvasElement }) => {
    leftFor.mockClear();
    await waitFor(() => expect(root(canvasElement)).toBeInTheDocument());
    (document.activeElement as HTMLElement | null)?.blur();
    const veil = () => canvasElement.querySelector('.vs-stagelayout-veil');
    // The hint while it is a status (the header has quiet statuses of its own).
    const hint = () => canvas.queryAllByRole('status').find((s) => s.textContent?.includes('Hold Esc to leave live')) ?? null;
    const user = userEvent.setup();
    // Held: the hint after a beat, the fade under it.
    await user.keyboard('{Escape>}');
    await waitFor(() => expect(hint()).toBeVisible());
    await expect(veil()).toHaveAttribute('data-holding');
    // Let go early: no longer a status at once, the fade turning back, the card gone soon after, and still live.
    await user.keyboard('{/Escape}');
    await waitFor(() => expect(hint()).toBeNull());
    await expect(veil()).not.toHaveAttribute('data-holding');
    await waitFor(() => expect(canvas.queryByText('Hold Esc to leave live')).toBeNull());
    await expect(leftFor).not.toHaveBeenCalled();
    // Held the whole hold: leaves live for the home, as ever.
    await user.keyboard('{Escape>}');
    await waitFor(() => expect(leftFor).toHaveBeenCalledTimes(1), { timeout: 4500 });
    await expect(leftFor.mock.calls[0][0]).toBe(HOME);
    await user.keyboard('{/Escape}');
  },
};

/** Mid-set: HOLD on, speed up, the mirror and trails on. */
export const Busy: Story = {
  parameters: { world: { fx: FX_BUSY, lists: { ...LISTS, deck: { ...PLAYING_DECK, hold: true } } } },
};

/** One display: played in the window, the Output popover offering to cover it with the picture. */
export const OneDisplay: Story = {
  parameters: { world: { displays: [{ id: 1, index: 0, name: 'Built-in Retina Display', width: 3024, height: 1964, main: true }] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(root(canvasElement).dataset.windowed).toBe(''));
    await userEvent.click(await canvas.findByRole('button', { name: 'Output, in this window' }));
    const go = await within(canvas.getByRole('dialog')).findByRole('button', { name: 'Go full screen on Built-in Retina Display' });
    await waitFor(() => expect(go).toBeVisible());
  },
};

/** Started in live mode (`VISUALS_LIVE=1`): the one way in that opens the output by itself, on the projector. */
export const StartedLive: Story = {
  args: { windowed: false },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(root(canvasElement).dataset.windowed).toBeUndefined());
  },
};

/** Nothing playing yet and no playlist: live picks one at random. */
export const FromNothing: Story = {
  parameters: { world: { lists: { playlists: [WARM_UP], deck: { ...PLAYING_DECK, playlist: null, index: null, current: null, next: null, next_index: null, count: 0, settings: null } } } },
};
