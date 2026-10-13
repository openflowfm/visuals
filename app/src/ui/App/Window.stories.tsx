import type { Meta, StoryObj } from '@storybook/react-vite';
import { visualsBeforeEach } from '../fixtures/story';
import { VisualsApp } from './App';

/** The production window owns its frame: deliberately no theme or frame decorators.
 * The component stories exercise embedded frames; this one shows the default VisualsApp path
 * the native host actually mounts, to look at its viewport insets and clipping. */
const meta = {
  title: 'open[flow]/visuals/Window',
  component: VisualsApp,
  beforeEach: visualsBeforeEach,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof VisualsApp>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Home: Story = {};
