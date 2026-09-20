import type { Meta, StoryObj } from '@storybook/react-vite';
import { NodeHarness } from './NodeHarness.tsx';
import { exampleFor } from './examples.ts';
import { checkGraph, checkColor } from './storyChecks.ts';

const meta = {
  title: 'Nodes/Source', component: NodeHarness,
  args: { example: exampleFor('source', 'plasma') },
  argTypes: { example: { control: false } },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof NodeHarness>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Basic: Story = {play: checkGraph };

export const PaletteWiring: Story = {
  args: { example: {
    title: 'Choose a palette role explicitly',
    description: 'The accent outlet supplies the source color. Unwire it to return to the source’s primary-role default, or choose a custom color on the inlet.',
    circuit: {
      nodes: [
        { id: 'palette', kind: 'colorway', x: 20, y: 20, values: { amount: 1 } },
        { id: 'source', kind: 'source', op: 'plasma', x: 270, y: 20 },
        { id: 'out', kind: 'out', x: 520, y: 20 },
      ],
      cords: [{ from: 'palette/accent', to: 'source/color' }, { from: 'source/c', to: 'out/c' }],
    },
  } },
  play: checkGraph,
};

export const CustomColor: Story = { play: checkColor };
