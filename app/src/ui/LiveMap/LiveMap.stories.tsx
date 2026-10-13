import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { Opaque } from '@satoramoto/zen';
import { withLibraryTheme } from '@satoramoto/zen/storybook';
import { ROWS, WARM_UP } from '../fixtures/fixtures';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import { DEFAULT_AXES } from '../model/field';
import { setMapAxes } from '../model/mapPrefs';
import { resetTrail, useSessionTrail } from '../model/trail';
import { useLive } from '../model/useLive';
import { LIVE_MAP_LABEL, LiveMap } from './LiveMap';
import { resetLiveMapScope } from './scope';

/** The trail the stories start with: a few of Warm-up's presets, played before the one playing (its third). */
const TRAIL = [0, 5, 1, 7].map((i) => WARM_UP.items[i].path);

/** How many of Warm-up's presets the map draws: each library preset once. */
const SET_COUNT = new Set(WARM_UP.items.map((i) => ROWS.find((r) => r.path === i.path)?.key).filter(Boolean)).size;

/**
 * The panel where the Stage docks it: 20px in from the right of a 1280 × 720 window, from 64px
 * down to 100px over the foot, 380px wide, over the frame's still standing in for the native
 * picture, on the stories' fake app (`useLive` playing Warm-up), so a dot picked really plays.
 */
function Window() {
  const live = useLive({ start: null });
  const trail = useSessionTrail(live.current);
  return (
    <Opaque>
      <div style={{ position: 'relative', width: 1280, height: 720, background: 'var(--vs-still) center / cover var(--key-black)' }}>
        <div style={{ position: 'absolute', top: 64, bottom: 100, right: 20, width: 380, display: 'flex', flexDirection: 'column' }}>
          <LiveMap live={live} trail={trail} onClose={() => {}} />
        </div>
      </div>
    </Opaque>
  );
}

/**
 * **Live's map panel** (wireframe D): the Effects panel's frame at the Stage's right. "Map", what
 * it shows and how many, the colour picker and ✕; This set | Library; the field of those presets
 * by the map's axes, the one playing lit and the session's trail dashed through the ones played.
 */
const meta = {
  title: 'open[flow]/visuals/Live/Map panel',
  component: Window,
  decorators: [withVisualsFrame, withLibraryTheme],
  globals: VISUALS_GLOBALS,
  // The trail and the scope are the page's session's (module state): each story starts them over.
  beforeEach: (ctx) => {
    resetTrail(TRAIL);
    resetLiveMapScope();
    return visualsBeforeEach(ctx);
  },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Window>;
export default meta;
type Story = StoryObj<typeof meta>;

const panelOf = async (canvasElement: HTMLElement) => within(canvasElement).findByRole('complementary', { name: LIVE_MAP_LABEL });

/** This set: Warm-up's presets, the trail dashed through them; a dot picked plays at once and lights. */
export const ThisSet: Story = {
  name: 'This set, with a trail',
  play: async ({ canvasElement }) => {
    const panel = await panelOf(canvasElement);
    const p = within(panel);
    await waitFor(() => expect(panel).toHaveTextContent(`this set · ${SET_COUNT}`));
    await expect(p.getByRole('radio', { name: 'This set' })).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(panel.querySelector('.vs-field-trail')).not.toBeNull());
    await waitFor(() => expect(panel.querySelector('.vs-field-lit')).not.toBeNull());
    const field = p.getByRole('listbox');
    await expect(field).toHaveAccessibleName(/^This set by /);
    // The keyboard's cursor starts on the preset playing; a step moves it to another dot, Enter plays that one.
    field.focus();
    await waitFor(() => expect(p.getByRole('option')).toHaveAttribute('aria-selected', 'true'));
    await userEvent.keyboard('{ArrowRight}');
    // The rightmost dot plays: step the other way.
    if (p.getByRole('option').getAttribute('aria-selected') === 'true') await userEvent.keyboard('{ArrowLeft}');
    await expect(p.getByRole('option')).toHaveAttribute('aria-selected', 'false');
    // The lit dot's point (its cursor lines span the whole plot, so the group's box never moves).
    const point = () => panel.querySelector('.vs-field-point')!.getBoundingClientRect();
    const lit = point();
    const name = p.getByRole('option').textContent;
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(p.getByRole('option')).toHaveAttribute('aria-selected', 'true'));
    await expect(p.getByRole('option').textContent).toBe(`${name}, playing`);
    const now = point();
    await expect(now.left !== lit.left || now.top !== lit.top).toBe(true);
  },
};

/** The whole library: the switch to Library shows every preset. */
export const Library: Story = {
  play: async ({ canvasElement }) => {
    const panel = await panelOf(canvasElement);
    const p = within(panel);
    await waitFor(() => expect(panel).toHaveTextContent(`this set · ${SET_COUNT}`));
    await userEvent.click(p.getByRole('radio', { name: 'Library' }));
    await waitFor(() => expect(panel).toHaveTextContent(`library · ${ROWS.length}`));
    await expect(p.getByRole('listbox')).toHaveAccessibleName(/^The library by /);
  },
};

/** Other axes: intensity across, hue up, coloured by style (shared with Home's map). */
export const OtherAxes: Story = {
  name: 'Other axes',
  beforeEach: () => {
    setMapAxes({ across: 'intensity', up: 'hue', colour: 'style' });
    return () => setMapAxes(DEFAULT_AXES);
  },
  play: async ({ canvasElement }) => {
    const panel = await panelOf(canvasElement);
    const p = within(panel);
    await expect(p.getByRole('listbox')).toHaveAccessibleName('This set by intensity and hue');
    await expect(panel).toHaveTextContent(/Intensity/);
    await expect(panel).toHaveTextContent(/Hue/);
  },
};
