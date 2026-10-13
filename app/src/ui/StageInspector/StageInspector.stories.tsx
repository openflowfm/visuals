import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent } from 'storybook/test';
import { withLibraryTheme } from '@satoramoto/zen/storybook';
import { sample } from '../fixtures/presets';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import { StageInspector } from './StageInspector';

/**
 * The lab's inspector beside the stage graph (the original's `Inspector.tsx`, no story of its
 * own there), on `sample()`: motion's code, a shader still on MilkDrop's default, a layer with
 * remove, and a stage with problems. Its pane is about the lab's inspector column.
 */
const meta = {
  title: 'open[flow]/visuals/Lab/StageInspector',
  component: StageInspector,
  args: { preset: sample(), selected: null, problems: [], onChange: fn(), onSet: fn() },
  decorators: [
    (Story) => (
      <div style={{ width: 360 }}>
        <Story />
      </div>
    ),
    withVisualsFrame,
    withLibraryTheme,
  ],
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
} satisfies Meta<typeof StageInspector>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing selected: motion, its three code boxes and its settings. Typing in a box sends the preset whole. */
export const Motion: Story = {
  play: async ({ args }) => {
    await expect(screen.getByRole('heading', { name: 'motion' })).toBeVisible();
    const box = screen.getByRole('textbox', { name: /once, at the start/ });
    await userEvent.click(box);
    await userEvent.keyboard('x');
    await expect(args.onChange).toHaveBeenCalledWith(expect.objectContaining({ init: expect.stringContaining('x') }));
  },
};

/** The composite still on MilkDrop's default: the note and "write my own" instead of a code box. */
export const DefaultShader: Story = {
  args: { selected: 'comp' },
  play: async () => {
    await expect(screen.getByText("This preset uses MilkDrop's default composite shader.")).toBeVisible();
    await expect(screen.getByRole('button', { name: 'write my own' })).toBeEnabled();
    await expect(screen.queryByRole('textbox')).toBeNull();
  },
};

/** The written warp shader bakes decay in: struck through under the why. */
export const BakedIn: Story = {
  args: { selected: 'feedback' },
  play: async () => {
    await expect(screen.getByText(/so decay no longer applies/)).toBeVisible();
    await expect(screen.getByTitle('fDecay: no longer applies')).toHaveAttribute('data-baked');
  },
};

/** A custom shape: its code, its settings and remove (which takes it off, its code kept). */
export const Layer: Story = {
  args: { selected: 'shape1' },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: 'remove' }));
    await expect(args.onChange).toHaveBeenCalled();
  },
};

/** The waveform while motion's per-frame code turns it on: remove is disabled and says where to change it. */
export const DrivenLayer: Story = {
  args: { selected: 'wave', preset: { ...sample(), frame: 'wave_a = 1;' } },
  play: async () => {
    await expect(screen.getByRole('button', { name: 'remove' })).toBeDisabled();
  },
};

/** The warp shader failed to compile: its problems, by stage and line, in the danger colour. */
export const WithProblems: Story = {
  args: {
    selected: 'warp',
    problems: [
      { stage: 'warp', line: 3, message: "undeclared identifier 'sampler_mian'" },
      { stage: 'warp', line: null, message: 'the shader did not compile' },
    ],
  },
  play: async () => {
    await expect(screen.getByText('warp:3').closest('p')).toHaveTextContent("warp:3 undeclared identifier 'sampler_mian'");
  },
};

/** A stage with nothing to set (the audio), and the file's values no stage claims under `file`. */
export const NothingToSet: Story = {
  args: { selected: 'audio', preset: { ...sample(), values: { ...sample().values, MILKDROP_PRESET_VERSION: 201, PSVERSION: 2 } } },
  play: async () => {
    await expect(screen.getByText('Nothing to set here.')).toBeVisible();
    await expect(screen.getByText('file')).toBeVisible();
  },
};
