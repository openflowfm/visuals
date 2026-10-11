// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { waitFor } from '@testing-library/dom';

const getUserMedia = vi.fn();
let requests: string[];
function outputResponse(url: string) {
  return url.includes('camera/output') ? new Response(new Uint8Array(4 * 2 * 2), { status: 200, headers: { 'X-Frame-Width': '2', 'X-Frame-Height': '2' } }) : new Response('null', { status: 200 });
}

beforeEach(async () => {
  vi.resetModules();
  document.body.innerHTML = '<div id="camera-app"></div>';
  sessionStorage.setItem('visuals.dev.bridge-token', 'test-token');
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requests.push(String(url));
      return outputResponse(String(url));
    }),
  );
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 960, height: 540, close: vi.fn() })),
  );
  vi.stubGlobal(
    'Worker',
    class {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        queueMicrotask(() => this.onmessage?.({ data: { type: 'ready' } }));
      }
      postMessage() {
        queueMicrotask(() => this.onmessage?.({ data: { type: 'mask', mask: { data: new Float32Array(256 * 144).fill(1), width: 256, height: 144, inferenceMs: 1 } } }));
      }
      terminate() {}
    },
  );
  vi.stubGlobal(
    'ImageData',
    class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    },
  );
  vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  const context = new Proxy(
    { getImageData: () => ({ data: new Uint8ClampedArray(320 * 180 * 4) }) },
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
  await waitFor(() => expect(requests.some((r) => r.includes('camera/frame?w=320&h=180'))).toBe(true));
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
    return outputResponse(String(url));
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

test('person model failure never silently sends the whole scene', async () => {
  vi.stubGlobal(
    'Worker',
    class {
      constructor() {
        throw new Error('WASM unavailable');
      }
    },
  );
  document.getElementById('demo')!.click();
  await waitFor(() => expect(document.getElementById('mask-status')!.textContent).toContain('Person isolation unavailable'));
  expect(requests.some((r) => r.includes('camera/frame'))).toBe(false);
  const checkbox = document.getElementById('person-only') as HTMLInputElement;
  checkbox.checked = false;
  checkbox.dispatchEvent(new Event('change'));
  await waitFor(() => expect(requests.some((r) => r.includes('camera/frame'))).toBe(true));
  expect(document.getElementById('mask-status')!.textContent).toContain('Whole scene');
});

test('malformed raw output stops the input instead of drawing invalid data', async () => {
  vi.mocked(fetch).mockImplementation(async (url) => {
    requests.push(String(url));
    return String(url).includes('camera/output') ? new Response(new Uint8Array(1), { status: 200, headers: { 'X-Frame-Width': '2', 'X-Frame-Height': '2' } }) : outputResponse(String(url));
  });
  document.getElementById('demo')!.click();
  await waitFor(() => expect(document.getElementById('status')!.textContent).toContain('Invalid native RGBA'));
  expect(document.getElementById('signal')!.textContent).toBe('NO INPUT');
});
