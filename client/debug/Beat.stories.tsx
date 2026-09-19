import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo } from 'react';
import { Beat } from './Beat.tsx';
import { SHOW, wallClock } from '../../stories/fixtures.ts';

/**
 * The harness on a clock made for it — a Link peer nobody had to join.
 *
 * `by` at zero is a clock with no kink in it.
 */
function OnClock({ bpm, every, by }: { bpm: number; every: number; by: number }) {
  const clock = useMemo(() => wallClock(bpm, by === 0 ? undefined : { every, by }), [bpm, every, by]);
  return <Beat clock={clock} show={{ ...SHOW.live, tempo: bpm }} />;
}

const meta = {
  title: 'Debug/Beat',
  component: OnClock,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'The beat harness drawn against a wall clock built from the args. The tempo, and the size and spacing of the kink, are the controls.',
      },
    },
  },
  args: { bpm: 124, every: 3, by: 0 },
  argTypes: {
    bpm: { control: { type: 'range', min: 60, max: 200, step: 1 } },
    every: { control: { type: 'range', min: 1, max: 10, step: 1 } },
    by: { control: { type: 'range', min: 0, max: 1, step: 0.05 } },
  },
} satisfies Meta<typeof OnClock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Steady: Story = {
  parameters: { docs: { description: { story: 'A clock off the wall at the reported tempo. The ramp should lie on the dashed line and the drift should read zero.' } } },
};

export const Corrected: Story = {
  args: { every: 3, by: 0.25 },
  parameters: { docs: { description: { story: 'The same clock, nudged a quarter beat every three seconds — what a Link correction looks like from the browser, and the kink this drawing exists to show.' } } },
};
