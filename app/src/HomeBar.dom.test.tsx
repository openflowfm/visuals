// @vitest-environment happy-dom
//
// The home's bottom bar mounted in a DOM, with the app's commands faked: what
// plays shows, ◀ ▶ R step, the panel toggle and go live call back, and the
// small preview shows only with `mini`, with nothing painted behind it.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { HomeBar, type HomeBarProps } from './HomeBar.tsx';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args), convertFileSrc: (p: string) => p }));
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => {}) }));
// The preview's placement asks the engine every frame; here it is only a box.
vi.mock('./preview.ts', () => ({ usePreview: () => true }));

function answer(cmd: string): unknown {
  if (cmd === 'listening') return { choice: null, channels: 0 };
  if (cmd === 'audio_sources') return { sources: [] };
  if (cmd === 'levels') return [0, 0];
  if (cmd === 'stats') return { fps: 60, cpu_ms: 1 };
  if (cmd === 'inputs') return [];
  return null;
}
invoke.mockImplementation((cmd: string) => Promise.resolve(answer(cmd)));

async function mount(over: Partial<HomeBarProps> = {}) {
  const props: HomeBarProps = {
    name: 'RadioActive Lightsticks 1',
    from: 'from the library · 7 of 412',
    onStep: vi.fn(),
    stepIn: '',
    panel: true,
    onPanel: vi.fn(),
    mini: false,
    onLive: vi.fn(),
    onAudioError: vi.fn(),
    ...over,
  };
  await act(async () => {
    render(<HomeBar {...props} />);
  });
  return props;
}

afterEach(() => {
  cleanup();
});

describe('HomeBar', () => {
  it('shows what plays and where from', async () => {
    await mount();
    expect(screen.getByText('RadioActive Lightsticks 1')).toBeTruthy();
    expect(screen.getByText('from the library · 7 of 412')).toBeTruthy();
  });

  it('says nothing is playing before anything plays', async () => {
    await mount({ name: null });
    expect(screen.getByText('nothing playing')).toBeTruthy();
  });

  it('steps back, on and at random', async () => {
    const p = await mount({ stepIn: ' in the playlist' });
    fireEvent.click(screen.getByRole('button', { name: 'previous preset' }));
    fireEvent.click(screen.getByRole('button', { name: 'next preset' }));
    fireEvent.click(screen.getByRole('button', { name: 'random preset' }));
    expect((p.onStep as ReturnType<typeof vi.fn>).mock.calls).toEqual([[-1], [1], [0]]);
    expect(screen.getByRole('button', { name: 'next preset' }).getAttribute('title')).toBe('next preset in the playlist (→)');
  });

  it('toggles the panel and goes live', async () => {
    const p = await mount({ panel: true });
    const toggle = screen.getByRole('button', { name: 'now playing panel' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    expect(p.onPanel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'go live' }));
    expect(p.onLive).toHaveBeenCalledTimes(1);
  });

  it('shows the small preview only with mini, and it opens the panel', async () => {
    await mount({ mini: false });
    expect(screen.queryByRole('img')).toBeNull();
    cleanup();
    const p = await mount({ mini: true, panel: false });
    expect(screen.getByRole('button', { name: 'now playing panel' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('img')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'show the now playing panel' }));
    expect(p.onPanel).toHaveBeenCalledTimes(1);
  });

  it.each([1440, 800])('paints nothing behind the small preview at %ipx', async (width) => {
    (window as unknown as { happyDOM: { setViewport(v: { width: number; height: number }): void } }).happyDOM.setViewport({ width, height: 900 });
    const style = document.createElement('style');
    // Read from disk: vitest hands a test empty CSS for an import, even `?raw`.
    const theme = ':root { --bg: rgb(1, 1, 1); --panel: rgb(2, 2, 2); --rail: rgb(3, 3, 3); --surface-control: rgb(4, 4, 4); }';
    style.textContent = [theme, ...['app.css', 'homebar.css'].map((f) => readFileSync(new URL(f, import.meta.url), 'utf8'))].join('\n');
    document.head.append(style);
    try {
      await mount({ mini: true, panel: false });
      const preview = screen.getByRole('img');
      const painted: string[] = [];
      for (let el: Element | null = preview; el; el = el.parentElement) {
        const bg = getComputedStyle(el).backgroundColor;
        // happy-dom reads `background: none` back as "none"; a browser as transparent.
        if (bg && !['none', 'transparent', 'rgba(0, 0, 0, 0)'].includes(bg)) painted.push(`${el.tagName.toLowerCase()}.${el.className}: ${bg}`);
      }
      expect(painted).toEqual([]);
      // The preview is the bar's first thing, so the cells after it paint over its shadow.
      const bar = screen.getByRole('region', { name: 'now playing' });
      expect(bar.firstElementChild?.contains(preview)).toBe(true);
    } finally {
      style.remove();
    }
  });
});
