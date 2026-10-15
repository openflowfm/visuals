import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fireEvent, userEvent, waitFor } from 'storybook/test';
import { withLibraryTheme } from '@satoramoto/zen/storybook';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import type { Pane } from '../model/home';
import { Header } from '../Views/Views';
import { HomeLayout, homeDocks, INSPECTOR_ID, PanelToggle, SIDEBAR_ID, useLayoutPrinciples } from './HomeLayout';
import { InsetSidebar } from '../InsetSidebar/InsetSidebar';
import { Hero } from '../Hero/Hero';
import { tileName } from '../PresetTile/PresetTile';
import { StoryGrid } from '../fixtures/StoryGrid';
import { TransportBar } from '../TransportBar/TransportBar';
import { modesFor, type LayoutPrefs } from '../model/home-model';
import { mark } from '../model/access';
import { NOW, SIDEBAR, STARRED } from '../fixtures/layout';
import { ROWS, WARM_UP } from '../fixtures/fixtures';

/** The window's width, and what the viewer chose (home-model's `LayoutPrefs`): the story starts from these. */
interface Args {
  width: number;
  prefs: LayoutPrefs;
}

/**
 * The whole window on the fixtures, a window `width` wide whatever the
 * runner's viewport: the header's toggles show and hide the sidebar and the
 * inspector, and a panel laid over the main column goes on Escape or a press
 * outside it, as Home wires them (`modesFor`); the sidebar's selection and
 * folding work; the rest does nothing. (The original's header also had a
 * settings cog; the visuals principles keep Settings out of the header.)
 */
function Composed({ width, prefs: start }: Args) {
  const [prefs, setPrefs] = useState(start);
  // Where the panels dock is the assembled home's answer for this window, as Home asks it.
  const modes = modesFor(homeDocks({ w: width, h: 900 }, useLayoutPrinciples()), prefs);
  // The playlist playing is the one picked, as the kit's example has a folder picked.
  const [selected, setSelected] = useState<Pane | null>({ kind: 'list', id: WARM_UP.id });
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const toggle = (id: string) => setCollapsed((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const sideShown = modes.sidebar !== 'hidden';
  const inspOpen = modes.inspector !== null;
  return (
    <div style={{ width, height: 900 }}>
      <HomeLayout
        lights
        sidebarMode={modes.sidebar}
        inspectorMode={modes.inspector}
        onDismiss={() =>
          setPrefs((p) => ({
            sidebar: modes.sidebar === 'overlay' ? false : p.sidebar,
            inspector: modes.inspector === 'overlay' ? false : p.inspector,
          }))
        }
        sidebar={<InsetSidebar sections={SIDEBAR} selected={selected} onSelect={setSelected} collapsed={collapsed} onToggle={toggle} />}
        header={
          <Header
            view="home"
            onChange={() => {}}
            lead={
              <PanelToggle
                panel="sidebar"
                name="sidebar"
                controls={SIDEBAR_ID}
                open={sideShown}
                title={sideShown ? 'Hide the sidebar' : 'Show the sidebar'}
                onPress={() => setPrefs((p) => ({ ...p, sidebar: !sideShown }))}
              />
            }
          >
            <span className="vs-fill" />
            <PanelToggle
              panel="inspector"
              name="show the preset's details"
              controls={INSPECTOR_ID}
              open={inspOpen}
              title={inspOpen ? 'Hide the details' : 'Show the details'}
              onPress={() => setPrefs((p) => ({ ...p, inspector: !inspOpen }))}
            />
          </Header>
        }
        hero={
          <Hero
            picture={NOW.picture}
            controls={
              <TransportBar
                layout="overlay"
                playing={NOW.playing}
                onPlayPause={() => {}}
                onStep={() => {}}
                stepIn=" in the playlist"
                position={{ elapsed: 12, length: 30 }}
                onAudioError={() => {}}
                now={NOW.preset ? { name: tileName(NOW.preset.title, NOW.preset.path), from: NOW.from } : null}
              />
            }
          />
        }
        inspector={
          <div style={{ padding: '20px 18px' }}>
            <p style={{ margin: '0 0 6px', color: 'var(--text-4)', fontSize: 11 }}>About the preset</p>
            <h2 style={{ margin: 0, fontSize: 17, color: 'var(--text-1)' }}>{NOW.preset?.title}</h2>
            <p style={{ margin: '6px 0 0', color: 'var(--text-3)', fontSize: 12 }}>The inspector's own story (Layout/Inspector) shows what goes here.</p>
          </div>
        }
      >
        <StoryGrid title="Library" rows={ROWS} playing={NOW.path} starred={STARRED} />
      </HomeLayout>
    </div>
  );
}

/**
 * Home as an inspector view, in the app's own look: the header row across the
 * window, the inset sidebar, the main column with the Now Playing hero pinned
 * and the presets' tiles scrolling under it, the transport bar, and the
 * inspector down the right, each panel docked, laid over the column or put away
 * as the window's width and the viewer's choices say.
 */
const meta = {
  title: 'open[flow]/visuals/Layout/Home, macOS layout',
  component: Composed,
  args: { width: 1440, prefs: { sidebar: null, inspector: false } },
  decorators: [withVisualsFrame, withLibraryTheme],
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
  parameters: { scope: 'bare', layout: 'fullscreen' },
} satisfies Meta<typeof Composed>;
export default meta;
type Story = StoryObj<typeof meta>;

const root = (el: HTMLElement) => el.querySelector('.vs-lay') as HTMLElement;

/** At 1440×900, the sidebar docked and the inspector closed: the header's button opens it beside the column, and closes it. */
export const Wide: Story = {
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('navigation', { name: 'sources' })).toBeVisible();
    await expect(canvas.getByRole('main')).toBeVisible();
    await expect(canvas.getByRole('banner')).toBeVisible();
    await expect(canvas.getByRole('region', { name: 'now playing' })).toBeVisible();
    await expect(canvas.getByRole('region', { name: 'Library' })).toBeVisible();
    await expect(canvas.getByRole('region', { name: 'transport' })).toBeInTheDocument();
    await expect(canvas.queryByRole('complementary')).toBeNull();
    await expect(root(canvasElement)).toHaveAttribute('data-sidebar', 'docked');
    // The preset playing and where from are in the bar, not the hero.
    await expect(canvas.getByRole('region', { name: 'transport' })).toHaveTextContent(/from Warm-up/);
    await expect(canvasElement.querySelector('.vs-hero-info')).toBeNull();
    // The playlist playing is the row picked.
    await expect(canvas.getByRole('button', { name: new RegExp(`^${WARM_UP.name}`), current: true })).toBeVisible();
    const details = canvas.getByRole('button', { name: "show the preset's details" });
    await userEvent.click(details);
    await waitFor(() => expect(canvas.getByRole('complementary', { name: 'about the preset' })).toBeVisible());
    await expect(root(canvasElement)).toHaveAttribute('data-inspector', 'docked');
    await userEvent.click(details);
    await waitFor(() => expect(canvas.queryByRole('complementary')).toBeNull());
  },
};

/** At 1440×900 with the inspector docked: the main column narrows beside it. */
export const InspectorDocked: Story = {
  name: 'Inspector docked',
  args: { prefs: { sidebar: null, inspector: true } },
  play: async ({ canvas, canvasElement }) => {
    const insp = canvas.getByRole('complementary', { name: 'about the preset' });
    await expect(insp).toBeVisible();
    await expect(root(canvasElement)).toHaveAttribute('data-inspector', 'docked');
    // A press in the column leaves a docked inspector be.
    await userEvent.click(canvas.getByRole('main'));
    await expect(insp).toBeVisible();
  },
};

/** At 1100: the inspector laid over the column, under the header row, opaque; Escape puts it away and focus goes back to its button. */
export const InspectorOverlay: Story = {
  name: 'Inspector laid over, 1100 px',
  args: { width: 1100, prefs: { sidebar: null, inspector: null } },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.queryByRole('complementary')).toBeNull();
    const details = canvas.getByRole('button', { name: "show the preset's details" });
    await userEvent.click(details);
    const insp = await canvas.findByRole('complementary', { name: 'about the preset' });
    await expect(root(canvasElement)).toHaveAttribute('data-inspector', 'overlay');
    await expect(insp.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(canvas.queryByRole('complementary')).toBeNull());
    await expect(document.activeElement).toBe(details);
  },
};

/** At 1440 with the sidebar put away: the header leaves the window buttons their room. */
export const SidebarHidden: Story = {
  name: 'Sidebar hidden',
  args: { prefs: { sidebar: false, inspector: false } },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.queryByRole('navigation', { name: 'sources' })).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'sidebar' }));
    await waitFor(() => expect(canvas.getByRole('navigation', { name: 'sources' })).toBeVisible());
    await expect(root(canvasElement)).toHaveAttribute('data-sidebar', 'docked');
  },
};

/** At 800: the sidebar and the inspector both laid over the column; a press on the grid puts them away. */
export const Narrow: Story = {
  name: 'Both laid over, 800 px',
  args: { width: 800, prefs: { sidebar: true, inspector: true } },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('navigation', { name: 'sources' })).toBeVisible();
    await expect(canvas.getByRole('complementary', { name: 'about the preset' })).toBeVisible();
    await expect(root(canvasElement)).toHaveAttribute('data-sidebar', 'overlay');
    await expect(root(canvasElement)).toHaveAttribute('data-inspector', 'overlay');
    // A press outside both panels (on the grid under them).
    fireEvent.pointerDown(canvas.getByRole('region', { name: 'Library' }));
    await waitFor(() => expect(canvas.queryByRole('navigation', { name: 'sources' })).toBeNull());
    await expect(canvas.queryByRole('complementary')).toBeNull();
  },
};

/**
 * macOS's Reduce transparency on (the document marked as access.ts marks it from the app's
 * `reduced_motion`, since a page can't switch the system's setting): the window's material solid,
 * and the sidebar, the inspector and the bar opaque, with no blur.
 */
export const ReduceTransparency: Story = {
  name: 'Reduce transparency',
  args: { prefs: { sidebar: null, inspector: true } },
  parameters: { desk: 'solid' },
  beforeEach: () => {
    mark({ reduced: false, system: true, transparency: true });
    return () => mark({ reduced: false, system: true, transparency: false });
  },
  play: async ({ canvas, canvasElement }) => {
    await expect(document.documentElement).toHaveAttribute('data-transparency', 'reduced');
    await expect(canvas.getByRole('navigation', { name: 'sources' })).toBeVisible();
    await expect(canvas.getByRole('complementary', { name: 'about the preset' })).toBeVisible();
    await expect(root(canvasElement)).toHaveAttribute('data-inspector', 'docked');
  },
};
