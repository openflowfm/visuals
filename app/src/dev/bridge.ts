/**
 * `npm run dev`: the page in a normal browser, driving the real app running
 * headless over its dev bridge (`app/src-tauri/src/bridge.rs`, the `dev-bridge`
 * feature). Only `vite.dev.config.ts` loads this, before `main.tsx`; the app's
 * build never sees it (`app/no-dev-code.mjs` checks).
 *
 * It stands in for what Tauri's webview gives the page (`__TAURI_INTERNALS__`):
 * `invoke` posts the command to the bridge, which hands it to the app's own IPC
 * entry; `listen` asks the bridge to relay the event and reads it from one
 * server-sent stream. The bench can't show through a browser, so the bench's
 * picture is fetched from the bridge and painted behind the page, where the
 * native view would be: under the hole the page leaves (`Preview`).
 */

/** Where the bridge is, on the page's own origin (vite proxies it). */
export const BRIDGE = '/__bridge';
/** Where the token is kept, so a reload without `?token=` still has it. */
export const TOKEN_KEY = 'visuals.dev.bridge-token';
/** The app's thumbnail URLs, which a browser can't load. */
const THUMB = 'thumb://localhost/';

type Callback = (message: unknown) => void;
type Args = Record<string, unknown> | ArrayBuffer | Uint8Array | number[] | undefined;
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The token: from the URL's `?token=`, else the one kept from before. */
export function tokenFrom(search: string, kept: string | null): string | null {
  return new URLSearchParams(search).get('token') || kept || null;
}

/** `value` with every app thumbnail URL in it pointed at the bridge's copy. */
export function bridged<T>(value: T, token: string): T {
  if (typeof value === 'string') return (value.startsWith(THUMB) ? `${BRIDGE}/thumb/${value.slice(THUMB.length)}?token=${encodeURIComponent(token)}` : value) as T;
  if (Array.isArray(value)) return value.map((v) => bridged(v, token)) as T;
  if (value && typeof value === 'object' && !(value instanceof ArrayBuffer)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = bridged(v, token);
    return out as T;
  }
  return value;
}

/** Statuses the bridge itself answers with; anything else came from the proxy (the app isn't up). */
const ANSWERED = new Set([200, 400, 403, 404]);
/** The type of a command's error: still a 200, which the browser doesn't log as a failed load. */
export const ERROR_TYPE = 'application/x-bridge-error+json';

export interface Options {
  token: string;
  fetch: typeof fetch;
  /** Called with the bench's place each time the page moves it. */
  place?(rect: Rect): void;
  /** How long to wait between tries while the app isn't up, in ms. */
  retry?: number;
  /** How many tries before a command fails. */
  tries?: number;
}

/** The stand-in for Tauri's internals, talking to the bridge. */
export function createBridge(o: Options) {
  const retry = o.retry ?? 1000;
  const tries = o.tries ?? 120;
  const callbacks = new Map<number, Callback>();
  /** Listeners by event: their ids and their callbacks' ids. */
  const listeners = new Map<string, Map<number, number>>();
  let nextId = 1;
  let warned = false;
  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const headers = { 'content-type': 'application/json', 'x-bridge-token': o.token };

  /** POST to the bridge, waiting (and trying again) while the app isn't up. */
  async function post(path: string, body: unknown): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      let response: Response | null = null;
      try {
        response = await o.fetch(`${BRIDGE}/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
      } catch {
        response = null;
      }
      if (response && ANSWERED.has(response.status)) return response;
      if (attempt >= tries) throw new Error(`the dev bridge isn't answering (is \`npm run dev\`'s app running?)`);
      if (!warned) {
        warned = true;
        console.warn('visual[flow] dev: waiting for the app behind the bridge…');
      }
      await wait(retry);
    }
  }

  async function call(cmd: string, args: Args): Promise<unknown> {
    if (cmd === 'place_bench' && args && !Array.isArray(args) && !(args instanceof ArrayBuffer) && !(args instanceof Uint8Array)) o.place?.(args as unknown as Rect);
    const response = await post('invoke', { cmd, args: args instanceof ArrayBuffer || args instanceof Uint8Array ? Array.from(new Uint8Array(args)) : (args ?? {}) });
    if (response.status === 403) throw new Error('the dev bridge refused the token: open the URL `npm run dev` printed');
    if (response.status !== 200) throw new Error(`the dev bridge said ${response.status}: ${await response.text()}`);
    const type = response.headers.get('content-type') ?? '';
    if (type.startsWith(ERROR_TYPE)) throw await response.json();
    if (type.startsWith('application/octet-stream')) return response.arrayBuffer();
    return bridged(await response.json(), o.token);
  }

  /** Ask the bridge to relay `event`; done again whenever the event stream reconnects (the app restarted). */
  const relay = (event: string) => post('listen', { event }).then(() => {});

  const internals = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    transformCallback(callback: Callback, once = false): number {
      const id = nextId++;
      callbacks.set(id, (message) => {
        if (once) callbacks.delete(id);
        callback(message);
      });
      return id;
    },
    unregisterCallback(id: number) {
      callbacks.delete(id);
    },
    convertFileSrc(path: string, protocol = 'asset') {
      return `${protocol}://localhost/${encodeURIComponent(path)}`;
    },
    async invoke(cmd: string, args?: Args): Promise<unknown> {
      if (cmd === 'plugin:event|listen') {
        const { event, handler } = args as { event: string; handler: number };
        const id = nextId++;
        if (!listeners.has(event)) {
          listeners.set(event, new Map());
          await relay(event);
        }
        listeners.get(event)!.set(id, handler);
        return id;
      }
      if (cmd === 'plugin:event|unlisten') {
        const { event, eventId } = args as { event: string; eventId: number };
        listeners.get(event)?.delete(eventId);
        return null;
      }
      return call(cmd, args);
    },
  };

  return {
    internals,
    eventInternals: {
      unregisterListener(event: string, eventId: number) {
        listeners.get(event)?.delete(eventId);
      },
    },
    /** One line of the event stream (`{event, payload}`), handed to whoever listens. */
    deliver(line: string) {
      const { event, payload } = JSON.parse(line) as { event: string; payload: unknown };
      for (const [id, handler] of listeners.get(event) ?? []) callbacks.get(handler)?.({ event, id, payload: bridged(payload, o.token) });
    },
    /** Relay every event listened to again: the app behind the bridge is a new one. */
    relayAgain: () => Promise.all([...listeners.keys()].map(relay)).then(() => {}),
  };
}

/**
 * The bench's picture, painted behind the page where the native view would be.
 * The page is transparent down to the bench's hole, so a canvas under it shows
 * through there and nowhere else. Frames are asked for one at a time, at most
 * every `every` ms, and only while the page is visible.
 */
export function benchPainter(token: string, every = 50) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.dataset.devBench = '';
  Object.assign(canvas.style, { position: 'fixed', zIndex: '-1', pointerEvents: 'none', left: '0', top: '0', width: '0', height: '0' });
  document.body.prepend(canvas);
  const g = canvas.getContext('2d');
  let rect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  let running = false;

  async function loop() {
    running = true;
    while (rect.width > 0 && rect.height > 0) {
      const started = performance.now();
      let pause = every;
      if (document.visibilityState !== 'visible') pause = 500;
      else
        try {
          const response = await fetch(`${BRIDGE}/frame?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
          if (response.status === 200) {
            const image = await createImageBitmap(await response.blob());
            if (canvas.width !== image.width || canvas.height !== image.height) Object.assign(canvas, { width: image.width, height: image.height });
            g?.drawImage(image, 0, 0);
            image.close();
          } else pause = 250;
        } catch {
          pause = 1000;
        }
      await new Promise((r) => setTimeout(r, Math.max(0, pause - (performance.now() - started))));
    }
    running = false;
  }

  return (next: Rect) => {
    rect = next;
    Object.assign(canvas.style, { left: `${next.x}px`, top: `${next.y}px`, width: `${next.width}px`, height: `${next.height}px` });
    if (!running) void loop();
  };
}

/** Put the bridge in place of Tauri's internals, before the page mounts. */
export function install() {
  let kept: string | null = null;
  try {
    kept = sessionStorage.getItem(TOKEN_KEY);
  } catch {
    kept = null;
  }
  const token = tokenFrom(location.search, kept);
  if (!token) {
    document.body.textContent = 'Open the URL `npm run dev` printed: it carries the dev bridge’s token.';
    return;
  }
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // A private window: the token stays in the URL instead.
  }
  // No macOS material behind the page in a browser: the page's own background stands in for it.
  document.documentElement.style.background = 'var(--bg, #0a0a0b)';
  const place = benchPainter(token);
  const bridge = createBridge({ token, fetch: window.fetch.bind(window), place });
  const w = window as unknown as Record<string, unknown>;
  w.__TAURI_INTERNALS__ = bridge.internals;
  w.__TAURI_EVENT_PLUGIN_INTERNALS__ = bridge.eventInternals;
  const events = new EventSource(`${BRIDGE}/events?token=${encodeURIComponent(token)}`);
  let opened = false;
  events.onopen = () => {
    if (opened) void bridge.relayAgain();
    opened = true;
  };
  events.onmessage = (e) => bridge.deliver(e.data as string);
}
