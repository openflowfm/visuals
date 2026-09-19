import type { Meta, StoryObj } from '@storybook/react-vite';
import { Wiring } from './Wiring.tsx';
import type { Show } from '../../protocol.ts';
import { SHOW } from '../../stories/fixtures.ts';

/**
 * `show` is picked by fixture name and `mapping` swaps the name for the fixture
 * before the story renders, so the arg is written as a name and read as a show.
 */
const named = (key: keyof typeof SHOW) => key as unknown as Show;

const meta = {
  title: 'Debug/Wiring',
  component: Wiring,
  tags: ['autodocs'],
  args: { show: named('resting'), glError: null, online: false },
  argTypes: {
    show: { options: Object.keys(SHOW), mapping: SHOW, control: { type: 'radio' } },
    online: { control: 'boolean' },
    glError: { control: 'text' },
  },
  parameters: {
    docs: {
      description: {
        component:
          'The wiring checklist, run against the show fixtures. Pick a show, say whether the server is up and whether the graphics context died, and the list says which link in the chain to fix.',
      },
    },
  },
} satisfies Meta<typeof Wiring>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NothingUp: Story = {
  parameters: { docs: { description: { story: 'The UI with no server behind it. The first line is the one to fix; the rest are consequences and say so.' } } },
};

export const ServerOnly: Story = {
  args: { show: named('serverOnly'), online: true },
  parameters: { docs: { description: { story: 'The server is up and the bridge is not reached — the fake-live case before fake-live is started.' } } },
};

export const Connected: Story = {
  args: { show: named('connected'), online: true },
  parameters: { docs: { description: { story: 'Through to the bridge, waiting on the LOM.' } } },
};

export const Live: Story = {
  args: { show: named('live'), online: true },
  parameters: { docs: { description: { story: 'Every link in the chain up, a flow compiled, a song named.' } } },
};

export const ContextLost: Story = {
  args: { show: named('live'), online: true, glError: 'WebGL context lost' },
  parameters: { docs: { description: { story: 'Everything right except the last thing: the graphics context went away under a good show.' } } },
};
