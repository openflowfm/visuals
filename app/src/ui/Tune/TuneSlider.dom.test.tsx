// @vitest-environment happy-dom
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MIXED, NONE, TuneSlider } from './TuneSlider';

/** A slider that keeps what it is given, as the card does. */
function Kept({ start = 1 as number | null, onChange = vi.fn() }: { start?: number | null; onChange?: (v: number) => void }) {
  const [value, setValue] = useState<number | null>(start);
  return (
    <TuneSlider
      name="speed"
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange(v);
      }}
    />
  );
}

const slider = () => screen.getByRole('slider', { name: 'speed' });
const says = () => slider().getAttribute('aria-valuetext');
/** Opens the readout's field and puts the keys in it. zen selects the field's text, which focuses
 *  it in browsers (the Tune story's "A typed value" play checks that in Chromium) but not in
 *  happy-dom, so the field is focused here by hand. */
async function typeInto(user: ReturnType<typeof userEvent.setup>, readout: string, keys: string) {
  await user.click(screen.getByRole('button', { name: readout }));
  screen.getByRole('textbox').focus();
  await user.keyboard(`{Control>}a{/Control}${keys}`);
}

describe('the tune slider', () => {
  it('reads its value as a fraction on a detent, and labels the detents', () => {
    render(<Kept start={0.5} />);
    expect(says()).toBe('½×');
    expect(screen.getByRole('button', { name: 'speed ½×, type a value' })).toBeTruthy();
    expect(document.querySelector('[data-part="labels"]')!.textContent).toBe('¼½124');
  });

  it('steps between detents with the arrows, and nudges a twelfth with Shift', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Kept onChange={onChange} />);
    slider().focus();
    await user.keyboard('{ArrowRight}');
    expect(says()).toBe('2×');
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(says()).toBe('½×');
    await user.keyboard('{Shift>}{ArrowUp}{/Shift}');
    expect(says()).toBe('0.53×');
    await user.keyboard('{ArrowDown}');
    expect(says()).toBe('½×');
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([2, 1, 0.5, 0.53, 0.5]);
  });

  it('goes to the ends with Home and End, and back to 1× with Delete or Backspace', async () => {
    const user = userEvent.setup();
    render(<Kept />);
    slider().focus();
    await user.keyboard('{End}');
    expect(says()).toBe('4×');
    await user.keyboard('{Delete}');
    expect(says()).toBe('1×');
    await user.keyboard('{Home}');
    expect(says()).toBe('¼×');
    await user.keyboard('{Backspace}');
    expect(says()).toBe('1×');
  });

  it('goes back to 1× on a double-click', async () => {
    render(<Kept start={2} />);
    fireEvent.doubleClick(slider());
    await waitFor(() => expect(says()).toBe('1×'));
  });

  it('takes a typed value from its readout, and leaves it on nonsense or Escape', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Kept onChange={onChange} />);
    await typeInto(user, 'speed 1×, type a value', '1/2{Enter}');
    expect(says()).toBe('½×');
    await typeInto(user, 'speed ½×, type a value', 'fast{Enter}');
    expect(says()).toBe('½×');
    await typeInto(user, 'speed ½×, type a value', '3{Escape}');
    expect(says()).toBe('½×');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([0.5]);
  });

  it('reads "Mixed" for presets that differ, and any step sets them from 1×', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Kept start={null} onChange={onChange} />);
    expect(says()).toBe(MIXED);
    slider().focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith(2);
    expect(says()).toBe('2×');
  });

  it('double-click while "Mixed" sets them all to 1×', () => {
    const onChange = vi.fn();
    render(<Kept start={null} onChange={onChange} />);
    fireEvent.doubleClick(slider());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(1);
    expect(says()).toBe('1×');
  });

  it('does nothing while disabled', async () => {
    const onChange = vi.fn();
    render(<TuneSlider name="speed" value={1} onChange={onChange} disabled />);
    expect(says()).toBe(NONE);
    fireEvent.keyDown(slider(), { key: 'ArrowRight' });
    fireEvent.doubleClick(slider());
    expect(onChange).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: /type a value/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
