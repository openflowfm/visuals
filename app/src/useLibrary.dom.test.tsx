// @vitest-environment happy-dom
//
// `useLibrary` (library.ts): the page's start preset against the one the app put
// back (`resume.rs`). While the app picks up where it left off, the page opens
// nothing of its own.
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entry, Resume } from './api.ts';
import { useLibrary } from './library.ts';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => {}) }));

const ENTRIES: Entry[] = ['a', 'b', 'c'].map((k) => ({ path: `/p/${k}.milk`, name: k, group: 'A' }));
let resume: Resume | null = null;

beforeEach(() => {
  resume = null;
  invoke.mockReset();
  invoke.mockImplementation((cmd: string) => Promise.resolve(cmd === 'presets' ? ENTRIES : cmd === 'resume_state' ? resume : null));
});
afterEach(cleanup);

/** The hook mounted, once the library is read: what it opened, and what it was told was put back. */
async function started(start: string | null = null) {
  const load = vi.fn();
  const onResumed = vi.fn();
  const fail = () => () => {};
  renderHook(() => useLibrary(start, load, fail, onResumed));
  await act(async () => {});
  return { load, onResumed };
}

describe('the page starting while the app picks up where it left off', () => {
  it('opens nothing of its own and shows the preset put back', async () => {
    resume = { playlist: null, index: null, current: '/p/b.milk', source: null };
    const { load, onResumed } = await started();
    expect(load).not.toHaveBeenCalled();
    expect(onResumed).toHaveBeenCalledWith(ENTRIES[1]);
  });

  it('opens a preset of its own with nothing to pick up', async () => {
    const { load, onResumed } = await started();
    expect(load).toHaveBeenCalledTimes(1);
    expect(onResumed).not.toHaveBeenCalled();
  });

  it('opens the preset it was started on without asking', async () => {
    resume = { playlist: null, index: null, current: '/p/b.milk', source: null };
    const { load } = await started('/p/c.milk');
    expect(load).toHaveBeenCalledWith(ENTRIES[2]);
    expect(invoke.mock.calls.some(([cmd]) => cmd === 'resume_state')).toBe(false);
  });
});
