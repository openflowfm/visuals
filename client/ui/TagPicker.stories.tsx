import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { TagPicker } from './TagPicker.tsx';

/** The picker holding its own choices. */
function Picking({ chosen: initial }: { chosen: readonly string[] }) {
  const [chosen, setChosen] = useState<readonly string[]>(initial);
  const toggle = (id: string) =>
    setChosen((held) => (held.includes(id) ? held.filter((one) => one !== id) : [...held, id]));
  return <TagPicker chosen={chosen} toggle={toggle} placeholder="type to filter, ⏎ adds the top match" />;
}

const meta = {
  title: 'UI/Tag picker',
  component: TagPicker,
  tags: ['autodocs'],
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Empty: Story = {
  render: () => <Picking chosen={[]} />,
  parameters: {
    docs: {
      description: {
        story: 'Nothing said yet. Every shelf is open; typing narrows them and rings the chip ⏎ would add.',
      },
    },
  },
};

export const Saying: Story = {
  render: () => <Picking chosen={['geometric', 'brooding']} />,
  parameters: {
    docs: {
      description: {
        story: 'Two tags chosen. They repeat at the top under "this review says", and light up on their shelves.',
      },
    },
  },
};
