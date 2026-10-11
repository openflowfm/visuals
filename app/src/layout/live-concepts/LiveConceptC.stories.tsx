import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { DISPLAYS, FX_BUSY, LISTS, PLAYING_DECK } from '../../stories/fixtures.ts';
import { ConceptFrame } from './ConceptFrame.tsx';

/**
 * **Concept C, "One frame".** Live is Home's own window with another main
 * pane: the inset sidebar, the header, the picture, the transport bar and the
 * inspector stay where Home has them (the same nodes, so nothing moves when
 * you switch), and the header's home|live swaps only what sits under the
 * picture: Home's grid, or the performing pane.
 *
 * **What moved where, against today's Live.** The status strip's lights (the
 * beat with tap tempo and Ableton Link, where the picture goes) are in Home's
 * header as popovers, with help (?) beside them; leaving is the header's
 * home|live; settings is the sidebar's foot, as in Home. Now playing and where
 * from are the transport bar's; Previous, Next and Random are its keys, and its
 * play/pause is HOLD. The big pads (Hold, Strobe, Blackout, Freeze), Intensity
 * and More effects are the pane's first row, nearest the picture. The crate's
 * playlists are the sidebar's rows: in live a row PLAYS its playlist (in home
 * it browses). Up next is a row of Home's tiles, the first marked Next with
 * when it comes (in beats on Link, else every n s) and where from; a tile
 * plays now. The moods are chips under it. "Full screen on…" is the pane's
 * first line when playing in the window, never over the picture. The
 * flashing warning, owed, is a card in the pane: the picture stays blank and
 * the bar and lights inert until "I understand". The inspector shows the
 * preset playing, with its star, tags and per-preset tune, in live too.
 *
 * **Unresolved.** A sidebar click plays in live and browses in home: one
 * gesture, two meanings, a trap for a performer who meant to look (a
 * double-click to play, as Home has, would be safer but slower on stage).
 * With the hero at half the column, the pane gets what is left (about 320 px
 * at 900 tall): the pads and one row of up next fit, the moods scroll; a
 * smaller hero in live, or the pads beside the picture, would give them more.
 * Up next can't be reordered here (the crate's drag); the keys (Live's
 * `useLiveKeys`) are not wired in the story. Going home doesn't close the
 * output in the story (today leaving live does): should it, in one frame?
 *
 * **The native preview.** Feasible as is: the picture is Home's own hole (the
 * hero's `Preview`), switching views keeps the same node in the same place,
 * so the native view is never re-placed; nothing paints under it (the pane
 * sits below it, the help panel over it is opaque and has no scrim).
 */
const meta = {
  title: 'Live/Concepts/C One frame',
  component: ConceptFrame,
  args: { width: 1440, view: 'live', prefs: { sidebar: null, inspector: null } },
  argTypes: { view: { control: 'inline-radio', options: ['home', 'live'] } },
  parameters: { scope: 'bare', layout: 'fullscreen' },
} satisfies Meta<typeof ConceptFrame>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Playing Warm-up at 1440×900, the output on the projector: the pads act, up next and the moods show, the inspector is about the preset playing. */
export const Live: Story = {
  play: async ({ canvas }) => {
    const pane = await canvas.findByRole('region', { name: 'live' });
    await expect(await within(pane).findByRole('button', { name: /^Next: / })).toBeVisible();
    await expect(await canvas.findByRole('button', { name: 'Where the picture goes' })).toHaveTextContent(/Projector/);
    await expect(canvas.getByRole('complementary', { name: 'about the preset' })).toBeVisible();
    const hold = within(pane).getByRole('button', { name: /^Hold/ });
    await userEvent.click(hold);
    await waitFor(() => expect(within(pane).getByRole('button', { name: /^Hold/ })).toHaveAttribute('aria-pressed', 'true'));
    await expect(canvas.getByRole('button', { name: 'play' })).toBeVisible();
    await expect(within(pane).getByRole('slider', { name: 'Intensity' })).toBeVisible();
  },
};

/** At 800 wide: the sidebar and the inspector put away (`modesFor`), the pads in one column with Intensity under them. */
export const Narrow: Story = {
  args: { width: 800 },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('region', { name: 'live' })).toBeVisible();
    await expect(canvas.queryByRole('navigation', { name: 'sources' })).toBeNull();
    await expect(canvas.queryByRole('complementary')).toBeNull();
    await expect(canvas.getByRole('region', { name: 'transport' })).toBeVisible();
  },
};

/** Starts live; home swaps the pane for the grid, and the sidebar, the picture and the bar are the same nodes throughout. */
export const SwitchToHome: Story = {
  name: 'Switch to home',
  play: async ({ canvas, canvasElement }) => {
    await canvas.findByRole('region', { name: 'live' });
    const nodes = () => [canvasElement.querySelector('.lay-side'), canvasElement.querySelector('.hero-pic'), canvasElement.querySelector('.lay-transport')];
    const before = nodes();
    for (const n of before) await expect(n).not.toBeNull();
    await userEvent.click(canvas.getByRole('radio', { name: 'home' }));
    await expect(await canvas.findByRole('region', { name: 'Library' })).toBeVisible();
    await expect(canvas.queryByRole('region', { name: 'live' })).toBeNull();
    nodes().forEach((n, i) => expect(n).toBe(before[i]));
    await userEvent.click(canvas.getByRole('radio', { name: 'live' }));
    await expect(await canvas.findByRole('region', { name: 'live' })).toBeVisible();
    nodes().forEach((n, i) => expect(n).toBe(before[i]));
  },
};

/** One display: playing in the window, "Full screen on…" heads the pane, under the picture. */
export const Windowed: Story = {
  parameters: { tauri: { displays: [DISPLAYS[0]] } },
  play: async ({ canvas, canvasElement }) => {
    const go = await canvas.findByRole('button', { name: `Go full screen on ${DISPLAYS[0].name}` });
    const pic = canvasElement.querySelector('.hero-pic')!.getBoundingClientRect();
    await expect(go.getBoundingClientRect().top).toBeGreaterThanOrEqual(pic.bottom);
    await expect(canvas.getByRole('button', { name: 'Where the picture goes' })).toHaveTextContent(/In this window/);
  },
};

/** Mid-set: HOLD on and the effects busy. */
export const Busy: Story = {
  parameters: { tauri: { fx: FX_BUSY, lists: { ...LISTS, deck: { ...PLAYING_DECK, hold: true } } } },
  play: async ({ canvas }) => {
    const pane = await canvas.findByRole('region', { name: 'live' });
    await waitFor(() => expect(within(pane).getByRole('button', { name: /^Hold/ })).toHaveAttribute('aria-pressed', 'true'));
    await expect(canvas.getByRole('button', { name: 'play' })).toBeVisible();
  },
};

/** Starts in home with the warning owed: live shows the card in the pane, the picture blank and the bar inert, until "I understand". */
export const WarningOwed: Story = {
  name: 'Warning owed',
  args: { view: 'home', warning: true },
  play: async ({ canvas, canvasElement }) => {
    await canvas.findByRole('region', { name: 'Library' });
    await userEvent.click(canvas.getByRole('radio', { name: 'live' }));
    const card = await canvas.findByRole('alertdialog', { name: 'Flashing lights' });
    await expect(card).toBeVisible();
    await expect(canvasElement.querySelector('.hero-pic img')).toBeNull();
    await expect(canvasElement.querySelector('.cf-bar')).toHaveAttribute('inert');
    await userEvent.click(within(card).getByRole('button', { name: 'I understand' }));
    await expect(await canvas.findByRole('region', { name: 'live' })).toBeVisible();
    await expect(canvasElement.querySelector('.cf-bar')).not.toHaveAttribute('inert');
  },
};
