import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo } from 'react';
import { Beat } from './Beat.tsx';
import { SHOW, wallClock } from '../../stories/fixtures.ts';

/** The harness on a clock made for it — a Link peer nobody had to join. */
function OnClock({ bpm, kink }: { bpm: number; kink?: { every: number; by: number } }) {
  const clock = useMemo(() => wallClock(bpm, kink), [bpm, kink]);
  return <Beat clock={clock} show={{ ...SHOW.live, tempo: bpm }} />;
}

const meta = {
  title: 'Debug/Beat',
  component: Beat,
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Steady: Story = {
  render: () => <OnClock bpm={124} />,
  parameters: { docs: { description: { story: 'A clock off the wall at the reported tempo. The ramp should lie on the dashed line and the drift should read zero.' } } },
};

export const Corrected: Story = {
  render: () => <OnClock bpm={124} kink={{ every: 3, by: 0.25 }} />,
  parameters: { docs: { description: { story: 'The same clock, nudged a quarter beat every three seconds — what a Link correction looks like from the browser, and the kink this drawing exists to show.' } } },
};
