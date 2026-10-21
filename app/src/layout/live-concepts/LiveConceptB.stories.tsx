import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { DISPLAYS, FX_BUSY, LISTS, PLAYING_DECK, STILL } from '../../stories/fixtures.ts';
import { ConceptStage } from './ConceptStage.tsx';

/** The window's width, the crate's starting state, and whether the flashing warning is owed. */
interface Args {
  width: number;
  crate: boolean | null;
  warning: boolean;
}

/** The whole window, `width` × 900, on the stories' fake app. */
function Window({ width, crate, warning }: Args) {
  return (
    <div style={{ width, height: 900 }}>
      <ConceptStage width={width} picture={STILL} crate={crate} warning={warning} />
    </div>
  );
}

/**
 * **Concept B, "Stage".** The output picture full-bleed across the whole window,
 * and Home's inset panels floating over it: the same tokens, glyphs, type and
 * words, so Live reads as Home with the picture turned up.
 *
 * What moved where, against today's Live:
 * - **The status strip** splits into two opaque capsules in the title bar's row:
 *   the window buttons, the crate's toggle and home|live on the left; the beat
 *   (tap and Link in its popover), the output (its display choice in its
 *   popover), help and settings on the right.
 * - **Now and next, the pads and Intensity** become Home's transport bar,
 *   docked along the bottom as an inset panel (8px in, 18px corners): ◀ ⏸ ▶ R
 *   with play/pause as HOLD, the preset playing and where from, the time on it,
 *   the audio input — exactly Home's bar. A second row under it holds what Home
 *   doesn't have: the deck's Next (and when: "in 3 beats"), the star and rating,
 *   Strobe, Blackout and Freeze as keys with their key letters, Intensity and
 *   More effects. Under about 940px of dock the effect keys drop their names.
 * - **The crate** is Home's inset sidebar down the left, its 52px band holding
 *   the window buttons and the wordmark under it: playlists as rows (the
 *   playing one the pill with its green dot), moods as soft chips, up next
 *   (still draggable). From 1100px wide it docks (the header and dock keep
 *   clear of it); narrower it is laid over the picture and starts put away, as
 *   Home's sidebar does; Escape or a press outside puts it away.
 * - **"Go full screen on…"** floats top-centre in a capsule; **the warning**
 *   owed leaves the window dark (nothing plays), its card centred, the crate
 *   and the dock inert and dimmed until "I understand".
 *
 * Unresolved: auto-hiding the panels while performing (the picture is the
 * point; a still mouse could fade the header and the crate, leaving the dock);
 * the picture's crop: it is cover-fitted to the whole window, so the crate and
 * the dock hide its left and bottom edges (about 20% of the area at 1440) —
 * the output on the projector shows all of it, but in the window (one display)
 * what the audience sees isn't what the performer sees; HOLD is the transport's
 * pause glyph, which says "pause" rather than "hold" (the Next line says
 * "held" and a Hold pill shows); the keys aren't wired here (Live's
 * `useLiveKeys` would be); the silence banner has no place yet.
 *
 * Feasible with the native preview: yes. The preview NSView is placed under
 * the WKWebView over the whole window (the hole is the window), and the page
 * paints only the panels, each opaque `--surface-corner` (no
 * `backdrop-filter`: a blur never reaches the native view, and translucent
 * paint would show the picture through unblurred). Hit-testing is the web
 * view's: it is on top, so presses on the bare picture land on the page's root
 * (nothing there but the header row's drag region). The window's frost
 * material does nothing here: the picture covers it everywhere, so the panels
 * look like the story's flat dark glass rather than Home's frosted sidebar —
 * that is what's lost against Home's look, along with any blur. The rounded
 * panels' corners over the picture are page paint, so they stay crisp.
 */
const meta = {
  title: 'Live/Concepts/B Stage',
  component: Window,
  args: { width: 1440, crate: null, warning: false },
  parameters: { scope: 'bare', layout: 'fullscreen' },
} satisfies Meta<typeof Window>;
export default meta;
type Story = StoryObj<typeof meta>;

const crate = (el: HTMLElement) => within(el).queryByRole('navigation', { name: 'crate' });

/** At 1440×900, playing Warm-up, the output on the projector: the crate docked, every control in its place. */
export const Wide: Story = {
  play: async ({ canvas, canvasElement }) => {
    await expect(await canvas.findByText('Projector (HDMI)')).toBeVisible();
    await expect(crate(canvasElement)).toBeVisible();
    await expect(await canvas.findByRole('button', { name: /^Warm-up/, current: true })).toBeVisible();
    await expect(canvas.getByRole('heading', { name: 'Up next' })).toBeVisible();
    const transport = canvas.getByRole('region', { name: 'transport' });
    await expect(transport).toHaveTextContent(/from Warm-up/);
    for (const name of ['previous preset', 'pause', 'next preset', 'random preset', 'help', 'settings', 'crate']) await expect(canvas.getByRole('button', { name })).toBeVisible();
    for (const name of [/^Strobe/, /^Blackout/, /^Freeze/, /More effects/]) await expect(canvas.getByRole('button', { name })).toBeVisible();
    await expect(canvas.getByRole('slider', { name: 'Intensity' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: /Tempo/ })).toBeVisible();
    await expect(canvas.getByText('Next', { selector: '.lc-next-label' })).toBeVisible();
    // Hold is the transport's pause.
    await userEvent.click(canvas.getByRole('button', { name: 'pause' }));
    await expect(await canvas.findByRole('button', { name: 'play' })).toBeVisible();
    // Help opens over it.
    await userEvent.click(canvas.getByRole('button', { name: 'help' }));
    await expect(await canvas.findByRole('dialog')).toBeVisible();
    // Escape puts it away again, leaving the stage as it was.
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(canvas.queryByRole('dialog')).toBeNull());
  },
};

/** At 800: the crate starts put away; its toggle lays it over the picture and Escape puts it away. The dock still fits, in two rows. */
export const Narrow: Story = {
  args: { width: 800 },
  play: async ({ canvas, canvasElement }) => {
    await expect(await canvas.findByText('Projector (HDMI)')).toBeVisible();
    await expect(crate(canvasElement)).toBeNull();
    const dock = canvas.getByRole('region', { name: 'Live controls' });
    await expect(dock.scrollWidth).toBeLessThanOrEqual(dock.clientWidth);
    await expect(canvas.getByRole('slider', { name: 'Intensity' })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'crate' }));
    await waitFor(() => expect(crate(canvasElement)).toBeVisible());
    await expect(canvasElement.querySelector('.lcs')).toHaveAttribute('data-crate', 'overlay');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(crate(canvasElement)).toBeNull());
  },
};

/** At 1440 with the crate folded away: the picture runs to the left edge, the window buttons in the header's capsule. */
export const CrateHidden: Story = {
  args: { crate: false },
  play: async ({ canvas, canvasElement }) => {
    await expect(await canvas.findByText('Projector (HDMI)')).toBeVisible();
    await expect(crate(canvasElement)).toBeNull();
    const toggle = canvas.getByRole('button', { name: 'crate' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    await waitFor(() => expect(crate(canvasElement)).toBeVisible());
    await expect(canvasElement.querySelector('.lcs')).toHaveAttribute('data-crate', 'docked');
  },
};

/** One display: played in the window, "Go full screen on…" floating top-centre. */
export const Windowed: Story = {
  parameters: { tauri: { displays: [DISPLAYS[0]] } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('button', { name: `Go full screen on ${DISPLAYS[0].name}` })).toBeVisible();
    await expect(canvas.getByText(/One display/)).toBeVisible();
    await expect(canvas.getByText('In this window')).toBeVisible();
  },
};

/** Mid-set: HOLD on and the effects busy; the transport shows play, Next says held. */
export const Busy: Story = {
  parameters: { tauri: { fx: FX_BUSY, lists: { ...LISTS, deck: { ...PLAYING_DECK, hold: true } } } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('button', { name: 'play' })).toBeVisible();
    await expect(await canvas.findByText('Hold', { selector: '.lc-held' })).toBeVisible();
    await expect(canvas.getByText(/^held/)).toBeVisible();
  },
};

/** The flashing warning owed: no picture, the card centred, the controls inert until "I understand". */
export const WarningOwed: Story = {
  args: { warning: true },
  play: async ({ canvas, canvasElement }) => {
    await expect(await canvas.findByRole('alertdialog', { name: 'Flashing lights' })).toBeVisible();
    await expect(canvas.queryByRole('img', { name: /of the playing preset/ })).toBeNull();
    await expect(canvasElement.querySelector('.lcs-dock')).toHaveAttribute('inert');
    await userEvent.click(canvas.getByRole('button', { name: 'I understand' }));
    await waitFor(() => expect(canvas.queryByRole('alertdialog')).toBeNull());
    await expect(canvas.getByRole('img', { name: /of the playing preset/ })).toBeVisible();
    await expect(canvasElement.querySelector('.lcs-dock')).not.toHaveAttribute('inert');
  },
};
