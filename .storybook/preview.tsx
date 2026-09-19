import type { Preview } from '@storybook/react-vite';
import '@openflow/widgets/palette.css';
import '../client/app.css';
import '../client/ui/console.css';
import './preview.css';

const preview: Preview = {
  parameters: {
    layout: 'padded',
    backgrounds: { disable: true },
    options: {
      storySort: { order: ['UI', 'Debug', 'Experiments'] },
    },
  },
  decorators: [
    // Most of the console's styling is scoped under `.console`, which is also
    // the fixed full-window frame. The story root wears the class so the rules
    // apply, and preview.css takes the frame off it.
    (Story) => (
      <div className="console sb-console">
        <Story />
      </div>
    ),
  ],
};

export default preview;
