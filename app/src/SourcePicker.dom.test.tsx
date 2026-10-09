// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from './api.ts';
import { SourcePicker } from './SourcePicker.tsx';

vi.mock('./api.ts', async (original) => ({
  ...(await original<typeof import('./api.ts')>()),
  audioSources: vi.fn(),
  listening: vi.fn(),
  levels: vi.fn(),
  listenToSource: vi.fn(),
}));

const LONG = 'Universal Audio Apollo Twin X Thunderbolt';
const apollo: api.Source = { id: { kind: 'device', name: LONG, size: 10 }, name: LONG, channels: 10 };
const daw: api.Source = { id: { kind: 'app', bundle: 'com.ableton.live' }, name: 'Ableton Live', channels: 2 };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the source picker in a DOM', () => {
  it("shows the source's full name in its tooltip, however narrow the header cuts the picker", async () => {
    vi.mocked(api.audioSources).mockResolvedValue({ taps: true, sources: [daw, apollo] });
    vi.mocked(api.listening).mockResolvedValue({ choice: { name: LONG, left: 1, right: 2, size: 10 }, channels: 10 });
    vi.mocked(api.levels).mockResolvedValue([0, 0]);
    render(<SourcePicker onError={(e) => expect.unreachable(String(e))} />);
    const picker = screen.getByRole('combobox', { name: 'listen to' });
    await waitFor(() => expect(picker.getAttribute('title')).toBe(`Listen to: ${LONG} (10 ch). Or pick your DAW, everything on this Mac, or a microphone or interface`));
  });
});
