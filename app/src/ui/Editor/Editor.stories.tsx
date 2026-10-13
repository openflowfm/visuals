import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent, waitFor, within } from 'storybook/test';
import { withLibraryTheme } from '@satoramoto/zen/storybook';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import { ENTRIES } from '../fixtures/fixtures';
import { sample } from '../fixtures/presets';
import { SIDEBAR_ID } from '../HomeLayout/HomeLayout';
import { VisualsApp } from '../App/App';
import { Editor } from './Editor';

/** Every library entry opens as the sample preset (`fixtures/presets.ts`), so whichever the editor starts on has stages. */
const presets = Object.fromEntries(ENTRIES.map((e) => [e.path, sample()]));

/**
 * The lab build's whole app, as a lab build's main.tsx renders it (`<VisualsApp lab={VisualsEditor} />`):
 * it starts in the editor (the library column, the preview over the stage graph, the stage
 * inspector), and every header's switch offers home, editor and live. The fixture backend opens
 * every preset as the sample one and answers the lab's commands; stage pictures stay empty.
 */
const meta = {
  title: 'open[flow]/visuals/Lab/Editor',
  component: VisualsApp,
  decorators: [withVisualsFrame, withLibraryTheme],
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
  args: { frame: false, chrome: false, lab: Editor },
  parameters: { scope: 'bare', layout: 'fullscreen', world: { presets } },
} satisfies Meta<typeof VisualsApp>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A lab launch: the editor, the first preset open, motion in the inspector. */
export const Launch: Story = {
  play: async () => {
    const editor = await screen.findByRole('group', { name: 'editor' });
    const stage = within(editor).getByRole('region', { name: 'stage' });
    await waitFor(() => expect(within(stage).getAllByRole('textbox').length).toBeGreaterThan(0));
  },
};

/** The preset's last apply failed: the graph's motion node and the inspector both say so. */
export const WithProblems: Story = {
  parameters: { world: { presets, report: { equations: [{ stage: 'frame', message: "unknown function 'sinn'", line: 2 }], shaders: [] } } },
  play: async () => {
    const editor = await screen.findByRole('group', { name: 'editor' });
    await waitFor(() => expect(within(editor).getAllByText(/sinn/).length).toBeGreaterThan(0));
  },
};

/** The header's switch leaves the editor for the home. */
export const ToHome: Story = {
  play: async ({ canvasElement }) => {
    const editor = await screen.findByRole('group', { name: 'editor' });
    await userEvent.click(within(editor).getByRole('radio', { name: 'home' }));
    await waitFor(() => expect(canvasElement.querySelector(`#${SIDEBAR_ID}`)).not.toBeNull());
  },
};
