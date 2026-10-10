import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor } from 'storybook/test';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import type { Pane } from '../home.ts';
import { Header } from '../views.tsx';
import { HomeLayout } from './HomeLayout.tsx';
import { InsetSidebar } from './InsetSidebar.tsx';
import { Hero } from './Hero.tsx';
import { Section } from './Section.tsx';
import { NOW, SECTIONS, SIDEBAR, STARRED } from './fixtures.ts';

/** The whole window, its parts on the fixtures: the sidebar's selection and folding work; the rest does nothing. */
function Composed() {
  const [selected, setSelected] = useState<Pane | null>({ kind: 'library' });
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const toggle = (id: string) => setCollapsed((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  return (
    <HomeLayout
      lights
      sidebar={<InsetSidebar sections={SIDEBAR} selected={selected} onSelect={setSelected} collapsed={collapsed} onToggle={toggle} />}
      header={
        <Header view="home" onChange={() => {}}>
          <span className="vf-fill" />
          <Button tone="quiet" onPress={() => {}} label="settings" title="Settings: sound, presets, the output, quality and more">
            ⚙
          </Button>
        </Header>
      }
      hero={
        <Hero
          preset={NOW.preset}
          picture={NOW.picture}
          playing={NOW.playing}
          from={NOW.from}
          starred={!!NOW.preset && STARRED.includes(NOW.preset.key)}
          onPlayPause={() => {}}
          onNext={() => {}}
          onStar={() => {}}
          onAdd={() => {}}
        />
      }
    >
      {SECTIONS.map((s) => (
        <Section key={s.title} title={s.title} action={{ label: 'See all', onPress: () => {} }} rows={s.rows} playing={NOW.path} starred={STARRED} />
      ))}
    </HomeLayout>
  );
}

/**
 * Home rearranged into the macOS 26/27 app layout (Apple's kit's "Library
 * Preview"), in the app's own look: the inset sidebar, the main column with
 * the header row, the Now Playing hero and titled sections. A reference: the
 * app's Home is unchanged.
 */
const meta = {
  title: 'Layout/Home, macOS layout',
  component: Composed,
  parameters: { scope: 'bare', layout: 'fullscreen' },
} satisfies Meta<typeof Composed>;
export default meta;
type Story = StoryObj<typeof meta>;

/** At 1440×900. */
export const Wide: Story = {
  globals: { viewport: { value: 'home1440', isRotated: false } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('navigation', { name: 'sources' })).toBeVisible();
    await expect(canvas.getByRole('main')).toBeVisible();
    await expect(canvas.getByRole('banner')).toBeVisible();
    await expect(canvas.getByRole('region', { name: 'now playing' })).toBeVisible();
    for (const s of SECTIONS) await expect(canvas.getByRole('region', { name: s.title })).toBeVisible();
    // The sidebar's sections fold, and a row picked is the current one.
    const playlists = canvas.getByRole('button', { name: 'Playlists' });
    await expect(playlists).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(playlists);
    await waitFor(() => expect(playlists).toHaveAttribute('aria-expanded', 'false'));
    await expect(canvas.getByRole('button', { name: /^Library/, current: true })).toBeVisible();
  },
};

/** At 900×800. */
export const At900: Story = {
  name: 'At 900 px',
  globals: { viewport: { value: 'home900', isRotated: false } },
};
