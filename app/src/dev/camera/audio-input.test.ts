import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { CameraAudio } from './audio-input';
let getUserMedia: ReturnType<typeof vi.fn>;
const track = { stop: vi.fn(), onended: null as null | (() => void), label: 'Test interface' };
const close = vi.fn(async () => {});
const sourceConnect = vi.fn();
beforeEach(() => {
  getUserMedia = vi.fn(async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }));
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal(
    'AudioContext',
    class {
      sampleRate = 48000;
      resume = async () => {};
      close = close;
      createAnalyser() {
        return { fftSize: 0, getFloatTimeDomainData: (data: Float32Array) => data.fill(0.25) };
      }
      createMediaStreamSource() {
        return { connect: sourceConnect };
      }
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
test('denial is visible, never sends samples', async () => {
  getUserMedia.mockRejectedValue(new Error('Permission denied'));
  const post = vi.fn(async (_route: string) => {}),
    state = vi.fn();
  const audio = new CameraAudio(post, state, vi.fn(), () => 1);
  await audio.start('');
  expect(state).toHaveBeenLastCalledWith('Permission denied', false);
  expect(post.mock.calls.every(([route]) => route === 'camera/audio/stop')).toBe(true);
});
test('stop drains in-flight PCM before reset, releases input and context; no speaker connection', async () => {
  let release!: () => void;
  const calls: string[] = [];
  const audio = new CameraAudio(
    async (route, body) => {
      calls.push(route);
      if (route.includes('?')) {
        expect(new DataView(body as ArrayBuffer).getFloat32(0, true)).toBe(0.25);
        await new Promise<void>((r) => (release = r));
      }
    },
    vi.fn(),
    vi.fn(),
    () => 2,
  );
  await audio.start('interface-id');
  expect(audio.active).toBe(true);
  expect(getUserMedia.mock.calls[0][0].audio.deviceId).toEqual({ exact: 'interface-id' });
  const stopping = audio.stop();
  await Promise.resolve();
  expect(calls.filter((r) => r === 'camera/audio/stop')).toHaveLength(1);
  release();
  await stopping;
  expect(calls.at(-1)).toBe('camera/audio/stop');
  expect(track.stop).toHaveBeenCalled();
  expect(close).toHaveBeenCalled();
  expect(sourceConnect).toHaveBeenCalledOnce();
});
test('late permission after stop is released without constructing audio graph', async () => {
  let grant!: (s: unknown) => void;
  getUserMedia.mockImplementation(() => new Promise((r) => (grant = r)));
  const audio = new CameraAudio(
    vi.fn(async () => {}),
    vi.fn(),
    vi.fn(),
    () => 1,
  );
  const starting = audio.start('');
  await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalled());
  await audio.stop();
  grant({ getTracks: () => [track] });
  await starting;
  expect(track.stop).toHaveBeenCalled();
  expect(sourceConnect).not.toHaveBeenCalled();
});
test('device ending disables capture and resets native audio', async () => {
  const post = vi.fn(async () => {});
  const state = vi.fn();
  const audio = new CameraAudio(post, state, vi.fn(), () => 1);
  await audio.start('');
  track.onended?.();
  await vi.waitFor(() => expect(state).toHaveBeenLastCalledWith('Audio input disconnected.', false));
  expect(audio.active).toBe(false);
});
