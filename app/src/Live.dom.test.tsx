// @vitest-environment happy-dom
//
// Live's wiring of the Stage, mounted in a DOM with the app's commands faked
// and the Stage's parts stood in for (their lanes test them): the crate's mode
// at a window's width and the viewer's choice kept for next time, `\` hiding
// the panels, Esc's order (hidden panels, then a laid-over crate, then
// leaving), Home | Live, and the ? overlay listing the Stage's own controls.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Live } from './Live.tsx';
import { EMPTY_DECK } from './playlists.ts';
import { CRATE_KEY } from './live/stage-model.ts';
import type { StageCrateProps, StageHeadProps, StageLayoutProps } from './live/stage-model.ts';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args), convertFileSrc: (p: string) => p }));
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => {}) }));
// The silence banner asks for the levels in a loop; it isn't what these tests are about.
vi.mock('./Onboarding.tsx', async (original) => ({ ...(await original<object>()), SilenceBanner: () => null }));

// The Stage's parts, stood in for: what they were handed, in the DOM.
vi.mock('./live/StageLayout.tsx', async () => {
  const { createElement: h, Fragment } = await import('react');
  return {
    StageLayout: (p: StageLayoutProps) =>
      h(
        'div',
        { 'data-testid': 'stage', 'data-shown': String(p.panels.shown), 'data-width': p.width, 'data-in-window': String(p.inWindow) },
        p.panels.shown ? h(Fragment, null, p.head, p.crate, p.dock) : null,
        p.centre,
      ),
  };
});
vi.mock('./live/StageHead.tsx', async () => {
  const { createElement: h, Fragment } = await import('react');
  return {
    StageHead: (p: StageHeadProps) =>
      h(
        Fragment,
        null,
        h('button', { 'aria-label': 'crate', 'aria-expanded': p.crateOpen, onClick: p.onCrate }),
        h('button', { onClick: () => p.onView('home') }, 'home'),
        h('button', { onClick: p.onHelp }, 'help'),
      ),
    FullScreenOffer: () => h('p', null, 'Go full screen on…'),
  };
});
vi.mock('./live/StageCrate.tsx', async () => {
  const { createElement: h } = await import('react');
  return { StageCrate: (p: StageCrateProps) => h('nav', { 'aria-label': 'crate', 'data-mode': p.mode }) };
});
vi.mock('./live/StageDock.tsx', async () => {
  const { createElement: h } = await import('react');
  return { StageDock: () => h('section', { 'aria-label': 'Live controls' }) };
});

/** The displays connected, as `displays` answers. */
let displays = [
  { id: 1, index: 0, name: 'Built-in', width: 3024, height: 1964, main: true },
  { id: 2, index: 1, name: 'Projector', width: 1920, height: 1080, main: false },
];

function answer(cmd: string): unknown {
  if (cmd === 'playlists') return { playlists: [], deck: { ...EMPTY_DECK, current: '/p/a.milk' } };
  if (cmd === 'displays') return displays;
  if (cmd === 'output_open') return { display: 2, size: [1920, 1080] };
  if (cmd === 'library_index') return [];
  if (cmd === 'library_data') return { version: 1, presets: {} };
  return null;
}

const viewport = (width: number) => (window as unknown as { happyDOM: { setViewport(v: { width: number; height: number }): void } }).happyDOM.setViewport({ width, height: 900 });

async function mount(props: { windowed?: boolean } = {}) {
  const onMode = vi.fn();
  const r = render(<Live start={null} onMode={onMode} windowed={props.windowed} />);
  await act(async () => {});
  await act(async () => {});
  return { ...r, onMode };
}

const stage = () => screen.getByTestId('stage');
const crate = () => document.querySelector<HTMLElement>('nav[aria-label="crate"]')?.dataset.mode ?? null;
const toggle = () => screen.getByRole('button', { name: 'crate' });
const press = (key: string) => act(() => void fireEvent.keyDown(document.body, { key }));

beforeEach(() => {
  viewport(1440);
  localStorage.clear();
  displays = [
    { id: 1, index: 0, name: 'Built-in', width: 3024, height: 1964, main: true },
    { id: 2, index: 1, name: 'Projector', width: 1920, height: 1080, main: false },
  ];
  invoke.mockReset();
  invoke.mockImplementation((cmd: string) => Promise.resolve(answer(cmd)));
});
afterEach(cleanup);

describe("the Stage's crate, by the window's width", () => {
  it('docks in a wide window and starts put away in a narrow one, when the viewer never chose', async () => {
    await mount();
    expect(crate()).toBe('docked');
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    cleanup();
    viewport(900);
    await mount();
    expect(crate()).toBe('hidden');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  it("follows the viewer's choice kept from last time", async () => {
    localStorage.setItem(CRATE_KEY, '0');
    await mount();
    expect(crate()).toBe('hidden');
    cleanup();
    localStorage.setItem(CRATE_KEY, '1');
    viewport(900);
    await mount();
    expect(crate()).toBe('overlay');
  });

  it('follows the window as it is resized', async () => {
    await mount();
    expect(crate()).toBe('docked');
    await act(async () => {
      viewport(900);
      window.dispatchEvent(new Event('resize'));
    });
    expect(stage().dataset.width).toBe('900');
    expect(crate()).toBe('hidden');
  });

  it('is shown and put away by its toggle, kept for next time where it docks', async () => {
    await mount();
    await act(() => void fireEvent.click(toggle()));
    expect(crate()).toBe('hidden');
    expect(localStorage.getItem(CRATE_KEY)).toBe('0');
    await act(() => void fireEvent.click(toggle()));
    expect(crate()).toBe('docked');
    expect(localStorage.getItem(CRATE_KEY)).toBe('1');
  });

  it('is laid over the picture when shown in a narrow window, and not kept', async () => {
    viewport(900);
    await mount();
    await act(() => void fireEvent.click(toggle()));
    expect(crate()).toBe('overlay');
    expect(localStorage.getItem(CRATE_KEY)).toBeNull();
  });
});

describe("the Stage's keys", () => {
  it('\\ hides every panel, and shows them again', async () => {
    const { onMode } = await mount();
    await press('\\');
    expect(stage().dataset.shown).toBe('false');
    expect(screen.queryByRole('region', { name: 'Live controls' })).toBeNull();
    await press('\\');
    expect(stage().dataset.shown).toBe('true');
    expect(onMode).not.toHaveBeenCalled();
  });

  it('Esc shows hidden panels first, and only then leaves live', async () => {
    const { onMode } = await mount();
    await press('\\');
    await press('Escape');
    expect(stage().dataset.shown).toBe('true');
    expect(onMode).not.toHaveBeenCalled();
    await press('Escape');
    expect(onMode).toHaveBeenCalledWith('home', '/p/a.milk');
  });

  it('Esc puts a laid-over crate away before it leaves', async () => {
    viewport(900);
    const { onMode } = await mount();
    await act(() => void fireEvent.click(toggle()));
    expect(crate()).toBe('overlay');
    await press('Escape');
    expect(crate()).toBe('hidden');
    expect(onMode).not.toHaveBeenCalled();
    await press('Escape');
    expect(onMode).toHaveBeenCalledWith('home', '/p/a.milk');
  });

  it('lists the Stage’s own controls in the ? overlay', async () => {
    await mount();
    await press('?');
    const help = screen.getByRole('dialog');
    expect(help.textContent).toMatch(/Hide the controls/);
  });
});

describe('Live, around the Stage', () => {
  it('goes Home from the header’s Home | Live, with the preset playing', async () => {
    const { onMode } = await mount();
    await act(() => void fireEvent.click(screen.getByRole('button', { name: 'home' })));
    expect(onMode).toHaveBeenCalledWith('home', '/p/a.milk');
  });

  it('opens the output with two displays, and offers full screen when it plays in the window', async () => {
    await mount();
    expect(invoke.mock.calls.some(([c]) => c === 'output_open')).toBe(true);
    expect(stage().dataset.inWindow).toBe('false');
    expect(screen.queryByText('Go full screen on…')).toBeNull();
    cleanup();
    invoke.mockClear();
    await mount({ windowed: true });
    expect(invoke.mock.calls.some(([c]) => c === 'output_open')).toBe(false);
    expect(stage().dataset.inWindow).toBe('true');
    expect(screen.getByText('Go full screen on…')).toBeTruthy();
  });
});
