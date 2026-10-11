// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TUNE_KNOB_W, TuneSlider } from './TuneSlider.tsx';

afterEach(cleanup);

/** The slider as the card holds it: the value it shows is what it last sent. */
function Held({ start, onChange = () => {} }: { start: number | null; onChange?: (v: number) => void }) {
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
const readout = () => screen.getByRole('button', { name: /^speed .*, type a value$/ });
const entry = () => screen.getByRole('textbox', { name: 'speed, as a multiple' });

describe('the tune slider', () => {
  it('is one named slider on the log2 position, its text the readout', () => {
    render(<Held start={0.5} />);
    const s = slider();
    expect(s.getAttribute('aria-valuemin')).toBe('-2');
    expect(s.getAttribute('aria-valuemax')).toBe('2');
    expect(s.getAttribute('aria-valuenow')).toBe('-1');
    expect(says()).toBe('½×');
    expect(readout().textContent).toBe('½×');
    expect(s.tabIndex).toBe(0);
  });

  it('steps between detents with the arrows, both ways, from between them', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Held start={1.2} />);
    slider().focus();
    await user.keyboard('{ArrowLeft}');
    expect(says()).toBe('1×');
    await user.keyboard('{ArrowDown}');
    expect(says()).toBe('½×');
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(says()).toBe('¼×');
    unmount();
    render(<Held start={1.2} />);
    slider().focus();
    await user.keyboard('{ArrowRight}');
    expect(says()).toBe('2×');
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(says()).toBe('4×');
  });

  it('nudges a twelfth with Shift, and Home and End go to the ends', async () => {
    const user = userEvent.setup();
    render(<Held start={1} />);
    slider().focus();
    await user.keyboard('{Shift>}{ArrowRight}{/Shift}');
    expect(says()).toBe('1.06×');
    await user.keyboard('{Shift>}{ArrowDown}{ArrowDown}{/Shift}');
    expect(says()).toBe('0.94×');
    await user.keyboard('{End}');
    expect(says()).toBe('4×');
    await user.keyboard('{Home}');
    expect(says()).toBe('¼×');
  });

  it('Delete, Backspace and a double-click put it back to 1×', async () => {
    const user = userEvent.setup();
    render(<Held start={3} />);
    slider().focus();
    await user.keyboard('{Delete}');
    expect(says()).toBe('1×');
    await user.keyboard('{End}{Backspace}');
    expect(says()).toBe('1×');
    await user.keyboard('{End}');
    fireEvent.doubleClick(slider());
    expect(says()).toBe('1×');
  });

  it('takes a typed value in any of its forms, clamped, and leaves it on garbage', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Held start={1} onChange={onChange} />);
    const type = async (what: string, end = '{Enter}') => {
      await user.click(readout());
      expect(entry()).toBe(document.activeElement);
      await user.clear(entry());
      await user.type(entry(), what + end);
    };
    await type('0.5');
    expect(says()).toBe('½×');
    await type('3/4');
    expect(says()).toBe('0.75×');
    await type('½');
    expect(says()).toBe('½×');
    await type('2x');
    expect(says()).toBe('2×');
    await type('3×');
    expect(says()).toBe('3.00×');
    await type('.75');
    expect(says()).toBe('0.75×');
    await type('12');
    expect(says()).toBe('4×');
    await type('0.1');
    expect(says()).toBe('¼×');
    await type('1.23456');
    expect(onChange).toHaveBeenLastCalledWith(1.235);
    const calls = onChange.mock.calls.length;
    const before = says();
    await type('fast');
    expect(says()).toBe(before);
    expect(onChange).toHaveBeenCalledTimes(calls);
    // Typing ends with focus back on the readout.
    expect(document.activeElement).toBe(readout());
  });

  it('commits on blur, and Escape cancels without reaching the window', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const escapes: KeyboardEvent[] = [];
    const listen = (e: KeyboardEvent) => {
      if (e.key === 'Escape') escapes.push(e);
    };
    window.addEventListener('keydown', listen);
    try {
      render(<Held start={1} onChange={onChange} />);
      await user.click(readout());
      expect((entry() as HTMLInputElement).value).toBe('1');
      await user.clear(entry());
      await user.type(entry(), '2{Escape}');
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(says()).toBe('1×');
      expect(onChange).not.toHaveBeenCalled();
      expect(escapes.every((e) => e.defaultPrevented)).toBe(true);

      await user.click(readout());
      await user.clear(entry());
      await user.type(entry(), '2');
      await user.click(document.body);
      expect(says()).toBe('2×');
      expect(onChange).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', listen);
    }
  });

  it('reads "Mixed" with no knob or fill, and any move sets one value (arrows from 1×)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Held start={null} onChange={onChange} />);
    expect(says()).toBe('Mixed');
    expect(readout().textContent).toBe('Mixed');
    expect(document.querySelector('.tune-slider-knob')).toBeNull();
    expect(document.querySelector('.tune-slider-fill')).toBeNull();
    slider().focus();
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith(0.5);
    expect(says()).toBe('½×');
    expect(document.querySelector('.tune-slider-knob')).not.toBeNull();
  });

  it('a mixed slider set to 1× by a double-click still sends it', () => {
    const onChange = vi.fn();
    render(<Held start={null} onChange={onChange} />);
    fireEvent.doubleClick(slider());
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it('disabled: "–", no knob, not focusable, and deaf to keys, pointer and typing', async () => {
    const onChange = vi.fn();
    render(<TuneSlider name="speed" value={1} onChange={onChange} disabled />);
    const s = slider();
    expect(s.getAttribute('aria-disabled')).toBe('true');
    expect(s.tabIndex).toBe(-1);
    expect(says()).toBe('–');
    expect(document.querySelector('.tune-slider-knob')).toBeNull();
    fireEvent.keyDown(s, { key: 'End' });
    fireEvent.doubleClick(s);
    fireEvent.pointerDown(s, { button: 0, clientX: 0, pointerId: 1 });
    expect((readout() as HTMLButtonElement).disabled).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a drag jumps to where it lands and catches on a detent near one, between them on twelfths', () => {
    const onChange = vi.fn();
    render(<Held start={1} onChange={onChange} />);
    const s = slider();
    // 200 px of travel between the knob's centre at each end: 50 px a doubling, ¼× at 13 px.
    const left = 100;
    s.getBoundingClientRect = () => ({ left, top: 0, right: left + 200 + TUNE_KNOB_W, bottom: 22, width: 200 + TUNE_KNOB_W, height: 22, x: left, y: 0, toJSON: () => ({}) });
    const x = (position: number) => left + TUNE_KNOB_W / 2 + ((position + 2) / 4) * 200;
    fireEvent.pointerDown(s, { button: 0, clientX: x(1.1), pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(2);
    expect(document.querySelector('.tune-slider[data-held]')).not.toBeNull();
    fireEvent.pointerMove(s, { clientX: x(0.5), pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(1.414);
    fireEvent.pointerMove(s, { clientX: x(-0.9), pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(0.5);
    fireEvent.pointerMove(s, { clientX: x(-5), pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(0.25);
    fireEvent.pointerUp(s, { pointerId: 1 });
    expect(document.querySelector('.tune-slider[data-held]')).toBeNull();
    const calls = onChange.mock.calls.length;
    fireEvent.pointerMove(s, { clientX: x(2), pointerId: 1 });
    expect(onChange).toHaveBeenCalledTimes(calls);
    expect(says()).toBe('¼×');
  });
});
