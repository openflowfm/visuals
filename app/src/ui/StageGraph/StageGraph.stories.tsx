import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { withLibraryTheme } from '@satoramoto/zen/storybook';
import { sample } from '../fixtures/presets';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import { StageGraph } from './StageGraph';

/**
 * The lab's stage graph: MilkDrop's chain left to right (audio, motion, warp, feedback,
 * composite, screen), the sample preset's layers (the waveform, a custom wave, a custom shape,
 * the borders) under warp and cabled into the feedback, and "+ add layer" under the feedback.
 * Press a node to select it; drag one to move it; "fit" puts them back.
 */
const meta = {
  title: 'open[flow]/visuals/Lab/StageGraph',
  component: StageGraph,
  // Room for the whole graph, in scale steps (960×560 under `roomy`).
  render: (args) => (
    <div style={{ display: 'grid', width: 'calc(var(--space-6) * 30)', height: 'calc(var(--space-6) * 17.5)', maxWidth: '100%' }}>
      <StageGraph {...args} />
    </div>
  ),
  decorators: [withVisualsFrame, withLibraryTheme],
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
  args: { preset: sample(), problems: [], selected: null, onSelect: fn(), onChange: fn(), onSet: fn() },
  parameters: { world: {} },
} satisfies Meta<typeof StageGraph>;
export default meta;
type S = StoryObj<typeof meta>;

/** The sample preset, nothing selected (so motion is). */
export const Default: S = {};

/** A report naming two stages: motion's per-frame code and the custom wave's per-point code. Both nodes draw their edge in the danger ink and count their problems. */
export const WithProblems: S = {
  args: {
    problems: [
      { stage: 'frame', message: "unknown function 'sinn'", line: 2 },
      { stage: 'wave0.point', message: 'expected )', line: 1 },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getAllByText('1 problem').length).toBeGreaterThanOrEqual(2));
  },
};

/** A layer selected: the custom shape's node carries the selection ring. */
export const Selected: S = {
  args: { selected: 'shape1' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'custom shape 2', pressed: true })).toBeInTheDocument();
  },
};

/** "+ add layer" opens its menu; an offer adds that layer (onChange) and selects it (onSelect). */
export const AddLayer: S = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: '+ add layer' }));
    const menu = await canvas.findByRole('menu', { name: 'add a layer' });
    const offer = within(menu)
      .getAllByRole('button')
      .find((b) => !(b as HTMLButtonElement).disabled);
    await expect(offer).toBeDefined();
    await userEvent.click(offer!);
    await waitFor(() => expect(args.onChange).toHaveBeenCalledTimes(1));
    await expect(args.onSelect).toHaveBeenCalled();
    await expect(canvas.queryByRole('menu', { name: 'add a layer' })).toBeNull();
  },
};
