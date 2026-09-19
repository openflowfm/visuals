import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { fn } from 'storybook/test';
import { Colorways } from './Colorways.tsx';
import type { Scheme } from '../../protocol.ts';
import { SCHEME } from '../../stories/fixtures.ts';

type Args = { scheme: Scheme; edit(next: Scheme): void; current: string | null };

/** The editor with its scheme arg live, so a deal or a rename lands back in the controls. */
const live = (args: Args) => {
  const [, setArgs] = useArgs<Args>();
  return (
    <Colorways
      {...args}
      edit={(next) => {
        args.edit(next);
        setArgs({ scheme: next });
      }}
    />
  );
};

const meta = {
  title: 'UI/Colorways',
  component: Colorways,
  tags: ['autodocs'],
  render: live,
  args: { scheme: SCHEME, edit: fn(), current: 'neon' },
  argTypes: {
    current: { control: 'text' },
    scheme: { control: 'object' },
    // The story wires this one itself, to write the edit back into `scheme`.
    edit: { control: false },
  },
  parameters: {
    docs: {
      description: {
        component:
          'The colourway editor on its own: a library of palettes, each row re-dealable and renameable. Editing writes the scheme back to the controls, so the panel and the canvas stay the same story.',
      },
    },
  },
} satisfies Meta<typeof Colorways>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Library: Story = {
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
  args: {
    scheme: { ...SCHEME, colorways: { dawn: SCHEME.colorways.dawn }, moods: {} },
    current: null,
  },
  parameters: {
    docs: {
      description: {
        story: 'A library of one, which is what a new scheme has. Delete is refused: the last row is the fallback.',
      },
    },
  },
};
