import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { openUrl } from '@tauri-apps/plugin-opener';
import { setBridge, type Bridge } from './ui';

/**
 * The UI (`./ui`, `model/ipc.ts`) reaches its backend only through the one
 * `Bridge` installed with `setBridge`; with none it rejects every command.
 * This is the app's: every part of it is the Tauri module the UI imported
 * before zen (`@tauri-apps/api`'s core, event, window and webview,
 * and the opener plugin), so commands, events, the window's full-screen state,
 * files dropped on the page and opened links behave as they did. In
 * `npm run dev` the same calls go over the dev bridge (`dev/`), which stands
 * in for Tauri's internals underneath these modules.
 */
export const tauriBridge: Bridge = {
  invoke: (cmd, args) => invoke(cmd, args),
  listen: (event, handler) => listen(event, handler),
  emit: (event, payload) => emit(event, payload),
  currentWindow: () => getCurrentWindow(),
  currentWebview: () => getCurrentWebview(),
  openUrl: (url) => openUrl(url),
};

/** Install the Tauri bridge, before the UI renders; returns what puts the previous bridge back. */
export function installTauriBridge(): () => void {
  return setBridge(tauriBridge);
}
