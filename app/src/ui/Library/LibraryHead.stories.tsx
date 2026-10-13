import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { withLibraryTheme } from '@satoramoto/zen/storybook';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import { LIBRARY_VIEW_KEY, useLibraryView } from '../model/libraryView';
import { LibraryHead } from './LibraryHead';

/** The head as Home has it: its switch on the page's one choice (`useLibraryView`). */
function Head({ title, count, countTitle }: { title: string; count: number | null; countTitle?: string }) {
  const [view, setView] = useLibraryView();
  return (
    <div style={{ padding: 'var(--space-4) 0' }}>
      <LibraryHead title={title} count={count} countTitle={countTitle} view={view} onView={setView} />
      <p style={{ padding: '0 var(--space-4)', color: 'var(--text-3)' }} data-testid="room">
        The room shows the {view}.
      </p>
    </div>
  );
}

/**
 * The library's head row on Home (wireframe B): the source and how many it shows, then the
 * **Grid | Map** switch, the theme's tabs material, as the header's view switch. The choice is the
 * app's, kept across starts.
 */
const meta = {
  title: 'open[flow]/visuals/Library/LibraryHead',
  component: Head,
  decorators: [withVisualsFrame, withLibraryTheme],
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
  parameters: { layout: 'fullscreen' },
  args: { title: 'Library', count: 250 },
} satisfies Meta<typeof Head>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The switch: Grid at first; Map picked, the choice kept; Grid again. */
export const Switch: Story = {
  play: async ({ canvas }) => {
    const views = canvas.getByRole('radiogroup', { name: 'Show the library as' });
    await expect(within(views).getByRole('radio', { name: 'Grid' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(within(views).getByRole('radio', { name: 'Map' }));
    await expect(within(views).getByRole('radio', { name: 'Map' })).toHaveAttribute('aria-checked', 'true');
    await expect(canvas.getByTestId('room')).toHaveTextContent('map');
    await expect(localStorage.getItem(LIBRARY_VIEW_KEY)).toBe('map');
    await userEvent.click(within(views).getByRole('radio', { name: 'Grid' }));
    await expect(canvas.getByTestId('room')).toHaveTextContent('grid');
  },
};

/** Filtered: the count is what the room shows, its tooltip of how many. */
export const Filtered: Story = {
  args: { title: 'Starred', count: 12, countTitle: '12 of 40 presets shown' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status')).toHaveTextContent('12');
  },
};

/** Opened in Map view: the choice kept from before. */
export const OpensOnMap: Story = {
  name: 'Opens on Map',
  parameters: { storage: { [LIBRARY_VIEW_KEY]: 'map' } },
  play: async ({ canvas }) => {
    await expect(within(canvas.getByRole('radiogroup', { name: 'Show the library as' })).getByRole('radio', { name: 'Map' })).toHaveAttribute('aria-checked', 'true');
  },
};
