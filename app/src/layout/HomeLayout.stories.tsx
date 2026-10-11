import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor } from 'storybook/test';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import type { Pane } from '../home.ts';
import { Header } from '../views.tsx';
import { HomeLayout, INSPECTOR_ID, SIDEBAR_ID } from './HomeLayout.tsx';
import { InsetSidebar } from './InsetSidebar.tsx';
import { Hero } from './Hero.tsx';
import { tileName } from '../PresetTile.tsx';
import { StoryGrid } from './StoryGrid.tsx';
import { TransportBar } from './TransportBar.tsx';
import { Icon } from './icons.tsx';
import { modesFor, type LayoutPrefs } from './home-model.ts';
import { NOW, SIDEBAR, STARRED } from './fixtures.ts';
import { ROWS, WARM_UP } from '../stories/fixtures.ts';

/** The window's width, and what the viewer chose (home-model.ts's `LayoutPrefs`): the story starts from these. */
interface Args {
  width: number;
  prefs: LayoutPrefs;
}

/**
 * The whole window on the fixtures, a window `width` wide whatever the
 * runner's viewport: the header's toggles show and hide the sidebar and the
 * inspector, and a panel laid over the main column goes on Escape or a press
 * outside it, as Home wires them (`modesFor`); the sidebar's selection and
 * folding work; the rest does nothing.
 */
function Composed({ width, prefs: start }: Args) {
  const [prefs, setPrefs] = useState(start);
  const modes = modesFor(width, prefs);
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
              <button
                type="button"
                className="insp-toggle side-toggle"
                aria-label="sidebar"
                aria-controls={SIDEBAR_ID}
                aria-expanded={sideShown}
                title={sideShown ? 'Hide the sidebar' : 'Show the sidebar'}
                onClick={() => setPrefs((p) => ({ ...p, sidebar: !sideShown }))}
              >
                <Icon name="sidebar" />
              </button>
            }
          >
            <span className="vf-fill" />
            <button
              type="button"
              className="insp-toggle"
              aria-label="show the preset's details"
              aria-controls={INSPECTOR_ID}
              aria-pressed={inspOpen}
              title={inspOpen ? 'Hide the details' : 'Show the details'}
              onClick={() => setPrefs((p) => ({ ...p, inspector: !inspOpen }))}
            >
              <Icon name="sidebar" />
            </button>
            <Button tone="quiet" onPress={() => {}} label="settings" title="Settings: sound, presets, the output, quality and more">
              ⚙
            </Button>
          </Header>
        }
        hero={<Hero picture={NOW.picture} />}
        bar={
          <TransportBar
            playing={NOW.playing}
            onPlayPause={() => {}}
            onStep={() => {}}
            stepIn=" in the playlist"
            position={{ elapsed: 12, length: 30 }}
            onAudioError={() => {}}
            now={NOW.preset ? { name: tileName(NOW.preset.title, NOW.preset.path), from: NOW.from } : null}
          />
        }
        inspector={
          <div style={{ padding: '20px 18px' }}>
            <p className="hero-label">About the preset</p>
            <h2 style={{ margin: 0, fontSize: 17, color: 'var(--fg)' }}>{NOW.preset?.title}</h2>
            <p style={{ margin: '6px 0 0', color: 'var(--caption)', fontSize: 12 }}>The inspector's own story (Layout/Inspector) shows what goes here.</p>
          </div>
        }
      >
        <StoryGrid title="Library" rows={ROWS} playing={NOW.path} starred={STARRED} />
      </HomeLayout>
    </div>
  );
}

/**
 * Home as an inspector view, in the app's own look: the inset sidebar, the
 * main column with the header row, the Now Playing hero pinned and the
 * presets' tiles scrolling under it, the transport bar, and the inspector down the
 * right, each panel docked, laid over the column or put away as the window's
 * width and the viewer's choices say.
 */
const meta = {
  title: 'Layout/Home, macOS layout',
  component: Composed,
  args: { width: 1440, prefs: { sidebar: null, inspector: false } },
  parameters: { scope: 'bare', layout: 'fullscreen' },
} satisfies Meta<typeof Composed>;
export default meta;
type Story = StoryObj<typeof meta>;

const root = (el: HTMLElement) => el.querySelector('.app.home.lay') as HTMLElement;

/** The hero stays where it is while what is under it scrolls. */
async function heroPinned(el: HTMLElement) {
  const main = el.querySelector('.lay-main') as HTMLElement;
  const pic = el.querySelector('.hero-pic') as HTMLElement;
  const before = pic.getBoundingClientRect().top;
  main.scrollTop = 400;
  await waitFor(() => expect(main.scrollTop).toBeGreaterThan(0));
  await expect(pic.getBoundingClientRect().top).toBe(before);
  main.scrollTop = 0;
}

/** The picture alone: 16:9, centred in the column, filling its width unless that would make it taller than half the column. */
async function heroCapped(el: HTMLElement) {
  const col = (el.querySelector('.lay-col') as HTMLElement).getBoundingClientRect();
  const slot = el.querySelector('.lay-hero') as HTMLElement;
  const pad = parseFloat(getComputedStyle(slot).paddingLeft);
  const room = slot.getBoundingClientRect().width - 2 * pad;
  const box = (el.querySelector('.hero-pic') as HTMLElement).getBoundingClientRect();
  await expect(Math.abs(box.width / box.height - 16 / 9)).toBeLessThan(0.02);
  await expect(box.height).toBeLessThanOrEqual(col.height / 2 + 0.5);
  // Filled one way or the other: the column's width, or half its height.
  await expect(Math.min(Math.abs(box.width - room), Math.abs(box.height - col.height / 2))).toBeLessThan(1);
  await expect(Math.abs((box.left + box.right) / 2 - (col.left + col.right) / 2)).toBeLessThan(1);
}

/** At 1440×900, the sidebar docked and the inspector closed: the header's button opens it beside the column, and closes it. */
export const Wide: Story = {
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('navigation', { name: 'sources' })).toBeVisible();
    await expect(canvas.getByRole('main')).toBeVisible();
    await expect(canvas.getByRole('banner')).toBeVisible();
    await expect(canvas.getByRole('region', { name: 'now playing' })).toBeVisible();
    await expect(canvas.getByRole('region', { name: 'Library' })).toBeVisible();
    await expect(canvas.getByRole('region', { name: 'transport' })).toBeVisible();
    await expect(canvas.queryByRole('complementary')).toBeNull();
    await expect(root(canvasElement)).toHaveAttribute('data-sidebar', 'docked');
    // The root paints nothing; the main column is painted by the picture's spread shadow.
    await expect(getComputedStyle(root(canvasElement)).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    await expect(getComputedStyle(canvasElement.querySelector('.hero-pic')!).boxShadow).toMatch(/0px 0px 0px \d+(\.\d+)?px/);
    await heroPinned(canvasElement);
    await heroCapped(canvasElement);
    // The preset playing and where from are in the bar, not the hero.
    await expect(canvas.getByRole('region', { name: 'transport' })).toHaveTextContent(/from Warm-up/);
    await expect(canvasElement.querySelector('.hero-info')).toBeNull();
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
    const col = canvasElement.querySelector('.lay-col') as HTMLElement;
    await expect(col.getBoundingClientRect().right).toBeLessThanOrEqual(insp.getBoundingClientRect().left + 0.5);
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
    await expect(insp.getBoundingClientRect().top).toBeGreaterThanOrEqual(details.getBoundingClientRect().bottom);
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
    const mark = canvasElement.querySelector('.vf-header') as HTMLElement;
    await expect(parseFloat(getComputedStyle(mark).paddingLeft)).toBeGreaterThanOrEqual(90);
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
    const side = canvas.getByRole('navigation', { name: 'sources' });
    await expect(side).toBeVisible();
    await expect(canvas.getByRole('complementary', { name: 'about the preset' })).toBeVisible();
    await expect(root(canvasElement)).toHaveAttribute('data-sidebar', 'overlay');
    await expect(root(canvasElement)).toHaveAttribute('data-inspector', 'overlay');
    // Opaque: the native preview under them would show through anything less.
    for (const panel of [side, canvas.getByRole('complementary', { name: 'about the preset' })]) {
      const paint = getComputedStyle(panel)
        .backgroundColor.match(/rgba?\(([^)]*)\)/)![1]
        .split(',')
        .map(Number);
      await expect(paint[3] ?? 1).toBe(1);
    }
    await userEvent.click(canvas.getByRole('region', { name: 'transport' }));
    await waitFor(() => expect(canvas.queryByRole('navigation', { name: 'sources' })).toBeNull());
    await expect(canvas.queryByRole('complementary')).toBeNull();
    await heroPinned(canvasElement);
    await heroCapped(canvasElement);
  },
};
