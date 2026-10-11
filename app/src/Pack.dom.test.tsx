// @vitest-environment happy-dom
//
// The pack bar (the library's foot and Settings' pack section) in a DOM, with
// the app's commands and events faked: once the full library is in it offers
// nothing, unless it came without its pictures, which it says, with the retry.
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackStatus } from './pack.ts';
import { PackBar } from './Pack.tsx';

const { invoke, heard } = vi.hoisted(() => ({
  invoke: vi.fn(),
  heard: new Map<string, Set<(e: { payload: unknown }) => void>>(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args), convertFileSrc: (p: string) => p }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: (name: string, f: (e: { payload: unknown }) => void) => {
    const all = heard.get(name) ?? new Set();
    heard.set(name, all.add(f));
    return Promise.resolve(() => void all.delete(f));
  },
}));
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(() => {}) }) }));

const WHOLE: PackStatus = { starter: 250, installed: 9795, total: 9795, size: 53_005_539, state: 'idle', received: 0, error: null, bare: false };
let status: PackStatus = WHOLE;

const progress = (s: PackStatus) => act(async () => heard.get('pack-progress')?.forEach((f) => f({ payload: s })));
const bar = () => render(<PackBar presets={9795} dropped={null} credits={false} onCredits={() => {}} />);

beforeEach(() => {
  status = WHOLE;
  heard.clear();
  invoke.mockReset();
  invoke.mockImplementation((cmd: string) => Promise.resolve(cmd === 'pack_status' ? status : null));
});
afterEach(cleanup);

describe('PackBar', () => {
  it('offers nothing once the full library is in with its pictures', async () => {
    bar();
    await act(async () => {});
    expect(invoke).toHaveBeenCalledWith('pack_status');
    expect(screen.queryByRole('button', { name: /full library|pictures/ })).toBeNull();
  });

  it('says the full library came without its pictures, retries for them, and says why that failed', async () => {
    status = { ...WHOLE, bare: true };
    const user = userEvent.setup();
    bar();
    expect(await screen.findByText("The full library came without its pictures: they couldn't be downloaded.")).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again for the pictures (53 MB)' }));
    expect(invoke).toHaveBeenCalledWith('pack_download');
    await progress({ ...status, state: 'failed', error: "couldn't reach the pack" });
    expect(screen.getByRole('alert').textContent).toBe("couldn't reach the pack");
    expect(screen.getByRole('button', { name: 'Try getting the pictures again (53 MB)' })).toBeTruthy();
    await progress({ ...WHOLE });
    expect(screen.queryByRole('button', { name: /pictures/ })).toBeNull();
  });
});
