import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { MAC_SIZES, MacSwitch, type MacSize } from './controls.tsx';
import { isDisabled, isInactive, KIT_APPEARANCES, KIT_SIZES, KIT_STATES, Pair, PRESSED, Sheet, SIZE_NAMES, type Appearance, type Column } from './Showcase.tsx';

/** The kit's symbol for a switch: "Toggles - Switches/Light/Content Area/3 Rg/Active, On, 1 - Idle" (pressed off is its "1 - Clicked"). */
const kit = (on: boolean) => (appearance: Appearance, size: MacSize, column: Column) => {
  const state = column === 'pressed' && !on ? '1 - Clicked' : KIT_STATES[column];
  return `Toggles - Switches/${KIT_APPEARANCES[appearance]}/Content Area/${KIT_SIZES[size]}/${isInactive(column) ? 'Inactive' : 'Active'}, ${on ? 'On' : 'Off'}, ${state}`;
};

/** Every size and state of a switch at one value. */
const sheet = (on: boolean) => () => <Sheet render={(size, column) => <MacSwitch aria-label="Label" size={size} defaultChecked={on} disabled={isDisabled(column)} />} kit={kit(on)} />;

/** The switch in a cell. */
const cell = (canvasElement: HTMLElement, size: MacSize, column: string, appearance = 'Light') =>
  within(within(within(canvasElement).getByRole('region', { name: appearance })).getByRole('group', { name: `${SIZE_NAMES[size]}, ${column}` })).getByRole('switch');

/** Where the knob sits in its track: its gap to the leading and the trailing end. */
const knobGaps = (track: HTMLElement) => {
  const t = track.getBoundingClientRect();
  const k = track.querySelector('.mac-switch-knob')!.getBoundingClientRect();
  return { leading: k.left - t.left, trailing: t.right - k.right, width: k.width, height: k.height };
};

/**
 * macOS's switch, as the macOS 27 kit draws it: a capsule track, blue when
 * on, and a white capsule knob that rests at the trailing end when on. A
 * button with `role="switch"`: a click, Space or Enter flips it.
 */
const meta = {
  title: 'macOS/Switch',
  component: MacSwitch,
  args: { 'aria-label': 'Label' },
  parameters: { scope: 'bare', ...PRESSED },
} satisfies Meta<typeof MacSwitch>;
export default meta;
type Story = StoryObj<typeof meta>;

/** One switch to try, in light and dark. */
export const Playground: Story = {
  args: { 'aria-label': 'Follow the beat', size: 'regular', defaultChecked: false, disabled: false, onChange: fn() },
  render: (args) => <Pair>{() => <MacSwitch {...args} />}</Pair>,
  play: async ({ canvasElement, args }) => {
    const light = within(within(canvasElement).getByRole('region', { name: 'Light' })).getByRole('switch', { name: 'Follow the beat' });
    await expect(light).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(light);
    await expect(light).toHaveAttribute('aria-checked', 'true');
    await expect(args.onChange).toHaveBeenLastCalledWith(true);
    await userEvent.keyboard(' ');
    await expect(light).toHaveAttribute('aria-checked', 'false');
    await userEvent.keyboard('{Enter}');
    await expect(light).toHaveAttribute('aria-checked', 'true');
  },
};

/** On: the track blue, the knob at the trailing end. */
export const On: Story = {
  render: sheet(true),
  play: async ({ canvasElement }) => {
    // The kit's tracks: 36×16, 44×20, 54×24, 64×28 and 80×36.
    const tracks = MAC_SIZES.map((size) => {
      const r = cell(canvasElement, size, 'Idle').getBoundingClientRect();
      return [r.width, r.height];
    });
    await expect(tracks).toEqual([
      [36, 16],
      [44, 20],
      [54, 24],
      [64, 28],
      [80, 36],
    ]);
    // The regular knob, 32×20, 2 in from the trailing end.
    const regular = cell(canvasElement, 'regular', 'Idle');
    await expect(knobGaps(regular)).toMatchObject({ trailing: 2, width: 32, height: 20 });
    // Off, it slides to the leading end.
    await userEvent.click(regular);
    await expect(regular).toHaveAttribute('aria-checked', 'false');
    await waitFor(() => expect(knobGaps(regular).leading).toBe(2));
  },
};

/** Off: the track grey, the knob at the leading end. */
export const Off: Story = {
  render: sheet(false),
  play: async ({ canvasElement }) => {
    const mini = cell(canvasElement, 'mini', 'Idle', 'Dark');
    await expect(knobGaps(mini)).toMatchObject({ leading: 1.5, width: 21, height: 13 });
    // A disabled one doesn't flip.
    const disabled = cell(canvasElement, 'regular', 'Disabled', 'Dark');
    await expect(disabled).toBeDisabled();
    await userEvent.click(disabled, { pointerEventsCheck: 0 });
    await expect(disabled).toHaveAttribute('aria-checked', 'false');
    const idle = cell(canvasElement, 'xlarge', 'Idle', 'Dark');
    await userEvent.click(idle);
    await expect(idle).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(knobGaps(idle).trailing).toBe(3));
  },
};
