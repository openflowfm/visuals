import type { Meta, StoryObj } from '@storybook/react-vite';
import { NodeHarness } from './NodeHarness.tsx';
import { exampleFor, animatedRipple } from './examples.ts';
import { checkLens } from './storyChecks.ts';

const meta = {
  title: 'Nodes/Lens', component: NodeHarness,
  args: { example: exampleFor('lens', 'ripple') },
  argTypes: { example: { control: false } },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof NodeHarness>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Basic: Story = {play: checkLens };

export const Kaleidoscope: Story = { args: { example: exampleFor('lens', 'kaleido') } };
export const ModulatedRipple: Story = { args: { example: animatedRipple } };
