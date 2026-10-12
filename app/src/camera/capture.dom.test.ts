// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const masks = vi.hoisted(() => ({ capturedAt: null as number | null, dispose: vi.fn(), update: vi.fn() }));
vi.mock('./person-mask', () => ({
  PersonMask: class {
    current() {
      return masks.capturedAt !== null && performance.now() - masks.capturedAt <= 250 ? { capturedAt: masks.capturedAt, width: 1, height: 1, data: new Float32Array([1]) } : null;
    }
    update = masks.update;
    dispose = masks.dispose;
  },
}));
import { BrowserCapture, createCameraController } from './capture';
import { DEFAULT_CAMERA_SETTINGS } from './controller';
let video: HTMLVideoElement;
let callback: VideoFrameRequestCallback;
const decode = (frames: number) => callback(performance.now(), { presentedFrames: frames } as VideoFrameCallbackMetadata);
beforeEach(() => {
  vi.restoreAllMocks();
  masks.capturedAt = null;
  masks.dispose.mockClear();
  masks.update.mockClear();
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((name: string) => {
    const element = create(name);
    if (name === 'video') {
      video = element as HTMLVideoElement;
      Object.defineProperty(video, 'readyState', { value: 2 });
      Object.defineProperty(video, 'srcObject', { value: null, writable: true });
      video.requestVideoFrameCallback = (next) => {
        callback = next;
        return 1;
      };
      video.cancelVideoFrameCallback = vi.fn();
    }
    return element;
  }) as typeof document.createElement);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  const ctx = { setTransform() {}, resetTransform() {}, drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(320 * 180 * 4).fill(255) }) };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
});
afterEach(() => vi.restoreAllMocks());
test('person-only fails closed until fresh mask, and stale/duplicate frames never refresh native', () => {
  const capture = new BrowserCapture({ getVideoTracks: () => [] } as unknown as MediaStream, vi.fn());
  decode(1);
  expect(capture.frame(DEFAULT_CAMERA_SETTINGS)).toBeNull();
  masks.capturedAt = performance.now() - 100;
  decode(2);
  const frame = capture.frame(DEFAULT_CAMERA_SETTINGS)!;
  expect(frame.remainingFreshMs).toBeGreaterThan(0);
  expect(frame.remainingFreshMs).toBeLessThanOrEqual(150);
  expect([...frame.rgba.slice(0, 4)]).toEqual([255, 255, 255, 255]);
  expect(capture.frame(DEFAULT_CAMERA_SETTINGS)).toBeNull();
  masks.capturedAt = performance.now() - 251;
  decode(3);
  expect(capture.frame(DEFAULT_CAMERA_SETTINGS)).toBeNull();
  capture.reset();
  expect(masks.dispose).toHaveBeenCalled();
  capture.dispose();
  expect(video.srcObject).toBeNull();
  expect(video.cancelVideoFrameCallback).toHaveBeenCalledWith(1);
});
test('explicit enable asks for video with audio false, denial is surfaced', async () => {
  const acquire = vi.fn().mockRejectedValue(new Error('Denied'));
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: acquire } });
  const controller = createCameraController();
  expect(acquire).not.toHaveBeenCalled();
  await controller.start();
  expect(acquire.mock.calls[0][0]).toMatchObject({ audio: false, video: { frameRate: { ideal: 60, max: 60 } } });
  expect(controller.state).toMatchObject({ status: 'failed', message: 'Denied' });
});
