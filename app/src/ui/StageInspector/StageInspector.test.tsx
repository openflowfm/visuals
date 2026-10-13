// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setBridge, type InvokeArgs } from '../model/ipc';
import type { Preset } from '../model/api';
import { BASE } from '../model/stages';
import { sample } from '../fixtures/presets';
import { StageInspector } from './StageInspector';

function setup(selected: string | null, preset: Preset = sample(), problems = [] as { stage: string; line: number | null; message: string }[]) {
  const onChange = vi.fn();
  const onSet = vi.fn();
  const view = render(<StageInspector preset={preset} selected={selected} problems={problems} onChange={onChange} onSet={onSet} />);
  return { ...view, onChange, onSet };
}

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

describe('StageInspector', () => {
  it('shows motion for no selection: its label, term, code sized to its lines, and no remove', () => {
    setup(null);
    expect(screen.getByRole('heading', { name: 'motion' })).toBeInTheDocument();
    expect(screen.getByText(/per-frame and per-vertex equations/)).toBeInTheDocument();
    const frame = screen.getByRole('textbox', { name: /every frame/ }) as HTMLTextAreaElement;
    expect(frame.value).toContain('zoom = 1.01');
    expect(frame.rows).toBe(4);
    expect(screen.queryByRole('button', { name: 'remove' })).toBeNull();
  });

  it('a code edit goes out whole', () => {
    const { onChange } = setup(null);
    fireEvent.change(screen.getByRole('textbox', { name: /once, at the start/ }), { target: { value: 'q1 = 2;' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ init: 'q1 = 2;' }));
  });

  it('a number setting calls onSet with its owner and key, whole numbers rounded', async () => {
    const { onSet } = setup('shape1');
    const sides = screen.getByRole('slider', { name: 'sides' });
    fireEvent.keyDown(sides, { key: 'ArrowUp' });
    await waitFor(() => expect(onSet).toHaveBeenCalledWith({ list: 'shapes', index: 1 }, 'sides', 6));
    // Typed: 7.6 sides is 8.
    fireEvent.keyDown(screen.getByRole('slider', { name: 'sides' }), { key: '7' });
    const input = screen.getByRole('textbox', { name: 'sides' });
    fireEvent.change(input, { target: { value: '7.6' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSet).toHaveBeenLastCalledWith({ list: 'shapes', index: 1 }, 'sides', 8);
    for (const [, , value] of onSet.mock.calls) expect(Number.isInteger(value)).toBe(true);
  });

  it('a float setting on motion goes to the base', async () => {
    const { onSet } = setup(null);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'zoom' }), { key: 'ArrowUp' });
    await waitFor(() => expect(onSet).toHaveBeenCalledWith(BASE, 'zoom', expect.any(Number)));
    expect(onSet.mock.calls[0][2]).toBeGreaterThan(1.02);
  });

  it('an on/off setting sends 1 or 0', async () => {
    const { onSet } = setup('shape1');
    await userEvent.click(screen.getByRole('button', { name: 'additive' }));
    expect(onSet).toHaveBeenCalledWith({ list: 'shapes', index: 1 }, 'additive', 0);
  });

  it('an enum setting sends its item index from the minimum', async () => {
    const { onSet } = setup('wave');
    // Closed, a letter picks the first item starting with it: "blob", the third.
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'mode' }), { key: 'b' });
    expect(onSet).toHaveBeenCalledWith(BASE, 'nWaveMode', 2);
  });

  it('remove takes a layer off, or is disabled while per-frame code drives it', async () => {
    const { onChange, unmount } = setup('shape1');
    await userEvent.click(screen.getByRole('button', { name: 'remove' }));
    expect(onChange.mock.calls[0][0].shapes[1].values.enabled).toBe(0);
    unmount();

    const driven = sample();
    driven.frame = 'wave_a = 1;';
    setup('wave', driven);
    const remove = screen.getByRole('button', { name: 'remove' });
    expect(remove).toBeDisabled();
    expect(remove).toHaveAttribute('title', "motion's per-frame code sets wave_a: change it there to take this off");
  });

  it("write my own asks the lab's default_shader and applies it", async () => {
    const calls: [string, InvokeArgs | undefined][] = [];
    restore = setBridge({
      invoke: <T,>(cmd: string, args?: InvokeArgs) => {
        calls.push([cmd, args]);
        return Promise.resolve((cmd === 'default_shader' ? 'shader_body { ret = 1; }' : null) as T);
      },
    });
    const { onChange } = setup('comp');
    expect(screen.getByText("This preset uses MilkDrop's default composite shader.")).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'write my own' }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(calls[0][0]).toBe('default_shader');
    expect(calls[0][1]).toMatchObject({ which: 'comp' });
    expect(onChange.mock.calls[0][0].comp).toBe('shader_body { ret = 1; }');
  });

  it('strikes through a baked-in setting under the why, and lists problems', () => {
    setup('feedback', sample(), [{ stage: 'warp', line: 3, message: 'unexpected token' }]);
    expect(screen.getByText(/so decay no longer applies/)).toBeInTheDocument();
    expect(screen.getByTitle('fDecay: no longer applies')).toHaveAttribute('data-baked');
    expect(screen.queryByText('unexpected token')).toBeNull();
  });

  it('shows a stage problem as stage:line message', () => {
    setup('warp', sample(), [{ stage: 'warp', line: 3, message: 'unexpected token' }]);
    expect(screen.getByText('warp:3').closest('p')).toHaveTextContent('warp:3 unexpected token');
  });

  it('says when there is nothing to set, and keeps unclaimed file values in the file disclosure', async () => {
    const { onSet } = setup('audio', { ...sample(), values: { ...sample().values, MILKDROP_PRESET_VERSION: 201 } });
    expect(screen.getByText('Nothing to set here.')).toBeInTheDocument();
    expect(screen.getByText('file')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('slider', { name: 'MILKDROP_PRESET_VERSION' }), { key: 'ArrowUp' });
    await waitFor(() => expect(onSet).toHaveBeenCalledWith(BASE, 'MILKDROP_PRESET_VERSION', expect.any(Number)));
  });
});
