import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Layer } from '@satoramoto/zen';
import { withLibraryTheme } from '@satoramoto/zen/storybook';
import { LINK_OFF } from '../fixtures/fixtures';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import { LinkPanel, LinkSettings } from './LinkPanel';

/** Link, as the Stage's beat popover shows it: in a float layer, no panel of its own. No story in the original. */
const meta = {
  title: 'open[flow]/visuals/Controls/LinkPanel',
  component: LinkPanel,
  decorators: [
    (Story) => (
      <Layer level="float" style={{ width: 340, padding: 'var(--space-4)', borderRadius: 'var(--radius-card)' }}>
        <Story />
      </Layer>
    ),
    withVisualsFrame,
    withLibraryTheme,
  ],
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
} satisfies Meta<typeof LinkPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

/** In a session: the tempo, the peers in green, the bar and its lights. */
export const On: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('button', { name: 'Ableton Link' })).toHaveAttribute('aria-pressed', 'true');
    await expect(canvas.getByRole('img', { name: /^bar \d+, beat \d of \d$/ })).toBeVisible();
  },
};

/** Off: not on the network; turning it on joins. */
export const Off: Story = {
  parameters: { world: { link: LINK_OFF } },
  play: async ({ canvas, userEvent }) => {
    const toggle = await canvas.findByRole('button', { name: 'Ableton Link' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  },
};

/** Starting: Link hasn't answered yet. */
export const Starting: Story = {
  parameters: { world: { hang: ['link_state'] } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Starting…')).toBeVisible();
  },
};

/** Failing: Link couldn't start, said in the banner. */
export const Failing: Story = {
  parameters: { world: { fail: { link_state: 'the network is down' } } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('alert')).toHaveTextContent("Couldn't start Link.");
  },
};

/** In ⚙ Settings: the switch row and the bar start's keys. */
export const Settings: Story = {
  render: () => <LinkSettings />,
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('switch')).toHaveAttribute('aria-checked', 'true');
    await expect(canvas.getByRole('group', { name: 'Bar start' })).toBeVisible();
  },
};
