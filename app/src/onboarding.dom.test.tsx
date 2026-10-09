// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { FlashWarning, showFlashWarning, useFlashWarning, type WarningStore } from './Onboarding.tsx';
import { startIn } from './output.ts';

afterEach(cleanup);

/** The app's answer, held in memory; `writes` counts each "I understand" kept. */
function memory(understood: boolean): { understood: boolean; writes: number; store: WarningStore } {
  const s: { understood: boolean; writes: number; store: WarningStore } = {
    understood,
    writes: 0,
    store: {
      understood: () => Promise.resolve(s.understood),
      understand: () => {
        s.understood = true;
        s.writes++;
        return Promise.resolve();
      },
    },
  };
  return s;
}

const done = () => Promise.resolve(false);

/** `App` as it lays the warning over a view, with the first run done. */
function Shell({ store, live }: { store: WarningStore; live: boolean }) {
  const warning = useFlashWarning(true, store, done);
  return (
    <FlashWarning warning={warning} live={live}>
      <p>{live ? 'playing live' : 'the library'}</p>
    </FlashWarning>
  );
}

/** Let the app's answers come back. */
const settle = () => act(() => new Promise((r) => setTimeout(r, 0)));

describe('the flashing-lights warning over the app', () => {
  it('holds live mode back while it is owed, and goes live once understood', async () => {
    const user = userEvent.setup();
    const app = memory(false);
    render(<Shell store={app.store} live />);
    expect(screen.queryByText('playing live')).toBeNull();
    await settle();
    const dialog = screen.getByRole('dialog', { name: 'Flashing lights' });
    expect(screen.queryByText('playing live')).toBeNull();
    // Owed: Esc doesn't put it away.
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(screen.queryByText('playing live')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'I understand' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('playing live')).toBeTruthy();
    expect(app.writes).toBe(1);
  });

  it('goes live at once when it was understood before', async () => {
    render(<Shell store={memory(true).store} live />);
    await settle();
    expect(screen.getByText('playing live')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows over the library when owed, which stays drawn beneath', async () => {
    render(<Shell store={memory(false).store} live={false} />);
    expect(screen.getByText('the library')).toBeTruthy();
    await settle();
    expect(screen.getByRole('dialog', { name: 'Flashing lights' })).toBeTruthy();
    expect(screen.getByText('the library')).toBeTruthy();
  });

  it('opens from the menu when not owed, and Esc puts it away', async () => {
    const user = userEvent.setup();
    const app = memory(true);
    render(<Shell store={app.store} live />);
    await settle();
    act(() => showFlashWarning());
    expect(screen.getByRole('dialog', { name: 'Flashing lights' })).toBeTruthy();
    expect(screen.getByText('playing live')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the view to start in', () => {
  it('follows VISUALS_VIEW and VISUALS_LIVE, as the app says them', () => {
    expect(startIn('live-windowed', 'home')).toEqual({ view: 'live', windowed: true });
    expect(startIn('live', 'home')).toEqual({ view: 'live' });
    expect(startIn('home', 'editor')).toEqual({ view: 'home' });
    expect(startIn(null, 'editor')).toEqual({ view: 'editor' });
  });

  it('opens the home on its library pane for VISUALS_VIEW=library, in any build', () => {
    expect(startIn('library', 'home')).toEqual({ view: 'home', library: true });
    expect(startIn('library', 'editor')).toEqual({ view: 'home', library: true });
  });
});
