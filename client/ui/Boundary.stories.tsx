import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Boundary } from './Boundary.tsx';

/** Something to protect: draws fine until asked to throw. */
function Fragile() {
  const [broken, setBroken] = useState(false);
  if (broken) throw new Error('a node face read a field this flow does not have');
  return (
    <button type="button" onClick={() => setBroken(true)}>
      throw
    </button>
  );
}

const meta = {
  title: 'UI/Boundary',
  component: Boundary,
  tags: ['autodocs'],
  args: { what: 'the designer', quiet: false, children: <Fragile /> },
  argTypes: {
    what: { control: 'text' },
    quiet: { control: 'boolean' },
    children: { control: false },
  },
  parameters: {
    docs: {
      description: {
        component:
          'The error boundary with something fragile inside it: press the button and the child throws. `what` names what stopped and `quiet` decides whether anything is drawn at all.',
      },
    },
  },
} satisfies Meta<typeof Boundary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loud: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'The console\'s boundary. Press the button and the subtree stops there: a sentence, the error, and a way back. In the app this sheet fills the window; here it is a card.',
      },
    },
  },
};

export const Quiet: Story = {
  args: { what: 'the renderer', quiet: true },
  parameters: {
    docs: {
      description: {
        story:
          "The wall's boundary. Press the button and it draws nothing at all — a projector that has lost its picture should be black, not a paragraph of English twenty feet wide.",
      },
    },
  },
};
