import type { Meta, StoryObj } from '@storybook/react-vite';
import { NodeHarness } from './NodeHarness.tsx';
import { exampleFor } from './examples.ts';
import { checkGraph } from './storyChecks.ts';

const meta = {
  title: 'Nodes/Transform/Halftone', component: NodeHarness,
  args: { example: exampleFor('halftone') },
  argTypes: { example: { control: false } },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof NodeHarness>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Basic: Story = {play: checkGraph };
