// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emit, setBridge, type InvokeArgs } from '../model/ipc';
import { FLASH_WARNING, STEP_KEY, resetWelcomeEnded, showFlashWarning, showWelcome, useFlashWarning, useWelcome, type WarningStore } from './Onboarding';

/** A store whose answer is `understood`, recording each "I understand". */
function store(understood = false) {
  const understand = vi.fn(() => Promise.resolve());
  const s: WarningStore = { understood: vi.fn(() => Promise.resolve(understood)), understand };
  return { s, understand };
}

/** Every command answered by `answer` (a thrown error rejects). */
function bridge(answer: (cmd: string, args?: InvokeArgs) => unknown) {
  return setBridge({
    invoke: <T,>(cmd: string, args?: InvokeArgs) => {
      try {
        return Promise.resolve(answer(cmd, args) as T);
      } catch (e) {
        return Promise.reject(e);
      }
    },
  });
}

describe('useFlashWarning', () => {
  beforeEach(() => resetWelcomeEnded());

  it('opens an owed warning that close() cannot put away', async () => {
    const { s } = store(false);
    const firstRun = () => Promise.resolve(false);
    const { result } = renderHook(() => useFlashWarning(true, s, firstRun));
    await waitFor(() => expect(result.current.open).toBe('owed'));
    expect(result.current.owed).toBe(true);
    act(() => result.current.close());
    expect(result.current.open).toBe('owed');
  });

  it('understood() keeps the answer in the store and clears what was owed', async () => {
    const { s, understand } = store(false);
    const firstRun = () => Promise.resolve(false);
    const { result } = renderHook(() => useFlashWarning(true, s, firstRun));
    await waitFor(() => expect(result.current.open).toBe('owed'));
    act(() => result.current.understood());
    expect(understand).toHaveBeenCalledTimes(1);
    expect(result.current.owed).toBe(false);
    expect(result.current.open).toBeNull();
  });

  it("opens as 'asked' on the menu's event (and the page's), and close() clears it", async () => {
    const { s } = store(true);
    const { result } = renderHook(() => useFlashWarning(false, s, () => Promise.resolve(false)));
    await act(() => emit(FLASH_WARNING));
    expect(result.current.open).toBe('asked');
    act(() => result.current.close());
    expect(result.current.open).toBeNull();
    act(() => showFlashWarning());
    expect(result.current.open).toBe('asked');
  });

  it("doesn't ask whether it is owed while the welcome flow is up", async () => {
    const { s } = store(false);
    const firstRun = vi.fn(() => Promise.resolve(false));
    const { result } = renderHook(() => useFlashWarning(false, s, firstRun));
    await act(() => Promise.resolve());
    expect(firstRun).not.toHaveBeenCalled();
    expect(s.understood).not.toHaveBeenCalled();
    expect(result.current.owed).toBeNull();
    expect(result.current.open).toBeNull();
  });
});

describe('useWelcome', () => {
  let restore: (() => void) | null = null;
  afterEach(() => {
    restore?.();
    restore = null;
    localStorage.removeItem(STEP_KEY);
  });

  it('reads a failure to ask about the first run as not shown', async () => {
    restore = bridge(() => {
      throw new Error('no app');
    });
    const { result } = renderHook(() => useWelcome());
    expect(result.current.shown).toBeNull();
    await waitFor(() => expect(result.current.shown).toBe(false));
  });

  it('opens again on showWelcome() after close()', async () => {
    restore = bridge((cmd) => (cmd === 'first_run' ? true : null));
    const { result } = renderHook(() => useWelcome());
    await waitFor(() => expect(result.current.shown).toBe(true));
    act(() => result.current.close());
    expect(result.current.shown).toBe(false);
    act(() => showWelcome());
    expect(result.current.shown).toBe(true);
  });

  it('forgets a kept step when this is not the first run', async () => {
    localStorage.setItem(STEP_KEY, 'library');
    restore = bridge((cmd) => (cmd === 'first_run' ? false : null));
    const { result } = renderHook(() => useWelcome());
    await waitFor(() => expect(result.current.shown).toBe(false));
    expect(localStorage.getItem(STEP_KEY)).toBeNull();
  });

  it('keeps the step on the first run', async () => {
    localStorage.setItem(STEP_KEY, 'library');
    restore = bridge((cmd) => (cmd === 'first_run' ? true : null));
    const { result } = renderHook(() => useWelcome());
    await waitFor(() => expect(result.current.shown).toBe(true));
    expect(localStorage.getItem(STEP_KEY)).toBe('library');
  });
});
