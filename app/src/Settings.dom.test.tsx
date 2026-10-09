// @vitest-environment happy-dom
//
// The render quality section in a DOM, with the app's commands and the output
// event stood in for: the line under the picker always speaks of the level
// shown, however the app's replies interleave. And the whole sheet: Sound shows
// the left and right channels under the picker, and Presets offers the full
// library and opens the credits in its place.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entry, Quality, QualityLevel } from './api.ts';
import type { PackStatus } from './pack.ts';

const app = vi.hoisted(() => ({
  qualityGet: vi.fn<() => Promise<Quality>>(),
  qualitySet: vi.fn<(level: QualityLevel) => Promise<Quality>>(),
  outputHeard: [] as ((status: unknown) => void)[],
  invoke: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: (cmd: string, args?: unknown) => app.invoke(cmd, args), convertFileSrc: (p: string) => p }));
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(() => {}) }) }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: () => Promise.resolve() }));

vi.mock('./api.ts', async (original) => ({ ...(await original<typeof import('./api.ts')>()), qualityGet: app.qualityGet, qualitySet: app.qualitySet }));
vi.mock('./output.ts', async (original) => ({
  ...(await original<typeof import('./output.ts')>()),
  onStatus: (f: (status: unknown) => void) => {
    app.outputHeard.push(f);
    return Promise.resolve(() => {
      app.outputHeard.splice(app.outputHeard.indexOf(f), 1);
    });
  },
}));

const { QualitySettings, Settings } = await import('./Settings.tsx');

const landscape: Quality = { chosen: 'auto', effective: 'medium', reason: 'Auto picked medium for Apple M1: about 9.0 ms a frame at 1920×1080.' };
const portrait: Quality = { chosen: 'auto', effective: 'high', reason: 'Auto picked high for Apple M1: about 6.0 ms a frame at 720×1280.' };
const low: Quality = { chosen: 'low', effective: 'low', reason: 'Chosen by you; auto would pick medium here.' };

/** A reply the test hands back when it likes. */
function later<T>() {
  let give!: (value: T) => void;
  const promise = new Promise<T>((resolve) => (give = resolve));
  return { promise, give };
}

/** The output opens, moves or closes. */
const outputChanges = () => act(async () => app.outputHeard.forEach((f) => f({ display: null, size: null })));

const line = () => screen.getByRole('status');

beforeEach(() => {
  app.qualityGet.mockReset();
  app.qualitySet.mockReset();
});
afterEach(cleanup);

describe('the render quality section', () => {
  it('reads the reason again when the output changes', async () => {
    app.qualityGet.mockResolvedValueOnce(landscape).mockResolvedValueOnce(portrait);
    render(<QualitySettings />);
    expect(await screen.findByText(landscape.reason)).toBeTruthy();
    await outputChanges();
    expect(line().textContent).toBe(portrait.reason);
    expect(app.qualityGet).toHaveBeenCalledTimes(2);
  });

  it('never puts an older reply back over a level just chosen', async () => {
    const user = userEvent.setup();
    const slow = later<Quality>();
    app.qualityGet.mockResolvedValueOnce(landscape).mockReturnValueOnce(slow.promise);
    app.qualitySet.mockResolvedValueOnce(low);
    render(<QualitySettings />);
    await screen.findByText(landscape.reason);

    // The output moves, and its read is still on its way when Low is chosen.
    await outputChanges();
    await user.click(screen.getByRole('radio', { name: 'Low' }));
    expect(app.qualitySet).toHaveBeenCalledWith('low');
    expect(line().textContent).toBe(low.reason);

    await act(async () => slow.give(portrait));
    expect(line().textContent).toBe(low.reason);
    expect(screen.getByRole('radio', { name: 'Low' }).getAttribute('aria-checked')).toBe('true');
  });
});

const STARTER: PackStatus = { starter: 120, installed: 120, total: 9795, size: 180000000, state: 'idle', received: 0, error: null };
const ENTRIES: Entry[] = [
  { path: '/p/a.milk', name: 'Geiss - Spiral', group: 'A' },
  { path: '/p/b.milk', name: 'Geiss - Tunnel', group: 'A' },
  { path: '/p/c.milk', name: 'Rovastar - Fractal', group: 'B' },
];

/** What the app's commands answer for the whole sheet. */
function answer(cmd: string): unknown {
  if (cmd === 'pack_status') return STARTER;
  if (cmd === 'presets') return ENTRIES;
  if (cmd === 'audio_sources') return { taps: false, sources: [{ id: { kind: 'device', name: 'Duet', size: 4 }, name: 'Duet', channels: 4 }] };
  if (cmd === 'listening') return { choice: { name: 'Duet', left: 1, right: 2, size: 4 }, channels: 4 };
  if (cmd === 'levels') return [0, 0];
  if (cmd === 'output_status') return { display: null, size: null };
  if (cmd === 'displays') return [];
  return null;
}

describe('the settings sheet', () => {
  beforeEach(() => {
    app.qualityGet.mockResolvedValue(landscape);
    app.invoke.mockReset();
    app.invoke.mockImplementation((cmd) => Promise.resolve(answer(cmd)));
  });

  const section = (name: string) => screen.getByRole('region', { name });

  it('shows the left and right channels under the sound picker, with no Advanced', async () => {
    render(<Settings open onClose={() => {}} />);
    const sound = section('Sound');
    const channels = await within(sound).findByRole('group', { name: 'left and right channels' });
    expect(within(channels).getByRole('combobox', { name: 'left channel' })).toBeTruthy();
    expect(within(channels).getByRole('combobox', { name: 'right channel' })).toBeTruthy();
    expect(within(sound).queryByText('Advanced')).toBeNull();
    expect(sound.querySelector('details')).toBeNull();
  });

  it('offers the full library under Presets, and opens the credits in its place and back', async () => {
    const user = userEvent.setup();
    render(<Settings open onClose={() => {}} />);
    const presets = section('Presets');
    expect(await within(presets).findByRole('button', { name: 'Get the full library: 9,795 presets (180 MB)' })).toBeTruthy();
    expect(await within(presets).findByText('3 presets')).toBeTruthy();

    await user.click(within(presets).getByRole('button', { name: 'Credits' }));
    expect(within(presets).getByRole('heading', { name: 'Credits' })).toBeTruthy();
    expect(within(presets).getByRole('list', { name: 'authors' }).textContent).toContain('Geiss');
    expect(within(presets).queryByRole('button', { name: /Get the full library/ })).toBeNull();

    await user.click(within(presets).getByRole('button', { name: '← Presets' }));
    expect(within(presets).queryByRole('heading', { name: 'Credits' })).toBeNull();
    expect(await within(presets).findByRole('button', { name: /Get the full library/ })).toBeTruthy();
  });
});
