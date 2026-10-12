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
  if (url.includes('camera/presets'))
    return Response.json([
      ...['Chromatic vortex', 'Prism cult', 'Acid tide'].map((title, i) => ({ id: `camera:${i}`, title, authors: ['OpenFlow'], thumbnail: null })),
      ...Array.from({ length: 120 }, (_, i) => ({ id: `pack:${i}`, title: `Library preset ${i}`, authors: ['Test author'], thumbnail: null })),
    ]);
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
        createLinearGradient: () => ({ addColorStop: vi.fn() }),
        drawImage: (source: object) => {
          canvasEvents.push({ id, action: 'displayWidth' in source ? 'decoded' : 'draw' });
        },
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
  await waitFor(() => expect(requests.some((r) => r.includes('camera/contours'))).toBe(true));
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
  expect(getUserMedia.mock.calls[0][0].video.frameRate).toEqual({ ideal: 60, max: 60 });
  document.getElementById('stop')!.click();
  grant({ getTracks: () => [{ stop: stopped }] } as unknown as MediaStream);
  await waitFor(() => expect(stopped).toHaveBeenCalledOnce());
  expect(requests.some((r) => r.match(/camera\/(?:frame|contours)/))).toBe(false);
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
  expect(requests.some((r) => r.includes('camera/settings') || r.match(/camera\/(?:frame|contours)/))).toBe(false);
  finishOldStop();
  await waitFor(() => expect(requests.some((r) => r.match(/camera\/(?:frame|contours)/))).toBe(true));
  const beforeFrame = requests.slice(
    0,
    requests.findIndex((r) => r.match(/camera\/(?:frame|contours)/)),
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
  expect(requests.some((r) => r.match(/camera\/(?:frame|contours)/))).toBe(false);
  const checkbox = document.getElementById('person-only') as HTMLInputElement;
  checkbox.checked = false;
  checkbox.dispatchEvent(new Event('change'));
  await waitFor(() => expect(requests.some((r) => r.match(/camera\/(?:frame|contours)/))).toBe(true));
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
  expect(requests.filter((r) => r.match(/camera\/(?:frame|contours)/))).toHaveLength(0);
  MaskWorker.instances[1].complete();
  await waitFor(() => expect(requests.some((r) => r.match(/camera\/(?:frame|contours)/))).toBe(true));
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
    if (route.match(/camera\/(?:frame|contours)/) && !heldUpload) {
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
      { id: 'identity-source', action: 'clear' },
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
  expect(requests.filter((r) => r.match(/camera\/(?:frame|contours)/))).toHaveLength(1);
  expect(canvasEvents.some((e) => e.id === 'output' && e.action === 'paint' && e.first === 99)).toBe(false);
  MaskWorker.instances[0].complete();
  await waitFor(() => expect(requests.filter((r) => r.match(/camera\/(?:frame|contours)/)).length).toBeGreaterThan(1));
});

test('identity waits for accepted upload and is discarded when its person mask expires', async () => {
  MaskWorker.automatic = false;
  let accept!: () => void;
  vi.mocked(fetch).mockImplementation(async (url) => {
    requests.push(String(url));
    if (String(url).match(/camera\/(?:frame|contours)/) && !accept)
      await new Promise<void>((resolve) => {
        accept = resolve;
      });
    return outputResponse(String(url));
  });
  document.getElementById('demo')!.click();
  await waitFor(() => expect(MaskWorker.instances[0]?.timestamp).toBeGreaterThan(0));
  MaskWorker.instances[0].complete();
  await waitFor(() => expect(accept).toBeDefined());
  expect(canvasEvents.some((event) => event.id === 'identity-source' && event.action === 'paint')).toBe(false);
  accept();
  await waitFor(() => expect(canvasEvents.some((event) => event.id === 'identity-source' && event.action === 'paint')).toBe(true));
  const lastPaint = canvasEvents.length;
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(canvasEvents.slice(lastPaint).some((event) => event.id === 'identity-source' && event.action === 'clear')).toBe(true);
  // Drain any next pending upload before teardown Stop waits for it.
  accept();
});

test('raw comparison disables contour-only controls and returning to Contours restores them', () => {
  const controls = ['detail', 'threshold', 'color', 'recognition'].map((id) => document.getElementById(id) as HTMLInputElement);
  document.getElementById('raw-mode')!.click();
  for (const control of controls) expect(control.disabled).toBe(true);
  document.getElementById('contour-mode')!.click();
  for (const control of controls) expect(control.disabled).toBe(false);
});

test('preset dock loads searchable catalog and sends native preset IDs without restarting the source', async () => {
  document.getElementById('demo')!.click();
  await waitFor(() => expect(requests.some((r) => r.match(/camera\/(?:frame|contours)/))).toBe(true));
  const stops = requests.filter((r) => r.includes('camera/stop')).length;
  document.getElementById('next-preset')!.click();
  await waitFor(() => expect(document.getElementById('browse-presets')!.textContent).toContain('Prism cult'));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).includes('camera/settings') && String(init?.body).includes('camera:1'))).toBe(true));
  const selectedRequest = vi.mocked(fetch).mock.calls.find(([url, init]) => String(url).includes('camera/settings') && String(init?.body).includes('camera:1'));
  expect(JSON.parse(String(selectedRequest?.[1]?.body))).toMatchObject({ presetId: 'camera:1', speed: 0.4, persistence: 0.65, resolution: '720p' });
  expect(requests.filter((r) => r.includes('camera/stop'))).toHaveLength(stops);
  document.getElementById('browse-presets')!.click();
  expect(document.getElementById('preset-browser')!.hidden).toBe(false);
  const search = document.getElementById('preset-search') as HTMLInputElement;
  search.value = 'acid';
  search.dispatchEvent(new Event('input'));
  expect(document.querySelectorAll('.preset-row')).toHaveLength(1);
  expect(document.querySelector('.preset-row')!.textContent).toContain('Acid tide');
});

test('native dimensions resize the canvas and HD request is sent at startup', async () => {
  document.getElementById('demo')!.click();
  await waitFor(() => expect((document.getElementById('output') as HTMLCanvasElement).width).toBe(2));
  expect((document.getElementById('output') as HTMLCanvasElement).height).toBe(2);
  expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).includes('camera/settings') && String(init?.body).includes('720p'))).toBe(true);
});

test('large catalog mounts only sixty rows and searching reaches later pages', async () => {
  await waitFor(() => expect(document.getElementById('preset-count')!.textContent).toContain('123 presets'));
  expect(document.querySelectorAll('.preset-row')).toHaveLength(60);
  document.getElementById('preset-page-next')!.click();
  expect(document.querySelectorAll('.preset-row')).toHaveLength(60);
  const search = document.getElementById('preset-search') as HTMLInputElement;
  search.value = 'Library preset 119';
  search.dispatchEvent(new Event('input'));
  expect(document.querySelectorAll('.preset-row')).toHaveLength(1);
  expect(document.querySelector('.preset-row')!.textContent).toContain('119');
});

test('rejected preset restores accepted choice and a later start uses the accepted ID', async () => {
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    requests.push(String(url));
    if (String(url).includes('camera/settings') && String(init?.body).includes('camera:1')) return new Response('Preset missing', { status: 422 });
    return outputResponse(String(url));
  });
  document.querySelector<HTMLButtonElement>('[data-preset="1"]')!.click();
  await waitFor(() => expect(document.getElementById('preset-error')!.textContent).toContain('Preset missing'));
  expect(document.getElementById('browse-presets')!.textContent).toContain('Chromatic vortex');
  expect(document.querySelector('[data-preset="0"]')!.classList.contains('selected')).toBe(true);
  document.getElementById('demo')!.click();
  await waitFor(() => expect(requests.some((r) => r.match(/camera\/(?:frame|contours)/))).toBe(true));
  const settings = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('camera/settings'));
  expect(JSON.parse(String(settings.at(-1)?.[1]?.body)).presetId).toBe('camera:0');
});

test('late rejected older choice does not restore over the newest selected preset', async () => {
  let rejectOlder!: () => void;
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    requests.push(String(url));
    if (String(url).includes('camera/settings') && String(init?.body).includes('camera:1')) {
      await new Promise<void>((r) => (rejectOlder = r));
      return new Response('Old preset failed', { status: 422 });
    }
    return outputResponse(String(url));
  });
  document.querySelector<HTMLButtonElement>('[data-preset="1"]')!.click();
  await waitFor(() => expect(rejectOlder).toBeDefined());
  document.querySelector<HTMLButtonElement>('[data-preset="2"]')!.click();
  rejectOlder();
  await waitFor(() => expect(document.getElementById('credits')!.textContent).toContain('Acid tide'));
  expect(document.getElementById('browse-presets')!.textContent).toContain('Acid tide');
  expect(document.getElementById('preset-error')!.textContent).toBe('');
});

test('starting while a preset selection is pending reloads the accepted new preset', async () => {
  let acceptSelection!: () => void;
  let settingsCount = 0;
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    requests.push(String(url));
    if (String(url).includes('camera/settings') && ++settingsCount === 1) {
      expect(JSON.parse(String(init?.body)).presetId).toBe('camera:1');
      await new Promise<void>((resolve) => (acceptSelection = resolve));
    }
    return outputResponse(String(url));
  });
  document.querySelector<HTMLButtonElement>('[data-preset="1"]')!.click();
  await waitFor(() => expect(acceptSelection).toBeDefined());
  document.getElementById('demo')!.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(settingsCount).toBe(1);
  acceptSelection();
  await waitFor(() => expect(requests.some((r) => r.match(/camera\/(?:frame|contours)/))).toBe(true));
  const settingsRequests = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('camera/settings'));
  expect(settingsRequests.map(([, init]) => JSON.parse(String(init?.body)).presetId)).toEqual(['camera:1', 'camera:1']);
  expect(document.getElementById('browse-presets')!.textContent).toContain('Prism cult');
});

test('slow output cannot create parallel requests and stop rejects its late frame', async () => {
  let release!: () => void;
  let outputCalls = 0;
  vi.mocked(fetch).mockImplementation(async (url) => {
    requests.push(String(url));
    if (String(url).includes('camera/output')) {
      outputCalls++;
      await new Promise<void>((resolve) => (release = resolve));
    }
    return outputResponse(String(url));
  });
  document.getElementById('demo')!.click();
  await waitFor(() => expect(outputCalls).toBe(1));
  await new Promise((resolve) => setTimeout(resolve, 80));
  expect(outputCalls).toBe(1);
  document.getElementById('stop')!.click();
  const before = canvasEvents.length;
  release();
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(canvasEvents.slice(before).some((e) => e.id === 'output' && e.action === 'paint')).toBe(false);
  expect(outputCalls).toBe(1);
});

test('duplicate native frame IDs report unique render FPS rather than request throughput', async () => {
  vi.mocked(fetch).mockImplementation(async (url) => {
    requests.push(String(url));
    return String(url).includes('camera/output')
      ? new Response(new Uint8Array(16), { status: 200, headers: { 'X-Frame-Width': '2', 'X-Frame-Height': '2', 'X-Frame-Sequence': '123', 'X-Snapshot-Ms': '7.25' } })
      : outputResponse(String(url));
  });
  document.getElementById('demo')!.click();
  await waitFor(() => expect(document.getElementById('rate')!.textContent).toMatch(/^[01] NATIVE FPS/), { timeout: 2000 });
  expect(requests.filter((r) => r.includes('camera/output')).length).toBeGreaterThan(5);
  expect(document.getElementById('timings')!.textContent).toContain('Native snapshot 7.3 ms');
  expect(document.getElementById('sustained-rate')!.textContent).toContain('rolling sample');
});

test('legacy output without frame IDs labels request throughput honestly', async () => {
  document.getElementById('demo')!.click();
  await waitFor(() => expect(document.getElementById('rate')!.textContent).toContain('READS/S / native FPS unavailable'), { timeout: 2000 });
});

test('encoded output closes decoded frames and raw comparison disposes its decoder', async () => {
  const closed = vi.fn();
  const decoderClosed = vi.fn();
  vi.stubGlobal(
    'EncodedVideoChunk',
    class {
      constructor(public options: EncodedVideoChunkInit) {}
    },
  );
  vi.stubGlobal(
    'VideoDecoder',
    class {
      static isConfigSupported = async () => ({ supported: true });
      state = 'configured';
      constructor(private callbacks: VideoDecoderInit) {}
      configure() {}
      decode() {
        queueMicrotask(() => this.callbacks.output({ displayWidth: 2, displayHeight: 2, close: closed } as unknown as VideoFrame));
      }
      close() {
        this.state = 'closed';
        decoderClosed();
      }
    },
  );
  let sequence = 0;
  vi.mocked(fetch).mockImplementation(async (url) => {
    requests.push(String(url));
    return String(url).includes('camera/video?')
      ? new Response(new Uint8Array(5), {
          status: 200,
          headers: { 'X-Frame-Width': '2', 'X-Frame-Height': '2', 'X-Frame-Sequence': String(++sequence), 'X-Frame-Timestamp': String(sequence * 16667), 'X-Video-Codec': 'avc1.640028' },
        })
      : outputResponse(String(url));
  });
  vi.resetModules();
  await import('./main');
  await waitFor(() => expect(document.getElementById('video-capability')!.textContent).toContain('supported'));
  document.getElementById('demo')!.click();
  await waitFor(() => expect(closed).toHaveBeenCalled());
  const outputEvents = canvasEvents.filter((event) => event.id === 'output');
  const decodedAt = outputEvents.findIndex((event) => event.action === 'decoded');
  expect(decodedAt).toBeGreaterThan(0);
  expect(outputEvents[decodedAt - 1].action).toBe('clear');
  expect(vi.mocked(HTMLCanvasElement.prototype.getContext).mock.calls.some(([kind, options]) => kind === '2d' && (options as CanvasRenderingContext2DSettings | undefined)?.alpha === false)).toBe(
    true,
  );
  const select = document.getElementById('output-transport') as HTMLSelectElement;
  select.value = 'raw';
  select.dispatchEvent(new Event('change'));
  await waitFor(() => expect(requests.some((r) => r.includes('camera/output'))).toBe(true));
  expect(decoderClosed).toHaveBeenCalledOnce();
});

test('unavailable encoded service visibly falls back to raw output', async () => {
  vi.stubGlobal('VideoDecoder', { isConfigSupported: async () => ({ supported: true }) });
  vi.mocked(fetch).mockImplementation(async (url) => {
    requests.push(String(url));
    return String(url).includes('camera/video?') ? new Response('Hardware encoder unavailable', { status: 503 }) : outputResponse(String(url));
  });
  vi.resetModules();
  await import('./main');
  await waitFor(() => expect(document.getElementById('video-capability')!.textContent).toContain('supported'));
  document.getElementById('demo')!.click();
  await waitFor(() => expect(requests.some((r) => r.includes('camera/output'))).toBe(true));
  expect(document.getElementById('transport-status')!.textContent).toContain('Raw fallback · video 503');
  expect(document.getElementById('signal')!.textContent).toContain('TEST SUBJECT');
});

test('Stop during overlapped encoded fetch aborts prefetch and closes late decoded output', async () => {
  let callbacks!: VideoDecoderInit;
  const decoderClosed = vi.fn();
  const frameClosed = vi.fn();
  vi.stubGlobal(
    'EncodedVideoChunk',
    class {
      constructor(public options: EncodedVideoChunkInit) {}
    },
  );
  vi.stubGlobal(
    'VideoDecoder',
    class {
      static isConfigSupported = async () => ({ supported: true });
      state = 'configured';
      constructor(init: VideoDecoderInit) {
        callbacks = init;
      }
      configure() {}
      decode() {}
      close() {
        this.state = 'closed';
        decoderClosed();
      }
    },
  );
  let videoCalls = 0,
    aborted = false;
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    requests.push(String(url));
    if (String(url).includes('camera/video?')) {
      if (++videoCalls === 1)
        return new Response(new Uint8Array(5), { headers: { 'X-Frame-Width': '2', 'X-Frame-Height': '2', 'X-Frame-Sequence': '1', 'X-Frame-Timestamp': '16667', 'X-Video-Codec': 'avc1.640028' } });
      return await new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('Aborted'));
        }),
      );
    }
    return outputResponse(String(url));
  });
  vi.resetModules();
  await import('./main');
  await waitFor(() => expect(document.getElementById('video-capability')!.textContent).toContain('supported'));
  document.getElementById('demo')!.click();
  await waitFor(() => expect(videoCalls).toBe(2));
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(videoCalls).toBe(2);
  document.getElementById('stop')!.click();
  await waitFor(() => expect(aborted).toBe(true));
  expect(decoderClosed).toHaveBeenCalledOnce();
  callbacks.output({ displayWidth: 2, displayHeight: 2, close: frameClosed } as unknown as VideoFrame);
  expect(frameClosed).toHaveBeenCalledOnce();
  expect(videoCalls).toBe(2);
});

test('decode failure cancels prefetched packet before raw fallback continues', async () => {
  let callbacks!: VideoDecoderInit;
  vi.stubGlobal(
    'EncodedVideoChunk',
    class {
      constructor(public options: EncodedVideoChunkInit) {}
    },
  );
  vi.stubGlobal(
    'VideoDecoder',
    class {
      static isConfigSupported = async () => ({ supported: true });
      state = 'configured';
      constructor(init: VideoDecoderInit) {
        callbacks = init;
      }
      configure() {}
      decode() {}
      close() {
        this.state = 'closed';
      }
    },
  );
  let videoCalls = 0,
    aborted = false;
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    requests.push(String(url));
    if (String(url).includes('camera/video?')) {
      if (++videoCalls === 1)
        return new Response(new Uint8Array(5), { headers: { 'X-Frame-Width': '2', 'X-Frame-Height': '2', 'X-Frame-Sequence': '1', 'X-Frame-Timestamp': '16667', 'X-Video-Codec': 'avc1.640028' } });
      return await new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('Aborted'));
        }),
      );
    }
    return outputResponse(String(url));
  });
  vi.resetModules();
  await import('./main');
  await waitFor(() => expect(document.getElementById('video-capability')!.textContent).toContain('supported'));
  document.getElementById('demo')!.click();
  await waitFor(() => expect(videoCalls).toBe(2));
  callbacks.error(new DOMException('Decode rejected'));
  await waitFor(() => expect(requests.some((r) => r.includes('camera/output'))).toBe(true));
  expect(aborted).toBe(true);
  expect(videoCalls).toBe(2);
  expect(document.getElementById('transport-status')!.textContent).toContain('Raw fallback');
});

test('contours upload native wave geometry while Raw camera retains RGBA transport', async () => {
  document.getElementById('demo')!.click();
  await waitFor(() => expect(requests.some((r) => r.includes('camera/contours'))).toBe(true));
  const request = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes('camera/contours'));
  expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({ width: 320, height: 180, mix: 0.3, paths: [] });
  document.getElementById('raw-mode')!.click();
  await waitFor(() => expect(requests.some((r) => r.includes('camera/frame?w=320&h=180'))).toBe(true));
  expect((document.getElementById('steadiness') as HTMLInputElement).disabled).toBe(true);
});
