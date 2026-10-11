// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { waitFor } from '@testing-library/dom';

const getUserMedia = vi.fn();
let requests: string[];
beforeEach(async () => {
  vi.resetModules();
  document.body.innerHTML = '<div id="camera-app"></div>';
  sessionStorage.setItem('visuals.dev.bridge-token', 'test-token');
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requests.push(String(url));
      return new Response(String(url).includes('/frame?token') ? new Blob(['frame']) : 'null', { status: 200 });
    }),
  );
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 960, height: 540, close: vi.fn() })),
  );
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  const context = new Proxy(
    { getImageData: () => ({ data: new Uint8ClampedArray(640 * 360 * 4) }) },
    { get: (target, key) => (key in target ? target[key as keyof typeof target] : vi.fn()), set: () => true },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  await import('./main');
});
afterEach(async () => {
  const before = requests.filter((r) => r.includes('camera/stop')).length;
  const stop = document.getElementById('stop') as HTMLButtonElement;
  stop.disabled = false;
  stop.click();
  await waitFor(() => expect(requests.filter((r) => r.includes('camera/stop')).length).toBeGreaterThan(before));
  await new Promise((r) => setTimeout(r, 0));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  getUserMedia.mockReset();
});

test('does not request camera permission on load or in demo; demo reaches native bridge', async () => {
  expect(getUserMedia).not.toHaveBeenCalled();
  document.getElementById('demo')!.click();
  await waitFor(() => expect(requests.some((r) => r.includes('camera/frame?w=640&h=360'))).toBe(true));
  expect(getUserMedia).not.toHaveBeenCalled();
  expect(document.getElementById('signal')!.textContent).toContain('TEST SUBJECT');
  document.getElementById('stop')!.click();
  await waitFor(() => expect(document.getElementById('signal')!.textContent).toBe('NO INPUT'));
});

test('a permission grant arriving after Stop is released without sending camera frames', async () => {
  let grant!: (s: MediaStream) => void;
  const stopped = vi.fn();
  getUserMedia.mockImplementation(
    () =>
      new Promise<MediaStream>((r) => {
        grant = r;
      }),
  );
  document.getElementById('camera')!.click();
  await waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
  expect(getUserMedia.mock.calls[0][0].audio).toBe(false);
  document.getElementById('stop')!.click();
  grant({ getTracks: () => [{ stop: stopped }] } as unknown as MediaStream);
  await waitFor(() => expect(stopped).toHaveBeenCalledOnce());
  expect(requests.some((r) => r.includes('camera/frame'))).toBe(false);
});

test('permission denial is shown and leaves source stopped', async () => {
  getUserMedia.mockRejectedValue(new Error('Permission denied'));
  document.getElementById('camera')!.click();
  await waitFor(() => expect(document.getElementById('status')!.textContent).toContain('Permission denied'));
  expect(document.getElementById('signal')!.textContent).toBe('NO INPUT');
});

test('a delayed older stop cannot clear a newer demo session', async () => {
  let finishOldStop!: () => void;
  let stops = 0;
  vi.mocked(fetch).mockImplementation(async (url) => {
    requests.push(String(url));
    if (String(url).includes('camera/stop') && ++stops === 1)
      await new Promise<void>((r) => {
        finishOldStop = r;
      });
    return new Response('null', { status: 200 });
  });
  document.getElementById('demo')!.click();
  await waitFor(() => expect(stops).toBe(1));
  document.getElementById('demo')!.click();
  await new Promise((r) => setTimeout(r, 20));
  expect(requests.some((r) => r.includes('camera/settings') || r.includes('camera/frame'))).toBe(false);
  finishOldStop();
  await waitFor(() => expect(requests.some((r) => r.includes('camera/frame'))).toBe(true));
  const beforeFrame = requests.slice(
    0,
    requests.findIndex((r) => r.includes('camera/frame')),
  );
  expect(beforeFrame.filter((r) => r.includes('camera/stop'))).toHaveLength(2);
  expect(beforeFrame.filter((r) => r.includes('camera/settings'))).toHaveLength(1);
  expect(document.getElementById('signal')!.textContent).toContain('TEST SUBJECT');
});
