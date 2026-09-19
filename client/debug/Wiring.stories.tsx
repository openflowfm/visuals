import type { Meta, StoryObj } from '@storybook/react-vite';
import { Wiring } from './Wiring.tsx';
import { SHOW } from '../../stories/fixtures.ts';

const meta = {
  title: 'Debug/Wiring',
  component: Wiring,
  tags: ['autodocs'],
  args: { show: SHOW.resting, glError: null, online: false },
} satisfies Meta<typeof Wiring>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NothingUp: Story = {
  parameters: { docs: { description: { story: 'The UI with no server behind it. The first line is the one to fix; the rest are consequences and say so.' } } },
};

export const ServerOnly: Story = {
  args: { online: true },
  parameters: { docs: { description: { story: 'The server is up and the bridge is not reached — the fake-live case before fake-live is started.' } } },
};

export const Connected: Story = {
  args: { show: SHOW.connected, online: true },
  parameters: { docs: { description: { story: 'Through to the bridge, waiting on the LOM.' } } },
};

export const Live: Story = {
  args: { show: SHOW.live, online: true },
  parameters: { docs: { description: { story: 'Every link in the chain up, a flow compiled, a song named.' } } },
};

export const ContextLost: Story = {
  args: { show: SHOW.live, online: true, glError: 'WebGL context lost' },
  parameters: { docs: { description: { story: 'Everything right except the last thing: the graphics context went away under a good show.' } } },
};
