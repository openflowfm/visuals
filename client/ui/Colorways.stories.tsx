import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Colorways } from './Colorways.tsx';
import type { Scheme } from '../../protocol.ts';
import { SCHEME } from '../../stories/fixtures.ts';

/** The editor holding its own scheme, so a deal or a rename lands somewhere. */
function Editing({ scheme: initial, current }: { scheme: Scheme; current: string | null }) {
  const [scheme, setScheme] = useState(initial);
  return <Colorways scheme={scheme} edit={setScheme} current={current} />;
}

const meta = {
  title: 'UI/Colorways',
  component: Colorways,
  tags: ['autodocs'],
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Library: Story = {
  render: () => <Editing scheme={SCHEME} current="neon" />,
  parameters: {
    docs: {
      description: {
        story:
          'Four colourways dealt as a library, one marked as the one the show is using. Each row has its five roles, its mood, a die that re-deals that row alone, and a delete that the fallback refuses.',
      },
    },
  },
};

export const One: Story = {
  render: () => (
    <Editing
      scheme={{ ...SCHEME, colorways: { dawn: SCHEME.colorways.dawn }, moods: {} }}
      current={null}
    />
  ),
  parameters: {
    docs: {
      description: {
        story: 'A library of one, which is what a new scheme has. Delete is refused: the last row is the fallback.',
      },
    },
  },
};
