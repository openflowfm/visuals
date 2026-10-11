// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { waitFor } from '@testing-library/dom';

const getUserMedia = vi.fn();
let requests: string[];
let canvasEvents: { id: string; action: string; first?: number }[];
class MaskWorker {
  static instances: MaskWorker[] = [];
  static automatic = true;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  timestamp = 0;
  terminate = vi.fn();
  constructor() {
    MaskWorker.instances.push(this);
    queueMicrotask(() => this.onmessage?.({ data: { type: 'ready' } }));
  }
  postMessage(message: { timestamp: number }) {
    this.timestamp = message.timestamp;
    if (MaskWorker.automatic) queueMicrotask(() => this.complete());
  }
  complete() {
    this.onmessage?.({ data: { type: 'mask', mask: { data: new Float32Array(256 * 144).fill(1), width: 256, height: 144, inferenceMs: 1, capturedAt: this.timestamp } } });
  }
}

function outputResponse(url: string) {
  return url.includes('camera/output') ? new Response(new Uint8Array(4 * 2 * 2), { status: 200, headers: { 'X-Frame-Width': '2', 'X-Frame-Height': '2' } }) : new Response('null', { status: 200 });
}

beforeEach(async () => {
  vi.resetModules();
  document.body.innerHTML = '<div id="camera-app"></div>';
  sessionStorage.setItem('visuals.dev.bridge-token', 'test-token');
  requests = [];
  canvasEvents = [];
  MaskWorker.instances = [];
  MaskWorker.automatic = true;
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
  vi.stubGlobal('Worker', MaskWorker);
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
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    const id = this.id;
    const context = new Proxy(
      {
        getImageData: () => ({ data: new Uint8ClampedArray(320 * 180 * 4) }),
        putImageData: (image: ImageData) => {
          canvasEvents.push({ id, action: 'paint', first: image.data[0] });
        },
        clearRect: () => {
          canvasEvents.push({ id, action: 'clear' });
        },
      },
      { get: (target, key) => (key in target ? target[key as keyof typeof target] : vi.fn()), set: () => true },
    );
    return context as unknown as CanvasRenderingContext2D;
  });
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

test('mirror change discards delayed old-coordinate masks and acquires a fresh one', async () => {
  MaskWorker.automatic = false;
  document.getElementById('demo')!.click();
  await waitFor(() => expect(MaskWorker.instances[0]?.timestamp).toBeGreaterThan(0));
  const old = MaskWorker.instances[0];
  const mirror = document.getElementById('mirror') as HTMLInputElement;
  mirror.checked = !mirror.checked;
  mirror.dispatchEvent(new Event('change'));
  await waitFor(() => expect(MaskWorker.instances[1]?.timestamp).toBeGreaterThan(0));
  expect(old.terminate).toHaveBeenCalledOnce();
  old.complete();
  await new Promise((r) => setTimeout(r, 40));
  expect(requests.filter((r) => r.includes('camera/frame'))).toHaveLength(0);
  MaskWorker.instances[1].complete();
  await waitFor(() => expect(requests.some((r) => r.includes('camera/frame'))).toBe(true));
});

test('person-only transition drains old uploads, clears feedback and rejects late room output', async () => {
  MaskWorker.automatic = false;
  const person = document.getElementById('person-only') as HTMLInputElement;
  person.checked = false;
  let finishUpload!: () => void;
  let finishOutput!: () => void;
  let finishReset!: () => void;
  let heldUpload = false,
    heldOutput = false;
  vi.mocked(fetch).mockImplementation(async (url) => {
    const route = String(url);
    requests.push(route);
    if (route.includes('camera/frame') && !heldUpload) {
      heldUpload = true;
      await new Promise<void>((done) => {
        finishUpload = done;
      });
    }
    if (route.includes('camera/output') && !heldOutput) {
      heldOutput = true;
      await new Promise<void>((done) => {
        finishOutput = done;
      });
      return new Response(new Uint8Array(16).fill(99), { status: 200, headers: { 'X-Frame-Width': '2', 'X-Frame-Height': '2' } });
    }
    if (route.includes('camera/stop') && requests.filter((r) => r.includes('camera/stop')).length === 2)
      await new Promise<void>((done) => {
        finishReset = done;
      });
    return outputResponse(route);
  });
  document.getElementById('demo')!.click();
  await waitFor(() => expect(heldUpload && heldOutput).toBe(true));
  const eventsBefore = canvasEvents.length;
  person.checked = true;
  person.dispatchEvent(new Event('change'));
  expect(canvasEvents.slice(eventsBefore)).toEqual(
    expect.arrayContaining([
      { id: 'prepared', action: 'clear' },
      { id: 'output', action: 'clear' },
    ]),
  );
  await new Promise((r) => setTimeout(r, 20));
  expect(requests.filter((r) => r.includes('camera/stop'))).toHaveLength(1);
  finishUpload();
  await new Promise((r) => setTimeout(r, 20));
  expect(requests.filter((r) => r.includes('camera/stop'))).toHaveLength(1);
  finishOutput();
  await waitFor(() => expect(requests.filter((r) => r.includes('camera/stop'))).toHaveLength(2));
  expect(requests.filter((r) => r.includes('camera/settings'))).toHaveLength(1);
  expect(MaskWorker.instances).toHaveLength(0);
  finishReset();
  await waitFor(() => expect(MaskWorker.instances[0]?.timestamp).toBeGreaterThan(0));
  const lastStop = requests.map((r) => r.includes('camera/stop')).lastIndexOf(true);
  expect(requests.map((r) => r.includes('camera/settings')).lastIndexOf(true)).toBeGreaterThan(lastStop);
  expect(requests.filter((r) => r.includes('camera/stop'))).toHaveLength(2);
  expect(requests.filter((r) => r.includes('camera/frame'))).toHaveLength(1);
  expect(canvasEvents.some((e) => e.id === 'output' && e.action === 'paint' && e.first === 99)).toBe(false);
  MaskWorker.instances[0].complete();
  await waitFor(() => expect(requests.filter((r) => r.includes('camera/frame')).length).toBeGreaterThan(1));
});
