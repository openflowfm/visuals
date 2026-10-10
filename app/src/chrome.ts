import { getCurrentWindow } from '@tauri-apps/api/window';

/**
 * The main window's own chrome. Its title bar is Tauri's overlay one
 * (`tauri.conf.json`: `titleBarStyle: Overlay`, the title hidden): the page runs
 * up to the window's top edge, under macOS's window buttons, which sit centred
 * in the page's top bar (`trafficLightPosition`). This marks the page's root so
 * chrome.css leaves room for the buttons and gives the top bars their height:
 * `data-chrome="overlay"` in the main window on macOS, and `data-fullscreen`
 * while the window is full screen, where macOS hides the buttons with the title
 * bar and the room goes. Nothing is marked anywhere else (a Storybook story, a
 * page outside the app), so the bars keep their own padding there.
 *
 * The top bars' empty space drags the window (`data-tauri-drag-region` on
 * them), and a double-click there zooms it, as a title bar does.
 */

/** The part of a Tauri window this needs; `getCurrentWindow()` is one. */
export interface ChromeWindow {
  label: string;
  isFullscreen(): Promise<boolean>;
  onResized(handler: () => void): Promise<() => void>;
}

/** Whether `ua` is a Mac's: only macOS draws the window buttons over the page. */
export const onMac = (ua: string) => /Macintosh|Mac OS X/.test(ua);

/**
 * Mark `root` for the main window's overlay chrome and keep `data-fullscreen`
 * up to date as the window resizes (entering and leaving full screen resize it).
 * Returns what stops listening. Does nothing but in the main window on a Mac.
 */
export function overlayChrome(root: HTMLElement, win: ChromeWindow, ua: string): () => void {
  if (win.label !== 'main' || !onMac(ua)) return () => {};
  root.dataset.chrome = 'overlay';
  let live = true;
  const check = () =>
    win.isFullscreen().then(
      (full) => {
        if (!live) return;
        if (full) root.dataset.fullscreen = '';
        else delete root.dataset.fullscreen;
      },
      () => {},
    );
  void check();
  const stop = win.onResized(() => void check());
  return () => {
    live = false;
    delete root.dataset.chrome;
    delete root.dataset.fullscreen;
    stop.then(
      (unlisten) => unlisten(),
      () => {},
    );
  };
}

/** `overlayChrome` on this page's own window; for main.tsx, in the app only. */
export function startChrome(): () => void {
  try {
    return overlayChrome(document.documentElement, getCurrentWindow(), navigator.userAgent);
  } catch {
    // No window to ask (a page without the app behind it): no chrome to make room for.
    return () => {};
  }
}
