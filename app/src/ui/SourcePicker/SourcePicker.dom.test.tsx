// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../model/api';
import * as audio from '../model/audio-api';
import { channelPairs, sameSource, SourcePicker } from './SourcePicker';
vi.mock('../model/api', async (original) => ({
  ...(await original<typeof import('../model/api')>()),
  audioSources: vi.fn(),
  levels: vi.fn(),
}));
vi.mock('../model/audio-api', () => ({
  audioStatus: vi.fn(),
  chooseAudioLane: vi.fn(),
}));
const daw: api.Source = {
  id: { kind: 'app', bundle: 'live' },
  name: 'Live',
  channels: 2,
};
const mic: api.Source = {
  id: { kind: 'device', name: 'Microphone', size: 1 },
  name: 'Microphone',
  channels: 1,
};
const lane = (source: api.Source | null): audio.AudioLaneStatus => ({
  choice: source
    ? {
        name: source.name,
        size: source.channels,
        left: 1,
        right: Math.min(2, source.channels),
      }
    : null,
  source: source?.id ?? null,
  selected: source?.id ?? null,
  enabled: !!source,
  channels: source?.channels ?? 0,
  unavailable: false,
});
let state: audio.AudioStatus;
beforeEach(() => {
  state = { main: lane(daw), mic: lane(null) };
  vi.mocked(api.audioSources).mockResolvedValue({
    taps: true,
    sources: [daw, mic],
  });
  vi.mocked(api.levels).mockResolvedValue([0, 0]);
  vi.mocked(audio.audioStatus).mockImplementation(async () => state);
  vi.mocked(audio.chooseAudioLane).mockImplementation(async (which, source, left, right) => {
    state = {
      ...state,
      [which]: lane(source ? [daw, mic].find((s) => sameSource(s.id, source))! : null),
    };
    if (state[which].choice)
      state[which].choice = {
        ...state[which].choice!,
        left: left!,
        right: right!,
      };
    return state;
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});
const mount = async () => {
  render(<SourcePicker onError={(e) => expect.unreachable(String(e))} channels="shown" />);
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'listen to' }).textContent).toContain('Live'));
};
const key = (name: string, key: string) => fireEvent.keyDown(screen.getByRole('combobox', { name }), { key });
describe('audio mixer', () => {
  it('adds a mono microphone without replacing main and independently turns either off', async () => {
    await mount();
    key('microphone input', 'End');
    await waitFor(() => expect(audio.chooseAudioLane).toHaveBeenCalledWith('mic', mic.id, 1, 1));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'microphone input' }).textContent).toContain('Microphone'));
    expect(screen.getByRole('combobox', { name: 'listen to' }).textContent).toContain('Live');
    key('listen to', 'Home');
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'listen to' }).textContent).toContain('Off'));
    expect(state.mic.enabled).toBe(true);
    key('microphone input', 'Home');
    await waitFor(() => expect(state.mic.enabled).toBe(false));
  });
  it('holds selection while pending and reports rejection without pretending it changed', async () => {
    await mount();
    let reject!: (e: Error) => void;
    vi.mocked(audio.chooseAudioLane).mockImplementationOnce(
      () =>
        new Promise((_, no) => {
          reject = no;
        }),
    );
    key('microphone input', 'End');
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Connecting microphone'));
    expect((screen.getByRole('combobox', { name: 'listen to' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => reject(new Error('Permission denied')));
    expect(screen.getByRole('alert').textContent).toContain('Permission denied');
    expect(screen.getByRole('combobox', { name: 'microphone input' }).textContent).toContain('Off');
  });
  it('discards a late poll started before the selection', async () => {
    await mount();
    vi.useFakeTimers();
    let finish!: (s: audio.AudioStatus) => void;
    vi.mocked(audio.audioStatus).mockImplementationOnce(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    // Start a new mounted poll, then select while that read remains in flight.
    cleanup();
    render(<SourcePicker onError={() => {}} channels="shown" />);
    await act(async () => {});
    // Its list has not arrived: no selectable sources, so complete initial read first.
    await act(async () => finish(state));
    let stale!: (s: audio.AudioStatus) => void;
    vi.mocked(audio.audioStatus).mockImplementationOnce(
      () =>
        new Promise((done) => {
          stale = done;
        }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    const old = state;
    await act(async () => key('microphone input', 'End'));
    await act(async () => stale(old));
    expect(screen.getByRole('combobox', { name: 'microphone input' }).textContent).toContain('Microphone');
  });
  it('keeps an unavailable microphone selected and does not silently choose a replacement', async () => {
    state.mic = { ...lane(mic), source: null, unavailable: true };
    vi.mocked(api.audioSources).mockResolvedValue({
      taps: true,
      sources: [daw],
    });
    await mount();
    expect(screen.getByRole('combobox', { name: 'microphone input' }).textContent).toContain('Microphone (unavailable)');
    expect(screen.getByRole('status').textContent).toContain('waiting for the selected input');
    expect(audio.chooseAudioLane).not.toHaveBeenCalled();
  });
  it('matches app identities and distinct same-name device identities', () => {
    expect(sameSource(daw.id, { kind: 'app', bundle: 'other' })).toBe(false);
    const a = { kind: 'device' as const, name: 'Same', size: 2, uid: 'a' };
    const b = { ...a, uid: 'b' };
    expect(sameSource(a, b)).toBe(false);
    expect(sameSource(a, { ...a, name: 'Renamed' })).toBe(true);
  });
});
describe('folded', () => {
  it('keeps the source Select out of the header and puts it at the top of the mixer popover', async () => {
    render(<SourcePicker onError={(e) => expect.unreachable(String(e))} channels="none" folded />);
    const mixer = await screen.findByRole('button', { name: /Audio mixer: listening to Live/ });
    expect(screen.queryByRole('combobox', { name: 'listen to' })).toBeNull();
    fireEvent.click(mixer);
    const panel = await waitFor(() => document.getElementById(mixer.getAttribute('aria-controls')!)!);
    const main = panel.querySelector('[aria-label="Main source"]');
    expect(main).toBe(panel.querySelector('.vs-audio-lane'));
    expect(main?.querySelector('[role="combobox"]')?.textContent).toContain('Live');
    // One Select of stereo pairs for the channels, not an L and an R.
    expect(screen.queryByRole('combobox', { name: 'left channel' })).toBeNull();
    expect(panel.querySelector('.vs-audio-fold')).not.toBeNull();
  });
  it('offers stereo pairs, and mono for an odd last channel', () => {
    expect(channelPairs(1).map((p) => p.label)).toEqual(['1']);
    expect(channelPairs(2)).toEqual([{ label: '1–2', left: 1, right: 2 }]);
    expect(channelPairs(5).map((p) => p.label)).toEqual(['1–2', '3–4', '5']);
    expect(channelPairs(5)[2]).toEqual({ label: '5', left: 5, right: 5 });
  });
});
