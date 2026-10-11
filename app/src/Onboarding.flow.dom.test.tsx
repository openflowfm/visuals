// @vitest-environment happy-dom
//
// The welcome flow in a DOM, with the app's commands stood in for: picking a
// vibe finishes on Home (not live mode), and the step it was on is kept, so a
// flow left halfway resumes there at the next launch.
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const app = vi.hoisted(() => ({ invoke: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: (cmd: string, args?: unknown) => app.invoke(cmd, args), convertFileSrc: (p: string) => p }));
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => {}) }));

const { Onboarding, STEP_KEY } = await import('./Onboarding.tsx');
const { EMPTY_DECK } = await import('./playlists.ts');

/** What the app answers each command the flow sends. */
const answer = (cmd: string): unknown => {
  switch (cmd) {
    case 'link_state':
      return { enabled: false, peers: 0 };
    case 'playlists':
      return { playlists: [], deck: EMPTY_DECK };
    case 'reduced_motion':
      return { reduced: false, system: true };
    case 'flash_warning_understood':
      return false;
    case 'levels':
      return [0, 0];
    case 'stats':
      return { fps: 0 };
    default:
      return null;
  }
};

const settle = () => act(() => new Promise((r) => setTimeout(r, 0)));

beforeEach(() => {
  localStorage.clear();
  app.invoke.mockReset();
  app.invoke.mockImplementation((cmd) => Promise.resolve(answer(cmd)));
});
afterEach(cleanup);

describe('the welcome flow', () => {
  it('ends on Home once a vibe is picked, with the first run done and no step kept', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<Onboarding start="vibe" onDone={onDone} />);
    await settle();
    await user.click(screen.getByRole('button', { name: /Surprise me/ }));
    await settle();
    expect(onDone).toHaveBeenCalledWith('home');
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(app.invoke).toHaveBeenCalledWith('act', { action: { kind: 'random' } });
    expect(app.invoke).toHaveBeenCalledWith('first_run_done', undefined);
    expect(localStorage.getItem(STEP_KEY)).toBeNull();
  });

  it('keeps the step it is on, and starts there at the next launch', async () => {
    const user = userEvent.setup();
    const first = render(<Onboarding onDone={() => {}} />);
    expect(screen.getByRole('heading', { name: /Welcome to/ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await settle();
    expect(localStorage.getItem(STEP_KEY)).toBe('listen');
    first.unmount();

    // Quit and launched again: the flow is back on the step it was left on.
    render(<Onboarding onDone={() => {}} />);
    await settle();
    expect(screen.queryByRole('heading', { name: /Welcome to/ })).toBeNull();
    expect(screen.getByRole('main').getAttribute('aria-label')).toBe('listen to');
  });

  it('forgets the kept step when skipped', async () => {
    const user = userEvent.setup();
    localStorage.setItem(STEP_KEY, 'warning');
    const onDone = vi.fn();
    render(<Onboarding onDone={onDone} />);
    await settle();
    expect(screen.getByRole('heading', { name: 'Flashing lights' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Skip setup' }));
    expect(onDone).toHaveBeenCalledWith('skipped');
    expect(localStorage.getItem(STEP_KEY)).toBeNull();
  });
});
