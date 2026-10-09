// @vitest-environment happy-dom
//
// The render quality section in a DOM, with the app's commands and the output
// event stood in for: the line under the picker always speaks of the level
// shown, however the app's replies interleave.
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Quality, QualityLevel } from './api.ts';

const app = vi.hoisted(() => ({
  qualityGet: vi.fn<() => Promise<Quality>>(),
  qualitySet: vi.fn<(level: QualityLevel) => Promise<Quality>>(),
  outputHeard: [] as ((status: unknown) => void)[],
}));

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

const { QualitySettings } = await import('./Settings.tsx');

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
