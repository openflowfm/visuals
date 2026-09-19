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
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Loud: Story = {
  render: () => (
    <Boundary what="the designer">
      <Fragile />
    </Boundary>
  ),
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
  render: () => (
    <div style={{ minHeight: 120, border: '1px dashed var(--bd3)', padding: 12 }}>
      <Boundary what="the renderer" quiet>
        <Fragile />
      </Boundary>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "The wall's boundary. Press the button and it draws nothing at all — a projector that has lost its picture should be black, not a paragraph of English twenty feet wide.",
      },
    },
  },
};
