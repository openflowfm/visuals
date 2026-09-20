import type { Meta, StoryObj } from '@storybook/react-vite';
import { NodeHarness } from './NodeHarness.tsx';
import { exampleFor } from './examples.ts';
import { checkGraph } from './storyChecks.ts';

const meta = {
  title: 'Nodes/Draw/Source', component: NodeHarness,
  args: { example: exampleFor('source', 'plasma') },
  argTypes: { example: { control: false } },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof NodeHarness>;
export default meta;
type Story = StoryObj<typeof meta>;

/** One story per entry in `SOURCES`, in protocol order. */
export const Solid: Story = { args: { example: exampleFor('source', 'solid') }, play: checkGraph };
export const Bars: Story = { args: { example: exampleFor('source', 'bars') }, play: checkGraph };
export const Rings: Story = { args: { example: exampleFor('source', 'rings') }, play: checkGraph };
export const Noise: Story = { args: { example: exampleFor('source', 'noise') }, play: checkGraph };
export const Strobe: Story = { args: { example: exampleFor('source', 'strobe') }, play: checkGraph };
export const Grid: Story = { args: { example: exampleFor('source', 'grid') }, play: checkGraph };
export const Tunnel: Story = { args: { example: exampleFor('source', 'tunnel') }, play: checkGraph };
export const Plasma: Story = { args: { example: exampleFor('source', 'plasma') }, play: checkGraph };
export const Spiral: Story = { args: { example: exampleFor('source', 'spiral') }, play: checkGraph };
export const Scan: Story = { args: { example: exampleFor('source', 'scan') }, play: checkGraph };
export const Sparks: Story = { args: { example: exampleFor('source', 'sparks') }, play: checkGraph };
export const Checker: Story = { args: { example: exampleFor('source', 'checker') }, play: checkGraph };
export const Rays: Story = { args: { example: exampleFor('source', 'rays') }, play: checkGraph };
export const Traces: Story = { args: { example: exampleFor('source', 'traces') }, play: checkGraph };
