import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { withLibraryTheme } from '@satoramoto/zen/storybook';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import { Numbers } from './Numbers';

// No original story: the hero's and the transport bar's "from" lines.

/** A line with its numbers ("7 of 9,795") in tabular figures, so a count that changes doesn't jog. */
const meta = {
  title: 'open[flow]/visuals/Library/Numbers',
  component: Numbers,
  args: { text: 'from Warm up · 7 of 9,795' },
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
  decorators: [
    (Story) => (
      <p style={{ margin: 0, padding: 'var(--mat-plate-inset)', color: 'var(--text-3)' }}>
        <Story />
      </p>
    ),
    withVisualsFrame,
    withLibraryTheme,
  ],
} satisfies Meta<typeof Numbers>;
export default meta;
type Story = StoryObj<typeof meta>;

/** "7 of 9,795" is one run of figures. */
export const OfMany: Story = {
  play: async ({ canvasElement }) => {
    const runs = [...canvasElement.querySelectorAll('.vs-numbers')].map((n) => n.textContent);
    await expect(runs).toEqual(['7 of 9,795']);
  },
};

/** Several numbers on one line, each its own run. */
export const Several: Story = { args: { text: '250 presets, 12 starred, 3:41 left' } };

/** No numbers: the text as it is. */
export const NoNumbers: Story = { args: { text: 'from the library' } };
