import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { DISPLAYS, FX_BUSY, LISTS, PLAYING_DECK } from '../../stories/fixtures.ts';
import { ConceptShell } from './ConceptShell.tsx';

/**
 * Concept A, "Home's shell": the Live view built from Home's own window, so
 * the two pages are one app — the same inset sidebar, header row, pinned
 * picture, transport bar and inspector, with the performing controls where
 * Home's grid is.
 *
 * **What moved, against today's Live.** The status strip → the header: the
 * beat and the output are lights in it (Home's popovers holding tap tempo and
 * Ableton Link, and the output's display choice), then help, settings and the
 * inspector's toggle; leaving is the header's Home | Live switch, as on Home.
 * The preview → the hero, pinned, the picture alone at 16:9, never more than
 * half the column; "Full screen on…" sits under it, never over it. The deck's
 * pads (previous, random, next) → the transport bar, as Home steps (play/pause
 * is HOLD), which also says what plays, from where, and the audio input. The
 * effect pads (Hold, Strobe, Blackout, Freeze), Intensity and More effects →
 * the main column under the picture, big raised tiles, with now and next above
 * them. The crate → the inset sidebar, drawn as Home's: the mark at its top,
 * playlists as its rows (one tap plays; the one playing is the pill with its
 * green dot), moods as soft pills, up next as quiet rows that still drag into
 * a new order (or Alt+↑ ↓) and "Show all". The inspector (new to Live) shows
 * the playing preset as Home's does: its field, character, tags, and its own
 * speed and sensitivity. The flashing warning, owed, holds the picture's place
 * as an opaque card; everything else waits, faded and inert.
 *
 * **Why the crate rather than InsetSidebar.** The crate already does what
 * Live needs and Home's sidebar doesn't (moods mixing, up next with its
 * reorder), and its playlists play on one tap rather than pick a pane; the
 * concept keeps it and draws it in the sidebar's look (`concept-shell.css`).
 * If chosen, the playlists' rows would move onto InsetSidebar's rows (and
 * their menus) with moods and up next as sections of it.
 *
 * **Unresolved.** The Hold pad and the bar's play/pause are the same thing
 * twice. Now playing is said both in the bar and above the pads. The More
 * effects sheet's look (still the old widgets) isn't Home's yet, nor are the
 * help overlay's. At 800 px the crate is only an overlay, so playlists are a
 * tap further away than in today's Live. Live's keys (useLiveKeys) aren't
 * wired in the story.
 *
 * **The native preview.** Feasible as is: this is Home's layout, whose hero
 * already holds the NSView preview (`<Preview className="hero-pic" />`) — it
 * never scrolls, nothing paints under it (the column is painted by its spread
 * shadow), and what is laid over it (the sidebar or inspector at narrow
 * widths, the warning card) is opaque. Only the full-screen offer is new, and
 * it sits in the main column, under the hole.
 */
const meta = {
  title: 'Live/Concepts/A Home shell',
  component: ConceptShell,
  args: { width: 1440, prefs: { sidebar: null, inspector: null }, onMode: fn() },
  parameters: { scope: 'bare', layout: 'fullscreen' },
  globals: { viewport: { value: 'home1440', isRotated: false } },
} satisfies Meta<typeof ConceptShell>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The functions every concept story has: the pads, Intensity, More effects, the bar. */
async function performable(canvas: ReturnType<typeof within>) {
  const effects = canvas.getByRole('group', { name: 'Effects' });
  for (const name of [/^Hold/, /^Strobe/, /^Blackout/, /^Freeze/]) await expect(within(effects).getByRole('button', { name })).toBeVisible();
  await expect(canvas.getByRole('slider', { name: 'Intensity' })).toBeVisible();
  await expect(canvas.getByRole('button', { name: /More effects/ })).toBeVisible();
  await expect(canvas.getByRole('region', { name: 'transport' })).toBeVisible();
}

/** 1440×900, playing Warm-up with the output on the projector: the crate docked, the inspector on the preset playing. */
export const Wide: Story = {
  play: async ({ canvas, args }) => {
    const crate = canvas.getByRole('navigation', { name: 'crate' });
    await expect(await within(crate).findByRole('button', { name: /^Warm-up/, current: true })).toBeVisible();
    await expect(within(crate).getByRole('heading', { name: 'Up next' })).toBeVisible();
    await expect(await canvas.findByText('Projector (HDMI)')).toBeVisible();
    await expect(await canvas.findByText(/124 BPM/)).toBeVisible();
    await expect(canvas.getByRole('region', { name: 'now playing' })).toBeVisible();
    await expect(canvas.getByRole('complementary')).toBeVisible();
    await performable(canvas);
    // Hold lights its pad, and the bar's play/pause (which is HOLD) follows.
    await userEvent.click(within(canvas.getByRole('group', { name: 'Effects' })).getByRole('button', { name: /^Hold/ }));
    await waitFor(() => expect(within(canvas.getByRole('group', { name: 'Effects' })).getByRole('button', { name: /^Hold/ })).toHaveAttribute('aria-pressed', 'true'));
    // Help opens over everything; the switch leaves for Home.
    await userEvent.click(canvas.getByRole('button', { name: 'help' }));
    await expect(await canvas.findByRole('dialog', { name: 'Live controls' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(canvas.queryByRole('dialog', { name: 'Live controls' })).toBeNull());
    await expect(canvas.getByRole('button', { name: 'settings' })).toBeVisible();
    await userEvent.click(canvas.getByRole('radio', { name: /home/i }));
    await expect(args.onMode).toHaveBeenCalledWith('home');
  },
};

/** 800 wide: the crate and the inspector put away, each laid over the column (opaque) from its toggle. */
export const Narrow: Story = {
  args: { width: 800 },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('navigation', { name: 'crate' })).toBeNull();
    await expect(canvas.queryByRole('complementary')).toBeNull();
    await performable(canvas);
    await userEvent.click(canvas.getByRole('button', { name: 'crate' }));
    const crate = await canvas.findByRole('navigation', { name: 'crate' });
    await expect(await within(crate).findByRole('button', { name: /^Warm-up/ })).toBeVisible();
    const paint = getComputedStyle(crate).backgroundColor;
    await expect(paint).not.toBe('rgba(0, 0, 0, 0)');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(canvas.queryByRole('navigation', { name: 'crate' })).toBeNull());
  },
};

/** One display: playing in the window, "Full screen on…" under the picture, the output light amber. */
export const Windowed: Story = {
  args: { windowed: true },
  parameters: { tauri: { displays: [DISPLAYS[0]] } },
  play: async ({ canvas, canvasElement }) => {
    const go = await canvas.findByRole('button', { name: `Go full screen on ${DISPLAYS[0].name}` });
    await expect(go).toBeVisible();
    await expect(canvas.getByText(/the picture will cover this window/)).toBeVisible();
    await expect(canvas.getByText('In this window')).toBeVisible();
    // Under the picture, never over it.
    const pic = canvasElement.querySelector('.hero-pic')!.getBoundingClientRect();
    await expect(go.getBoundingClientRect().top).toBeGreaterThanOrEqual(pic.bottom);
    await performable(canvas);
  },
};

/** Mid-set: HOLD on and the effects busy. */
export const Busy: Story = {
  parameters: { tauri: { fx: FX_BUSY, lists: { ...LISTS, deck: { ...PLAYING_DECK, hold: true } } } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Hold', { selector: '.lc-held' })).toBeVisible();
    await waitFor(() => expect(within(canvas.getByRole('group', { name: 'Effects' })).getByRole('button', { name: /^Hold/ })).toHaveAttribute('aria-pressed', 'true'));
    await expect(canvas.getByText(/held — nothing changes/)).toBeVisible();
    await performable(canvas);
  },
};

/** The flashing warning owed: the card holds the picture's place, nothing plays, and the controls wait for "I understand". */
export const WarningOwed: Story = {
  name: 'Warning owed',
  args: { warning: true },
  play: async ({ canvas, canvasElement }) => {
    const card = await canvas.findByRole('alertdialog', { name: 'Flashing lights' });
    await expect(card).toBeVisible();
    await expect(canvasElement.querySelector('.hero-pic img')).toBeNull();
    await expect(canvas.getByText(/Live waits for the warning/)).toBeVisible();
    // Inert: the pads, the crate and the bar aren't reachable.
    await expect(canvas.getByRole('group', { name: 'Effects' }).closest('[inert]')).not.toBeNull();
    await expect(canvas.getByRole('region', { name: 'transport' }).closest('[inert]')).not.toBeNull();
    await userEvent.click(within(card).getByRole('button', { name: 'I understand' }));
    await waitFor(() => expect(canvas.queryByRole('alertdialog')).toBeNull());
    await expect(canvas.getByRole('group', { name: 'Effects' }).closest('[inert]')).toBeNull();
    await expect(canvasElement.querySelector('.hero-pic img')).not.toBeNull();
  },
};
