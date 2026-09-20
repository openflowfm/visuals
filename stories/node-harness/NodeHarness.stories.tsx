import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test';
import { NodeHarness } from './NodeHarness.tsx';
import { HARNESS_KINDS } from './fixture.ts';

const meta = {
  title: 'Debug/Node Harness',
  component: NodeHarness,
  args: { kind: 'source', mode: 'plasma' },
  argTypes: { kind: { control: 'select', options: HARNESS_KINDS }, mode: { control: 'text' } },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof NodeHarness>;
export default meta;
type Story = StoryObj<typeof meta>;

// Read in an animation frame, before the browser discards the drawing buffer.
// This checks production GPU output without adding a screenshot path to Bench.
async function pixels(canvas: HTMLCanvasElement): Promise<number[]> {
  return new Promise((resolve) => requestAnimationFrame(() => {
    const gl = canvas.getContext('webgl2')!;
    const data = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    const samples: number[] = [];
    for (let i = 0; i < data.length; i += 4 * 97) samples.push(...data.subarray(i, i + 4));
    resolve(samples);
  }));
}

export const Source: Story = {
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(canvasElement.querySelector('canvas')?.width).toBeGreaterThan(1));
    const canvas = canvasElement.querySelector('canvas')!;
    await waitFor(async () => {
      const frame = await pixels(canvas);
      // Alpha and white pixels are not evidence that the seeded palette arrived.
      expect(frame.some((r, i) => i % 4 === 0 && frame[i + 3] > 0 &&
        Math.max(r, frame[i + 1], frame[i + 2]) - Math.min(r, frame[i + 1], frame[i + 2]) > 10)).toBe(true);
    });
  },
};
export const ColourTransform: Story = {
  args: { kind: 'lens', mode: 'ripple' },
  play: async ({ canvasElement }) => {
    const ui = within(canvasElement);
    await waitFor(() => expect(canvasElement.querySelector('canvas')?.width).toBeGreaterThan(1));
    const canvas = canvasElement.querySelector('canvas')!;
    const before = await pixels(canvas);
    expect(before.some((value) => value > 0)).toBe(true);
    expect(await pixels(canvas)).toEqual(before);
    fireEvent.change(ui.getByRole('slider', { name: 'depth' }), { target: { value: '0.95' } });
    await waitFor(async () => expect(await pixels(canvas)).not.toEqual(before));
    await userEvent.click(ui.getByRole('button', { name: 'Reset depth' }));
    await waitFor(async () => expect(await pixels(canvas)).toEqual(before));
    await userEvent.selectOptions(ui.getByRole('combobox', { name: 'Mode' }), 'kaleido');
    expect(ui.queryByRole('slider', { name: 'depth' })).toBeNull();
    await userEvent.selectOptions(ui.getByRole('combobox', { name: 'Outlet' }), 'p');
    expect(ui.getByText(/Point outlet: visualized/)).toBeTruthy();
    expect(ui.queryByRole('alert')).toBeNull();
  },
};
export const NumberSignal: Story = {
  args: { kind: 'lfo', mode: 'sine' },
  play: async ({ canvasElement }) => {
    const ui = within(canvasElement);
    expect(ui.getByText(/Number outlet: visualized/)).toBeTruthy();
    expect(ui.getByText('live fallback')).toBeTruthy();
    await userEvent.click(ui.getByRole('button', { name: 'Animate' }));
    expect(ui.getByRole('spinbutton', { name: 'Seconds' })).toBeDisabled();
    await userEvent.click(ui.getByRole('button', { name: 'Freeze' }));
    expect(Number((ui.getByRole('spinbutton', { name: 'Seconds' }) as HTMLInputElement).value)).toBeGreaterThan(2);
    await userEvent.click(ui.getByRole('button', { name: 'Reset' }));
    expect(ui.getByRole('spinbutton', { name: 'Seconds' })).toHaveValue(2);
  },
};
export const Point: Story = { args: { kind: 'point', mode: '' } };
export const UnsupportedAsset: Story = {
  args: { kind: 'model', mode: '' },
  play: async ({ canvasElement }) => {
    const ui = within(canvasElement);
    expect(ui.getByText(/No isolated fixture for model/)).toBeTruthy();
    expect(canvasElement.querySelector('canvas')).toBeNull();
    await userEvent.selectOptions(ui.getByRole('combobox', { name: 'Node' }), 'source');
    await waitFor(() => expect(canvasElement.querySelector('canvas')?.width).toBeGreaterThan(1));
  },
};
