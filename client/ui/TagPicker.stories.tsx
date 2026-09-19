import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { fn } from 'storybook/test';
import { TagPicker } from './TagPicker.tsx';

type Args = {
  chosen: readonly string[];
  toggle(id: string): void;
  placeholder: string;
  autoFocus?: boolean;
};

/** The picker with its chosen arg live, so clicking a chip updates the controls. */
const live = (args: Args) => {
  const [, setArgs] = useArgs<Args>();
  return (
    <TagPicker
      {...args}
      toggle={(id) => {
        args.toggle(id);
        setArgs({
          chosen: args.chosen.includes(id)
            ? args.chosen.filter((one) => one !== id)
            : [...args.chosen, id],
        });
      }}
    />
  );
};

const meta = {
  title: 'UI/Tag picker',
  component: TagPicker,
  tags: ['autodocs'],
  render: live,
  args: {
    chosen: [],
    toggle: fn(),
    placeholder: 'type to filter, ⏎ adds the top match',
    autoFocus: false,
  },
  argTypes: {
    placeholder: { control: 'text' },
    autoFocus: { control: 'boolean' },
    chosen: { control: 'object' },
    // Wired by the story, and a callback the console passes for its own
    // keystrokes — neither is anything a panel can set.
    toggle: { control: false },
    onKeyExtra: { control: false },
  },
  parameters: {
    docs: {
      description: {
        component:
          'The tag picker on its own: shelves of tags, a filter box, and the chips a review has said so far. The chosen list is a live arg, so picking in the canvas and editing the control are the same edit.',
      },
    },
  },
} satisfies Meta<typeof TagPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Nothing said yet. Every shelf is open; typing narrows them and rings the chip ⏎ would add.',
      },
    },
  },
};

export const Saying: Story = {
  args: { chosen: ['geometric', 'brooding'] },
  parameters: {
    docs: {
      description: {
        story: 'Two tags chosen. They repeat at the top under "this review says", and light up on their shelves.',
      },
    },
  },
};
