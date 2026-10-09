// @vitest-environment happy-dom
//
// The library's pack offer in a DOM, with the app's commands and events faked:
// it offers the full library while only the starter set is in, follows the
// download's progress, and says nothing once more presets are in.
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackStatus } from './pack.ts';
import { offers, PackOffer } from './PackOffer.tsx';

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

const STARTER: PackStatus = { starter: 120, installed: 120, total: 9795, size: 180000000, state: 'idle', received: 0, error: null };
let status: PackStatus = STARTER;

/** The download's progress event. */
const progress = (s: PackStatus) => act(async () => heard.get('pack-progress')?.forEach((f) => f({ payload: s })));

beforeEach(() => {
  status = STARTER;
  heard.clear();
  invoke.mockReset();
  invoke.mockImplementation((cmd: string) => Promise.resolve(cmd === 'pack_status' ? status : null));
});
afterEach(cleanup);

describe('PackOffer', () => {
  it('offers the full library while only the starter set is in', async () => {
    render(<PackOffer />);
    const line = await screen.findByRole('status');
    expect(line.textContent).toContain('These are the 120 starter presets.');
    expect(screen.getByRole('button', { name: 'Get the full library: 9,795 presets (180 MB)' })).toBeTruthy();
  });

  it('shows nothing once more than the starter set is in', async () => {
    status = { ...STARTER, installed: 400 };
    const { container } = render(<PackOffer />);
    await act(async () => {});
    expect(invoke).toHaveBeenCalledWith('pack_status');
    expect(container.innerHTML).toBe('');
  });

  it('starts the download when pressed, and follows its progress', async () => {
    const user = userEvent.setup();
    render(<PackOffer />);
    await user.click(await screen.findByRole('button', { name: /Get the full library/ }));
    expect(invoke).toHaveBeenCalledWith('pack_download');
    await progress({ ...STARTER, state: 'downloading', received: 90000000 });
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');
  });

  it('says why a download failed, with the retry', async () => {
    render(<PackOffer />);
    await screen.findByRole('button');
    await progress({ ...STARTER, installed: 500, state: 'failed', error: 'No network.' });
    expect(screen.getByText('No network.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try getting the full library again' })).toBeTruthy();
  });
});

describe('offers', () => {
  it('offers while only the starter set is in', () => {
    expect(offers(STARTER)).toBe(true);
    expect(offers({ ...STARTER, installed: 0 })).toBe(true);
  });

  it('offers while a download runs or after one failed, whatever is in', () => {
    expect(offers({ ...STARTER, installed: 3000, state: 'downloading' })).toBe(true);
    expect(offers({ ...STARTER, installed: 3000, state: 'failed', error: 'No network.' })).toBe(true);
  });

  it('stops once more than the starter set is in', () => {
    expect(offers({ ...STARTER, installed: 121 })).toBe(false);
    expect(offers({ ...STARTER, installed: 9795 })).toBe(false);
  });
});
