import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { MAC_SIZES, MacCheckbox, type MacSize, type MacToggleValue } from './controls.tsx';
import { isDisabled, isInactive, KIT_APPEARANCES, KIT_SIZES, KIT_STATES, Pair, PRESSED, Sheet, SIZE_NAMES, type Appearance, type Column } from './Showcase.tsx';

/** The kit's symbol for a checkbox: "Toggles - Checkboxes/Light/Content Area/3 Rg/Active, Checked, 1 - Idle". */
const kit = (value: MacToggleValue) => (appearance: Appearance, size: MacSize, column: Column) => {
  const state = value === 'mixed' ? 'Mixed' : value ? 'Checked' : 'Unchecked';
  return `Toggles - Checkboxes/${KIT_APPEARANCES[appearance]}/Content Area/${KIT_SIZES[size]}/${isInactive(column) ? 'Inactive' : 'Active'}, ${state}, ${KIT_STATES[column]}`;
};

/** Every size and state of a checkbox at one value. */
const sheet = (value: MacToggleValue) => () => (
  <Sheet
    render={(size, column) => (
      <MacCheckbox size={size} defaultChecked={value} disabled={isDisabled(column)}>
        Checkbox Label
      </MacCheckbox>
    )}
    kit={kit(value)}
  />
);

/** The checkbox in a cell of the light window. */
const cell = (canvasElement: HTMLElement, size: MacSize, column: string, appearance = 'Light') =>
  within(within(within(canvasElement).getByRole('region', { name: appearance })).getByRole('group', { name: `${SIZE_NAMES[size]}, ${column}` })).getByRole('checkbox');

/** The box we draw around the input. */
const box = (input: HTMLElement) => input.parentElement!.getBoundingClientRect();

/**
 * macOS's checkbox, as the macOS 27 kit draws it in a window's content area:
 * a filled box with no border, blue with a white check when on. A real
 * checkbox input sits over the box, so Space, the label and forms work.
 */
const meta = {
  title: 'macOS/Checkbox',
  component: MacCheckbox,
  parameters: { scope: 'bare', ...PRESSED },
} satisfies Meta<typeof MacCheckbox>;
export default meta;
type Story = StoryObj<typeof meta>;

/** One checkbox to try, in light and dark. */
export const Playground: Story = {
  args: { children: 'Show the frame rate', size: 'regular', defaultChecked: false, disabled: false, onChange: fn() },
  render: (args) => (
    <Pair>
      <MacCheckbox {...args} />
    </Pair>
  ),
  play: async ({ canvasElement, args }) => {
    const light = within(within(canvasElement).getByRole('region', { name: 'Light' })).getByRole('checkbox', { name: 'Show the frame rate' });
    await userEvent.click(light);
    await expect(light).toBeChecked();
    await expect(args.onChange).toHaveBeenLastCalledWith(true);
    // Space, as on macOS, once it has the focus.
    await expect(light).toHaveFocus();
    await userEvent.keyboard(' ');
    await expect(light).not.toBeChecked();
    await expect(args.onChange).toHaveBeenLastCalledWith(false);
  },
};

/** On: a blue box with a white check; grey with a dark check in an inactive window. */
export const Checked: Story = {
  render: sheet(true),
  play: async ({ canvasElement }) => {
    // The kit's box sizes: 12, 14, 16, 18 and 18 points.
    const sides = MAC_SIZES.map((size) => Math.round(box(cell(canvasElement, size, 'Idle')).width));
    await expect(sides).toEqual([12, 14, 16, 18, 18]);
    const regular = box(cell(canvasElement, 'regular', 'Idle'));
    await expect([regular.width, regular.height]).toEqual([16, 16]);
    // The whole regular control is 24 high, the box centred in it.
    const control = cell(canvasElement, 'regular', 'Idle').closest('label')!.getBoundingClientRect();
    await expect(control.height).toBe(24);
    await expect(regular.top - control.top).toBe(4);
    // A disabled one can't be unchecked.
    const disabled = cell(canvasElement, 'regular', 'Disabled');
    await expect(disabled).toBeDisabled();
    await userEvent.click(disabled.closest('label')!);
    await expect(disabled).toBeChecked();
    // An enabled one unchecks, its check gone.
    const idle = cell(canvasElement, 'regular', 'Idle');
    await userEvent.click(idle);
    await expect(idle).not.toBeChecked();
    await expect(getComputedStyle(idle.parentElement!.querySelector('.mac-toggle-check')!).display).toBe('none');
  },
};

/** Off: the box filled grey, no border. */
export const Unchecked: Story = {
  render: sheet(false),
  play: async ({ canvasElement }) => {
    const idle = cell(canvasElement, 'regular', 'Idle', 'Dark');
    await expect(idle).not.toBeChecked();
    // Clicking the label checks it, as a native checkbox's does.
    await userEvent.click(idle.closest('label')!.querySelector('.mac-toggle-label')!);
    await expect(idle).toBeChecked();
    await expect(getComputedStyle(idle.parentElement!.querySelector('.mac-toggle-check')!).display).toBe('block');
  },
};

/** Mixed: a white dash, for a checkbox standing for things some of which are on. Clicking it checks it. */
export const Mixed: Story = {
  render: sheet('mixed'),
  play: async ({ canvasElement }) => {
    const idle = cell(canvasElement, 'regular', 'Idle');
    await expect(idle).toBePartiallyChecked();
    // The kit's dash: 6.5 by 2 at regular.
    const dash = idle.parentElement!.querySelector('.mac-toggle-dash rect')!.getBoundingClientRect();
    await expect([dash.width, dash.height]).toEqual([6.5, 2]);
    await userEvent.click(idle);
    await expect(idle).not.toBePartiallyChecked();
    await expect(idle).toBeChecked();
    // A disabled one stays mixed.
    const disabled = cell(canvasElement, 'small', 'Disabled');
    await userEvent.click(disabled.closest('label')!);
    await expect(disabled).toBePartiallyChecked();
  },
};
