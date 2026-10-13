/**
 * The bridge between visual[flow]'s UI and whatever backend runs it, in place of
 * the Tauri modules the original imports (`@tauri-apps/api/core`, `/event`,
 * `/window`, `/webview` and `@tauri-apps/plugin-opener`). Every model module
 * imports these names from here, with the same signatures Tauri's have, and
 * each call goes to the one installed `Bridge`.
 *
 * - The real app installs a Tauri bridge (`setBridge({ invoke, listen, emit, ... })`
 *   built from the Tauri modules), once, before it renders.
 * - Storybook and the tests install the fixture backend (`../fixtures/`): it
 *   implements `invoke` and reuses this file's in-memory event bus
 *   (`localEvents()`) for `listen`/`emit`, so a fake command can push an event
 *   the UI is listening for.
 * - With nothing installed, the default bridge rejects every `invoke` with a
 *   "no backend installed" error, keeps events on the in-memory bus, has a
 *   window that isn't the app's main one (so no overlay chrome), takes drops
 *   from the bus (`DRAG_DROP_EVENT`), and puts opened URLs on the bus
 *   (`OPEN_URL_EVENT`) instead of opening them.
 *
 * `setBridge` takes a whole or partial bridge (what it leaves out stays the
 * default's) and returns what puts the previous one back.
 */

/** What stops a listener; Tauri's `UnlistenFn`. */
export type UnlistenFn = () => void;

/** An event as a listener gets it; Tauri's `Event<T>`. */
export interface Event<T> {
  event: string;
  id: number;
  payload: T;
}

/** A listener; Tauri's `EventCallback<T>`. */
export type EventCallback<T> = (event: Event<T>) => void;

/** A command's arguments; Tauri's `InvokeArgs`. */
export type InvokeArgs = Record<string, unknown> | number[] | ArrayBuffer | Uint8Array;

/** Files dragged over the window; Tauri's `DragDropEvent`. */
export type DragDropEvent =
  | { type: 'enter'; paths: string[]; position: { x: number; y: number } }
  | { type: 'over'; position: { x: number; y: number } }
  | { type: 'drop'; paths: string[]; position: { x: number; y: number } }
  | { type: 'leave' };

/** The part of Tauri's `Window` the UI uses (`chrome.ts`). */
export interface BridgeWindow {
  label: string;
  isFullscreen(): Promise<boolean>;
  onResized(handler: () => void): Promise<UnlistenFn>;
}

/** The part of Tauri's `Webview` the UI uses (`Pack.tsx`'s drop to add). */
export interface BridgeWebview {
  onDragDropEvent(handler: EventCallback<DragDropEvent>): Promise<UnlistenFn>;
}

/** Everything the UI asks of its backend. */
export interface Bridge {
  invoke<T>(cmd: string, args?: InvokeArgs): Promise<T>;
  listen<T>(event: string, handler: EventCallback<T>): Promise<UnlistenFn>;
  emit(event: string, payload?: unknown): Promise<void>;
  /** `getCurrentWindow()`. */
  currentWindow(): BridgeWindow;
  /** `getCurrentWebview()`. */
  currentWebview(): BridgeWebview;
  /** `openUrl()`, from `@tauri-apps/plugin-opener`. */
  openUrl(url: string): Promise<void>;
}

/** The bus event the default webview reads drops from: emit a `DragDropEvent` on it to drop files. */
export const DRAG_DROP_EVENT = 'bridge://drag-drop';
/** The bus event the default `openUrl` puts each URL on (the payload is the URL). */
export const OPEN_URL_EVENT = 'bridge://open-url';

/** The in-memory event bus: what the default bridge's `listen` and `emit` use. */
export interface LocalEvents {
  listen<T>(event: string, handler: EventCallback<T>): Promise<UnlistenFn>;
  emit(event: string, payload?: unknown): Promise<void>;
  /** How many listeners `event` has now. */
  count(event: string): number;
  /** Drops every listener (between tests or stories). */
  clear(): void;
}

function makeBus(): LocalEvents {
  const handlers = new Map<string, Set<EventCallback<unknown>>>();
  let id = 0;
  return {
    listen<T>(event: string, handler: EventCallback<T>) {
      const set = handlers.get(event) ?? new Set();
      handlers.set(event, set);
      const h = handler as EventCallback<unknown>;
      set.add(h);
      return Promise.resolve(() => {
        set.delete(h);
      });
    },
    emit(event: string, payload?: unknown) {
      const e = { event, id: ++id, payload };
      for (const h of [...(handlers.get(event) ?? [])]) h(e);
      return Promise.resolve();
    },
    count: (event) => handlers.get(event)?.size ?? 0,
    clear: () => handlers.clear(),
  };
}

const bus = makeBus();

/** The one in-memory event bus, for a fake backend to listen and emit on. */
export function localEvents(): LocalEvents {
  return bus;
}

/** What the default bridge's `invoke` rejects with. */
export class NoBackendError extends Error {
  constructor(cmd: string) {
    super(`no backend installed: can't invoke "${cmd}" (call setBridge first)`);
    this.name = 'NoBackendError';
  }
}

/** The bridge with nothing behind it (see the header). */
export const defaultBridge: Bridge = {
  invoke: (cmd) => Promise.reject(new NoBackendError(cmd)),
  listen: (event, handler) => bus.listen(event, handler),
  emit: (event, payload) => bus.emit(event, payload),
  currentWindow: () => ({
    label: 'bridge',
    isFullscreen: () => Promise.resolve(false),
    onResized: () => Promise.resolve(() => {}),
  }),
  currentWebview: () => ({
    onDragDropEvent: (handler) => bus.listen<DragDropEvent>(DRAG_DROP_EVENT, handler),
  }),
  openUrl: (url) => bus.emit(OPEN_URL_EVENT, url),
};

let bridge: Bridge = defaultBridge;

/** Install `b` (what it leaves out is the default's); returns what puts the previous bridge back. */
export function setBridge(b: Partial<Bridge>): () => void {
  const previous = bridge;
  bridge = { ...defaultBridge, ...b };
  return () => {
    bridge = previous;
  };
}

/** The bridge installed now. */
export function currentBridge(): Bridge {
  return bridge;
}

// The Tauri names, each going to the installed bridge.

export function invoke<T>(cmd: string, args?: InvokeArgs): Promise<T> {
  return bridge.invoke<T>(cmd, args);
}

export function listen<T>(event: string, handler: EventCallback<T>): Promise<UnlistenFn> {
  return bridge.listen<T>(event, handler);
}

export function emit(event: string, payload?: unknown): Promise<void> {
  return bridge.emit(event, payload);
}

export function getCurrentWindow(): BridgeWindow {
  return bridge.currentWindow();
}

export function getCurrentWebview(): BridgeWebview {
  return bridge.currentWebview();
}

export function openUrl(url: string): Promise<void> {
  return bridge.openUrl(url);
}
