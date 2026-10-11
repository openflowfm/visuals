// @vitest-environment happy-dom
//
// The transport bar's time and the preset playing: a countdown while there is
// time left, the time on it alone once the length has run out (never "−0:00"
// stuck) or when it stays until moved on; the name and where it plays from on
// one line left of the time.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TransportBar, type TransportBarProps } from './TransportBar.tsx';

/** What the app's commands answer: the bar's meter and audio input, the frame rate, nothing else. */
const answer = (cmd: string): unknown => (cmd === 'levels' ? [0, 0] : cmd === 'stats' ? { fps: 60, cpu_ms: 1 } : ['audio_sources', 'inputs'].includes(cmd) ? [] : null);
vi.mock('@tauri-apps/api/core', () => ({ invoke: (cmd: string) => Promise.resolve(answer(cmd)), convertFileSrc: (p: string) => p }));
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => {}) }));

afterEach(cleanup);

const bar = (props: Partial<TransportBarProps>) => render(<TransportBar playing onPlayPause={() => {}} onStep={() => {}} stepIn="" position={null} onAudioError={() => {}} {...props} />);

describe('the time on the preset', () => {
  it('counts down while there is time left', () => {
    bar({ position: { elapsed: 12, length: 30 } });
    expect(screen.getByRole('progressbar', { name: 'time on this preset' }).getAttribute('aria-valuetext')).toBe('0:12 of 0:30');
    expect(screen.getByText('−0:18')).toBeTruthy();
  });

  it.each([
    [30, 30],
    [31, 30],
    [0, 0],
  ])('shows the time on it alone once the length has run out (%i s of %i)', (elapsed, length) => {
    bar({ position: { elapsed, length } });
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText(/^−/)).toBeNull();
    const timer = screen.getByRole('timer');
    expect(timer.textContent).toBe(`0:${String(elapsed).padStart(2, '0')}`);
    expect(timer.getAttribute('aria-label')).toBe(`time on this preset: ${timer.textContent}`);
  });

  it('says it stays until moved on when there is no length', () => {
    bar({ position: { elapsed: 75, length: null } });
    expect(screen.getByRole('timer').getAttribute('aria-label')).toBe('time on this preset: 1:15, until moved on');
  });
});

describe('the preset playing', () => {
  it('names it and where it plays from, on one line before the time', () => {
    const { container } = bar({ position: { elapsed: 12, length: 30 }, now: { name: 'Flexi - mindblob', from: 'from Warm-up · 3 of 10' } });
    const now = container.querySelector('.lay-transport-now')!;
    expect(now.querySelector('.lay-transport-name')!.textContent).toBe('Flexi - mindblob');
    expect(now.querySelector('.lay-transport-from')!.textContent).toBe('from Warm-up · 3 of 10');
    expect(now.getAttribute('title')).toBe('Flexi - mindblob from Warm-up · 3 of 10');
    expect(now.compareDocumentPosition(container.querySelector('.lay-transport-time')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('leaves out where from when not given, and everything when nothing plays', () => {
    const { container, rerender } = bar({ now: { name: 'Flexi - mindblob' } });
    expect(container.querySelector('.lay-transport-from')).toBeNull();
    rerender(<TransportBar playing onPlayPause={() => {}} onStep={() => {}} stepIn="" position={null} onAudioError={() => {}} now={null} />);
    expect(container.querySelector('.lay-transport-now')).toBeNull();
  });
});
