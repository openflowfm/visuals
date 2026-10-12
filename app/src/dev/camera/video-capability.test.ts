import { afterEach, expect, test, vi } from 'vitest';
import { videoCapability } from './video-capability';
afterEach(() => vi.unstubAllGlobals());
test('missing WebCodecs reports unavailable without throwing', async () => {
  vi.stubGlobal('VideoDecoder', undefined);
  expect(await videoCapability()).toMatchObject({ codec: null, message: expect.stringContaining('VideoDecoder missing') });
});
test('checks hardware-preferred high profile then baseline fallback', async () => {
  const isConfigSupported = vi.fn(async (config: VideoDecoderConfig) => ({ supported: config.codec === 'avc1.42e028' }));
  vi.stubGlobal('VideoDecoder', { isConfigSupported });
  expect(await videoCapability()).toMatchObject({ codec: 'avc1.42e028' });
  expect(isConfigSupported.mock.calls.map(([config]) => config.codec)).toEqual(['avc1.640028', 'avc1.42e028']);
  expect(isConfigSupported.mock.calls[0][0].hardwareAcceleration).toBe('prefer-hardware');
});
test('rejected capability queries retain raw fallback', async () => {
  vi.stubGlobal('VideoDecoder', {
    isConfigSupported: vi.fn(async () => {
      throw new Error('Unsupported');
    }),
  });
  expect(await videoCapability()).toMatchObject({ codec: null, message: expect.stringContaining('raw output') });
});
