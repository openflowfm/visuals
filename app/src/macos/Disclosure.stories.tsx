import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { MAC_SIZES, MacDisclosure, type MacSize } from './controls.tsx';
import { isDisabled, isInactive, KIT_APPEARANCES, KIT_SIZES, KIT_STATES, Pair, PRESSED, Sheet, SIZE_NAMES, type Appearance, type Column } from './Showcase.tsx';

/** The kit's symbol for a disclosure button: "Disclosure Buttons/Light/Content Area/3 Rg/Down, 1 - Idle"; it has none for an inactive window. */
const kit = (expanded: boolean) => (appearance: Appearance, size: MacSize, column: Column) =>
  isInactive(column) ? null : `Disclosure Buttons/${KIT_APPEARANCES[appearance]}/Content Area/${KIT_SIZES[size]}/${expanded ? 'Up' : 'Down'}, ${KIT_STATES[column]}`;

/** Every size and state of a disclosure button, closed or open. */
const sheet = (expanded: boolean) => () => (
  <Sheet render={(size, column) => <MacDisclosure aria-label="Details" size={size} defaultExpanded={expanded} disabled={isDisabled(column)} />} kit={kit(expanded)} />
);

/** The disclosure button in a cell. */
const cell = (canvasElement: HTMLElement, size: MacSize, column: string, appearance = 'Light') =>
  within(within(within(canvasElement).getByRole('region', { name: appearance })).getByRole('group', { name: `${SIZE_NAMES[size]}, ${column}` })).getByRole('button');

/**
 * macOS's disclosure button, as the macOS 27 kit draws it: a small rounded
 * square (round from large up) with a chevron, pointing down when what it
 * shows is hidden and up when shown. A button with `aria-expanded`.
 */
const meta = {
  title: 'macOS/Disclosure button',
  component: MacDisclosure,
  args: { 'aria-label': 'Details' },
  parameters: { scope: 'bare', ...PRESSED },
} satisfies Meta<typeof MacDisclosure>;
export default meta;
type Story = StoryObj<typeof meta>;

/** One to try, in light and dark, showing and hiding what it controls. */
export const Playground: Story = {
  args: { 'aria-label': 'Advanced', size: 'regular', defaultExpanded: false, disabled: false, onChange: fn() },
  render: (args) => <Pair>{(appearance) => <Panel {...args} id={`advanced-${appearance}`} />}</Pair>,
  play: async ({ canvasElement, args }) => {
    const light = within(within(canvasElement).getByRole('region', { name: 'Light' }));
    const button = light.getByRole('button', { name: 'Advanced' });
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(light.queryByText('Advanced options')).toBeNull();
    await userEvent.click(button);
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(args.onChange).toHaveBeenLastCalledWith(true);
    await expect(light.getByText('Advanced options')).toBeVisible();
    await userEvent.keyboard('{Enter}');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
  },
};

/** A disclosure button and the panel it opens. */
function Panel({ id, onChange, ...props }: Parameters<typeof MacDisclosure>[0] & { id: string }) {
  const [open, setOpen] = useState(props.defaultExpanded ?? false);
  return (
    <div>
      <MacDisclosure
        {...props}
        controls={id}
        onChange={(next) => {
          setOpen(next);
          onChange?.(next);
        }}
      />
      {open && (
        <p id={id} style={{ font: 'var(--mac-font-body)', color: 'var(--mac-label)' }}>
          Advanced options
        </p>
      )}
    </div>
  );
}

/** Closed: the chevron down. */
export const Closed: Story = {
  render: sheet(false),
  play: async ({ canvasElement }) => {
    // The kit's squares: 16, 20, 24, 28 and 36 points.
    const sides = MAC_SIZES.map((size) => cell(canvasElement, size, 'Idle').getBoundingClientRect().width);
    await expect(sides).toEqual([16, 20, 24, 28, 36]);
    const regular = cell(canvasElement, 'regular', 'Idle').getBoundingClientRect();
    await expect([regular.width, regular.height]).toEqual([24, 24]);
    // Large and up are round.
    await expect(getComputedStyle(cell(canvasElement, 'large', 'Idle')).borderRadius).toBe('50%');
    const disabled = cell(canvasElement, 'regular', 'Disabled');
    await userEvent.click(disabled, { pointerEventsCheck: 0 });
    await expect(disabled).toHaveAttribute('aria-expanded', 'false');
  },
};

/** Open: the chevron up. */
export const Open: Story = {
  render: sheet(true),
  play: async ({ canvasElement }) => {
    const idle = cell(canvasElement, 'small', 'Idle', 'Dark');
    await expect(idle).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(idle);
    await expect(idle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(idle);
    await expect(idle).toHaveAttribute('aria-expanded', 'true');
  },
};
