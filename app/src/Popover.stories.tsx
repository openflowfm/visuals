import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ComponentProps } from 'react';
import { expect, fn, userEvent } from 'storybook/test';
import { Popover } from './Popover.tsx';
// Home's tokens (--surface-float, --glass…), as Home.tsx brings them: the popover is only used on the home.
import './home.css';

const chose = fn();

/** The actions of a menu, each closing it. */
const menuItems: ComponentProps<typeof Popover>['children'] = (close: () => void) =>
  ['Rename', 'Save to a file', 'Delete…'].map((name) => (
    <button
      key={name}
      type="button"
      role="menuitem"
      data-danger={name === 'Delete…' ? '' : undefined}
      onClick={() => {
        chose(name);
        close();
      }}
    >
      {name}
    </button>
  ));

/** A button with a small panel under it (the home's "how it plays ▾", "···", "+ playlist ▾" and the narrow source menu): type with no box, glass when open. */
const meta = {
  title: 'Controls/Popover',
  component: Popover,
  args: { name: 'more', label: '···', title: 'Rename, save to a file or delete', role: 'menu', children: menuItems } as ComponentProps<typeof Popover>,
  // Room under the button for the panel to hang into.
  decorators: [
    (Story) => (
      <div style={{ width: 360, height: 220, padding: 8 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Popover>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Closed: only the button. */
export const MenuClosed: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'more' })).toHaveAttribute('aria-expanded', 'false');
    await expect(canvas.queryByRole('menu')).toBeNull();
  },
};

/** A menu open: the button underlined, its actions as menu items. */
export const MenuOpen: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'more' }));
    await expect(canvas.getByRole('button', { name: 'more' })).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.getByRole('menu', { name: 'more' })).toBeVisible();
    await expect(canvas.getAllByRole('menuitem')).toHaveLength(3);
  },
};

/** A dialog of controls open ("+ playlist ▾"-style label), hanging from the button's right edge. */
export const DialogOpen: Story = {
  args: {
    name: 'filter',
    label: 'Filter ▾',
    title: 'Narrow the library',
    role: 'dialog',
    align: 'right',
    children: (
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 4 }}>
        <input type="checkbox" defaultChecked /> Starred only
      </label>
    ),
  },
  decorators: [
    (Story) => (
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Story />
      </div>
    ),
  ],
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'filter' }));
    await expect(canvas.getByRole('dialog', { name: 'filter' })).toBeVisible();
  },
};

/** Closed but pressed: a button that also shows a state (the filter on). */
export const Pressed: Story = {
  args: { name: 'filter', label: 'Filter ▾', role: 'dialog', pressed: true, children: <p style={{ margin: 4 }}>Starred only</p> },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'filter' })).toHaveAttribute('aria-pressed', 'true');
  },
};
