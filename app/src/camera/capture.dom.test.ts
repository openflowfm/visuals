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
let draw: ReturnType<typeof vi.fn>;
let clear: ReturnType<typeof vi.fn>;
let transform: ReturnType<typeof vi.fn>;
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
      Object.defineProperty(video, 'videoWidth', { value: 640, configurable: true });
      Object.defineProperty(video, 'videoHeight', { value: 360, configurable: true });
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
  draw = vi.fn();
  clear = vi.fn();
  transform = vi.fn();
  const ctx = { setTransform: transform, resetTransform: vi.fn(), drawImage: draw, clearRect: clear, getImageData: () => ({ data: new Uint8ClampedArray(320 * 180 * 4).fill(255) }) };
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

test('4:3 and portrait inputs retain aspect ratio with centered padding and mirroring', () => {
  const capture = new BrowserCapture({ getVideoTracks: () => [] } as unknown as MediaStream, vi.fn());
  Object.defineProperty(video, 'videoHeight', { value: 480 });
  decode(1);
  capture.frame({ ...DEFAULT_CAMERA_SETTINGS, personOnly: false, mirror: true });
  expect(clear).toHaveBeenCalledWith(0, 0, 320, 180);
  expect(draw).toHaveBeenLastCalledWith(video, 40, 0, 240, 180);
  expect(transform).toHaveBeenLastCalledWith(-1, 0, 0, 1, 320, 0);
  expect(clear.mock.invocationCallOrder[0]).toBeLessThan(draw.mock.invocationCallOrder[0]);
  Object.defineProperty(video, 'videoWidth', { value: 360 });
  Object.defineProperty(video, 'videoHeight', { value: 640 });
  decode(2);
  capture.frame({ ...DEFAULT_CAMERA_SETTINGS, personOnly: false, mirror: false });
  expect(draw).toHaveBeenLastCalledWith(video, 109.375, 0, 101.25, 180);
  expect(transform).toHaveBeenLastCalledWith(1, 0, 0, 1, 0, 0);
  capture.dispose();
});

test('camera listing uses video devices only, observes devicechange, and exact selection never falls back', async () => {
  const media = new EventTarget();
  const acquire = vi.fn().mockRejectedValue(new Error('Selected camera unavailable'));
  const enumerateDevices = vi.fn(async () => [
    { kind: 'audioinput', deviceId: 'mic', label: 'Microphone' },
    { kind: 'videoinput', deviceId: '', label: '' },
    { kind: 'videoinput', deviceId: 'desk', label: '' },
  ]);
  Object.assign(media, { getUserMedia: acquire, enumerateDevices });
  const removed = vi.spyOn(media, 'removeEventListener');
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: media });
  const controller = createCameraController();
  const detach = controller.watchDevices();
  await Promise.resolve();
  await Promise.resolve();
  expect(controller.state.devices).toEqual([{ deviceId: 'desk', label: '' }]);
  expect(acquire).not.toHaveBeenCalled();
  controller.selectDevice('desk');
  expect(acquire).not.toHaveBeenCalled();
  await controller.start();
  expect(acquire).toHaveBeenCalledExactlyOnceWith({ audio: false, video: { deviceId: { exact: 'desk' }, width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 60, max: 60 } } });
  expect(controller.state.status).toBe('failed');
  media.dispatchEvent(new Event('devicechange'));
  expect(enumerateDevices).toHaveBeenCalledTimes(2);
  detach();
  expect(removed).toHaveBeenCalledWith('devicechange', expect.any(Function));
  media.dispatchEvent(new Event('devicechange'));
  expect(enumerateDevices).toHaveBeenCalledTimes(2);
});
