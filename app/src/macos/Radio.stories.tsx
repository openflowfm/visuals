import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { MAC_SIZES, MacRadio, type MacSize, type MacToggleValue } from './controls.tsx';
import { isDisabled, isInactive, KIT_APPEARANCES, KIT_SIZES, KIT_STATES, Pair, PRESSED, Sheet, SIZE_NAMES, type Appearance, type Column } from './Showcase.tsx';

/** The kit's symbol for a radio button: "Toggles - Radio Buttons/Light/Content Area/3 Rg/Active, Checked - 1 - Idle". */
const kit = (value: MacToggleValue) => (appearance: Appearance, size: MacSize, column: Column) => {
  const state = value === 'mixed' ? 'Mixed' : value ? 'Checked' : 'Unchecked';
  return `Toggles - Radio Buttons/${KIT_APPEARANCES[appearance]}/Content Area/${KIT_SIZES[size]}/${isInactive(column) ? 'Inactive' : 'Active'}, ${state} - ${KIT_STATES[column]}`;
};

/** Every size and state of a radio button at one value; each its own, so none unchecks another. */
const sheet = (value: MacToggleValue) => () => (
  <Sheet
    render={(size, column) => (
      <MacRadio size={size} defaultChecked={value} disabled={isDisabled(column)}>
        Radio Button Label
      </MacRadio>
    )}
    kit={kit(value)}
  />
);

/** The radio button in a cell. */
const cell = (canvasElement: HTMLElement, size: MacSize, column: string, appearance = 'Light') =>
  within(within(within(canvasElement).getByRole('region', { name: appearance })).getByRole('group', { name: `${SIZE_NAMES[size]}, ${column}` })).getByRole('radio');

/**
 * macOS's radio button, as the macOS 27 kit draws it: the checkbox's filled
 * box made round, blue with a white dot when on. A real radio input sits over
 * it, so radios sharing a name check one at a time and move with the arrows.
 */
const meta = {
  title: 'macOS/Radio button',
  component: MacRadio,
  parameters: { scope: 'bare', ...PRESSED },
} satisfies Meta<typeof MacRadio>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A group of three sharing a name, in light and dark. */
export const Group: Story = {
  args: { onChange: fn() },
  render: (args) => (
    <Pair>
      {(appearance) =>
        ['Fill', 'Fit', 'Stretch'].map((name, i) => (
          <MacRadio key={name} {...args} name={`fit-${appearance}`} value={name} defaultChecked={i === 0}>
            {name}
          </MacRadio>
        ))
      }
    </Pair>
  ),
  play: async ({ canvasElement, args }) => {
    const light = within(within(canvasElement).getByRole('region', { name: 'Light' }));
    const [fill, fit, stretch] = ['Fill', 'Fit', 'Stretch'].map((name) => light.getByRole('radio', { name }));
    await expect(fill).toBeChecked();
    await userEvent.click(fit);
    await expect(fit).toBeChecked();
    await expect(fill).not.toBeChecked();
    await expect(args.onChange).toHaveBeenLastCalledWith(true);
    // The arrows move the choice along the group.
    await userEvent.keyboard('{ArrowDown}');
    await expect(stretch).toBeChecked();
    await expect(stretch).toHaveFocus();
    await expect(fit).not.toBeChecked();
    // The dark window's group is apart.
    await expect(within(canvasElement).getByRole('region', { name: 'Dark' }).querySelector('input:checked')).toHaveAccessibleName('Fill');
  },
};

/** On: a blue circle with a white dot; grey with a dark dot in an inactive window. */
export const Checked: Story = {
  render: sheet(true),
  play: async ({ canvasElement }) => {
    const sides = MAC_SIZES.map((size) => Math.round(cell(canvasElement, size, 'Idle').parentElement!.getBoundingClientRect().width));
    await expect(sides).toEqual([12, 14, 16, 18, 18]);
    // The kit's dot: 4.8 points at regular, centred.
    const regular = cell(canvasElement, 'regular', 'Idle').parentElement!;
    const dot = regular.querySelector('.mac-radio-dot')!.getBoundingClientRect();
    await expect(Math.round(dot.width * 10) / 10).toBe(4.8);
    await expect(Math.round((dot.left + dot.width / 2 - regular.getBoundingClientRect().left) * 10) / 10).toBe(8);
    const disabled = cell(canvasElement, 'regular', 'Disabled');
    await expect(disabled).toBeDisabled();
  },
};

/** Off: the circle filled grey. Picking it checks it. */
export const Unchecked: Story = {
  render: sheet(false),
  play: async ({ canvasElement }) => {
    const idle = cell(canvasElement, 'large', 'Idle', 'Dark');
    await userEvent.click(idle.closest('label')!.querySelector('.mac-toggle-label')!);
    await expect(idle).toBeChecked();
    const disabled = cell(canvasElement, 'large', 'Disabled', 'Dark');
    await userEvent.click(disabled.closest('label')!);
    await expect(disabled).not.toBeChecked();
  },
};

/** Mixed: a white dash, drawn only (HTML's radios have none): the input reads as unchecked, and picking it checks it. */
export const Mixed: Story = {
  render: sheet('mixed'),
  play: async ({ canvasElement }) => {
    const idle = cell(canvasElement, 'regular', 'Idle');
    await expect(idle).not.toBeChecked();
    const dash = idle.parentElement!.querySelector('.mac-toggle-dash')!;
    await expect(getComputedStyle(dash).display).toBe('block');
    await userEvent.click(idle);
    await expect(idle).toBeChecked();
    await expect(getComputedStyle(dash).display).toBe('none');
  },
};
