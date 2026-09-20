import type { Meta, StoryObj } from '@storybook/react-vite';
import { NodeHarness } from './NodeHarness.tsx';
import { exampleFor } from './examples.ts';
import { checkTransport } from './storyChecks.ts';

const meta = {
  title: 'Nodes/LFO', component: NodeHarness,
  args: { example: exampleFor('lfo') },
  argTypes: { example: { control: false } },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof NodeHarness>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Basic: Story = {play: checkTransport };
