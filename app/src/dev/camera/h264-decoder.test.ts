import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { H264Decoder } from './h264-decoder';
class FakeDecoder {
  static instances: FakeDecoder[] = [];
  static isConfigSupported = vi.fn(async () => ({ supported: true }));
  state = 'configured';
  configure = vi.fn();
  decode = vi.fn();
  close = vi.fn(() => {
    this.state = 'closed';
  });
  constructor(public callbacks: VideoDecoderInit) {
    FakeDecoder.instances.push(this);
  }
}
const bytes = new ArrayBuffer(5);
beforeEach(() => {
  FakeDecoder.instances = [];
  FakeDecoder.isConfigSupported.mockResolvedValue({ supported: true });
  vi.stubGlobal('VideoDecoder', FakeDecoder);
  vi.stubGlobal(
    'EncodedVideoChunk',
    class {
      constructor(public options: EncodedVideoChunkInit) {}
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
test('returns decoded frame ownership and reuses configured decoder for one-at-a-time keyframes', async () => {
  const decoder = new H264Decoder();
  const promise = decoder.decode(bytes, 'avc1.640028', 1280, 720, 1234);
  await vi.waitFor(() => expect(FakeDecoder.instances).toHaveLength(1));
  const frame = { close: vi.fn() } as unknown as VideoFrame;
  FakeDecoder.instances[0].callbacks.output(frame);
  expect(await promise).toBe(frame);
  expect(frame.close).not.toHaveBeenCalled();
  const second = decoder.decode(bytes, 'avc1.640028', 1280, 720, 1235);
  expect(FakeDecoder.instances).toHaveLength(1);
  await expect(decoder.decode(bytes, 'avc1.640028', 1280, 720, 1236)).rejects.toThrow('already in flight');
  FakeDecoder.instances[0].callbacks.output(frame);
  await second;
  decoder.dispose();
  expect(FakeDecoder.instances[0].close).toHaveBeenCalledOnce();
});
test('dispose rejects pending decode and closes a late output frame', async () => {
  const decoder = new H264Decoder();
  const promise = decoder.decode(bytes, 'avc1.640028', 1280, 720, 1);
  const rejected = expect(promise).rejects.toThrow('stopped');
  await vi.waitFor(() => expect(FakeDecoder.instances).toHaveLength(1));
  decoder.dispose();
  await rejected;
  const frame = { close: vi.fn() } as unknown as VideoFrame;
  FakeDecoder.instances[0].callbacks.output(frame);
  expect(frame.close).toHaveBeenCalledOnce();
});
test('dimension change closes old decoder and unsupported config fails explicitly', async () => {
  const decoder = new H264Decoder();
  const first = decoder.decode(bytes, 'avc1.640028', 1280, 720, 1);
  await vi.waitFor(() => expect(FakeDecoder.instances).toHaveLength(1));
  FakeDecoder.instances[0].callbacks.output({ close: vi.fn() } as unknown as VideoFrame);
  await first;
  const second = decoder.decode(bytes, 'avc1.640028', 1920, 1080, 2);
  await vi.waitFor(() => expect(FakeDecoder.instances).toHaveLength(2));
  expect(FakeDecoder.instances[0].close).toHaveBeenCalledOnce();
  FakeDecoder.instances[1].callbacks.output({ close: vi.fn() } as unknown as VideoFrame);
  await second;
  decoder.dispose();
  FakeDecoder.isConfigSupported.mockResolvedValue({ supported: false });
  await expect(new H264Decoder().decode(bytes, 'avc1.64002a', 1920, 1080, 3)).rejects.toThrow('profile unavailable');
});
test('decode stall has a bounded failure', async () => {
  vi.useFakeTimers();
  const decoder = new H264Decoder();
  const promise = decoder.decode(bytes, 'avc1.640028', 1280, 720, 1);
  const rejected = expect(promise).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(1501);
  await rejected;
  decoder.dispose();
});
