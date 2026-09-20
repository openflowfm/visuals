import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test';

// Read during a frame, before WebGL discards the drawing buffer.
async function pixels(canvas: HTMLCanvasElement): Promise<number[]> {
  return new Promise(resolve => requestAnimationFrame(() => {
    const gl = canvas.getContext('webgl2')!;
    const data = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    const samples: number[] = [];
    for (let i = 0; i < data.length; i += 4 * 97) samples.push(...data.subarray(i, i + 4));
    resolve(samples);
  }));
}
const output = (root: HTMLElement) => root.querySelector<HTMLCanvasElement>('[data-testid="node-preview"] canvas')!;
export async function checkGraph({ canvasElement }: { canvasElement: HTMLElement }) {
  await waitFor(() => expect(output(canvasElement)?.width).toBeGreaterThan(1));
  await waitFor(async () => expect((await pixels(output(canvasElement))).some(value => value > 0)).toBe(true));
  expect(canvasElement.querySelector('.wdg-graph')).toBeTruthy();
  await waitFor(() => expect(canvasElement.querySelector('.node-harness-graph canvas[data-picture-state="live"]')).toBeTruthy());
  expect(within(canvasElement).queryByRole('alert')).toBeNull();
}
export async function checkTransport(context: { canvasElement: HTMLElement }) {
  await checkGraph(context);
  const ui = within(context.canvasElement);
  await userEvent.click(ui.getByRole('button', { name: 'Animate' }));
  expect(ui.getByRole('spinbutton', { name: 'Seconds' })).toBeDisabled();
  await userEvent.click(ui.getByRole('button', { name: 'Freeze' }));
  expect(Number((ui.getByRole('spinbutton', { name: 'Seconds' }) as HTMLInputElement).value)).toBeGreaterThan(2);
  fireEvent.change(ui.getByRole('spinbutton', { name: 'Tempo' }), { target: { value: '90' } });
  await userEvent.click(ui.getByRole('button', { name: 'Reset example' }));
  expect(ui.getByRole('spinbutton', { name: 'Seconds' })).toHaveValue(2);
  expect(ui.getByRole('spinbutton', { name: 'Tempo' })).toHaveValue(120);
}
export async function checkLens(context: { canvasElement: HTMLElement }) {
  await checkGraph(context);
  const ui = within(context.canvasElement);
  const before = await pixels(output(context.canvasElement));
  expect(await pixels(output(context.canvasElement))).toEqual(before);
  // Exercise the real node slider using its keyboard interaction.
  const depth = ui.getByRole('slider', { name: /depth/i });
  depth.focus();
  await userEvent.keyboard('{End}');
  await waitFor(async () => expect(await pixels(output(context.canvasElement))).not.toEqual(before));
  await userEvent.click(ui.getByRole('button', { name: 'Reset example' }));
  await waitFor(async () => expect(await pixels(output(context.canvasElement))).toEqual(before));
}
export async function checkTrack(context: { canvasElement: HTMLElement }) {
  await checkGraph(context);
  const ui = within(context.canvasElement);
  const before = await pixels(output(context.canvasElement));
  fireEvent.change(ui.getByRole('slider', { name: 'Drums level' }), { target: { value: '0.1' } });
  await waitFor(async () => expect(await pixels(output(context.canvasElement))).not.toEqual(before));
  await userEvent.click(ui.getByRole('button', { name: 'Reset example' }));
  expect(ui.getByRole('slider', { name: 'Drums level' })).toHaveValue('0.7');
  await waitFor(async () => expect(await pixels(output(context.canvasElement))).toEqual(before));
  const smooth = ui.getByRole('slider', { name: /smooth/i });
  smooth.focus();
  await userEvent.keyboard('{End}');
  await waitFor(async () => expect(await pixels(output(context.canvasElement))).toEqual(before));
  fireEvent.change(ui.getByRole('slider', { name: 'Drums level' }), { target: { value: '0.1' } });
  // A frozen transport must also hold envelope decay despite ongoing browser frames.
  for (let i = 0; i < 12; i++) expect(await pixels(output(context.canvasElement))).toEqual(before);
  await userEvent.click(ui.getByRole('button', { name: 'Animate' }));
  await waitFor(async () => expect(await pixels(output(context.canvasElement))).not.toEqual(before));
  await userEvent.click(ui.getByRole('button', { name: 'Reset example' }));
}
