import type { Meta, StoryObj } from '@storybook/react-vite';
import { NodeHarness } from './NodeHarness.tsx';
import { trackBrightness } from './examples.ts';
import { checkTrack } from './storyChecks.ts';
const meta = {
  title: 'Nodes/Ableton/Track', component: NodeHarness,
  args: { example: trackBrightness }, argTypes: { example: { control: false } },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof NodeHarness>;
export default meta;
type Story = StoryObj<typeof meta>;
export const MeterToBrightness: Story = { play: checkTrack };
