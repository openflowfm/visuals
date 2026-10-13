import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent } from 'storybook/test';
import { withLibraryTheme } from '@satoramoto/zen/storybook';
import { VISUALS_GLOBALS, visualsBeforeEach, withVisualsFrame } from '../fixtures/story';
import { DATA, ROWS } from '../fixtures/fixtures';
import { Icon } from '../Icon/Icon';
import { prepare } from '../model/librarySearch';
import { TagEditor } from './TagEditor';

// No original story: my tags as the inspector shows them, on the starter slice.
const all = prepare(ROWS, DATA);
const [warm, both, peak] = [all[0], all[3], all[21]];

/** My tags on one preset or several: each "#tag" in type, ✕ on hover, then "+ Tag". */
const meta = {
  title: 'open[flow]/visuals/Library/TagEditor',
  component: TagEditor,
  args: { chosen: [both], onSet: fn() },
  globals: VISUALS_GLOBALS,
  beforeEach: visualsBeforeEach,
  decorators: [
    (Story) => (
      <div style={{ width: 280, padding: 'var(--mat-plate-inset)' }}>
        <Story />
      </div>
    ),
    withVisualsFrame,
    withLibraryTheme,
  ],
} satisfies Meta<typeof TagEditor>;
export default meta;
type Story = StoryObj<typeof meta>;

/** One preset's tags; "+ Tag" becomes a box, Enter adds what was typed. */
export const One: Story = {
  play: async ({ canvas, args }) => {
    await expect(canvas.getByRole('group', { name: 'my tags' })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: '+ Tag' }));
    await userEvent.type(canvas.getByRole('textbox', { name: 'add tags' }), 'late, dark{Enter}');
    await expect(args.onSet).toHaveBeenCalledWith([both.row.key], { add_tags: ['late', 'dark'] });
  },
};

/** Several picked: a tag on only some is fainter, with its count. */
export const Several: Story = { args: { chosen: [warm, both, peak] } };

/** As the inspector has it: the take-off button is the close icon. */
export const WithIcon: Story = { args: { remove: <Icon name="close" size={10} /> } };

/** No tags yet: only "+ Tag". */
export const Empty: Story = { args: { chosen: [all[1]] } };
