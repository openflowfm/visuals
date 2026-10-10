import { describe, expect, it } from 'vitest';
import { onMac, overlayChrome, type ChromeWindow } from './chrome.ts';

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)';

/** A root with only `dataset`, which is all overlayChrome touches. */
const root = () => ({ dataset: {} as Record<string, string> }) as unknown as HTMLElement;

/** A window whose full-screen state the test sets, and whose resizes it fires. */
function fakeWindow(label = 'main') {
  let full = false;
  const handlers: (() => void)[] = [];
  let unlistened = 0;
  const win: ChromeWindow = {
    label,
    isFullscreen: () => Promise.resolve(full),
    onResized: (handler) => {
      handlers.push(handler);
      return Promise.resolve(() => void unlistened++);
    },
  };
  return {
    win,
    resize(nowFull: boolean) {
      full = nowFull;
      handlers.forEach((h) => h());
    },
    unlistened: () => unlistened,
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('overlayChrome', () => {
  it('marks the main window on a Mac, and nothing else', () => {
    const r = root();
    overlayChrome(r, fakeWindow().win, MAC);
    expect(r.dataset.chrome).toBe('overlay');

    const other = root();
    overlayChrome(other, fakeWindow('output').win, MAC);
    expect(other.dataset.chrome).toBeUndefined();

    const pc = root();
    overlayChrome(pc, fakeWindow().win, WINDOWS);
    expect(pc.dataset.chrome).toBeUndefined();
  });

  it('follows the window in and out of full screen', async () => {
    const r = root();
    const w = fakeWindow();
    overlayChrome(r, w.win, MAC);
    await settle();
    expect(r.dataset.fullscreen).toBeUndefined();
    w.resize(true);
    await settle();
    expect(r.dataset.fullscreen).toBe('');
    w.resize(false);
    await settle();
    expect(r.dataset.fullscreen).toBeUndefined();
  });

  it('stops listening and clears its marks when stopped', async () => {
    const r = root();
    const w = fakeWindow();
    const stop = overlayChrome(r, w.win, MAC);
    stop();
    await settle();
    expect(w.unlistened()).toBe(1);
    expect(r.dataset.chrome).toBeUndefined();
    w.resize(true);
    await settle();
    expect(r.dataset.fullscreen).toBeUndefined();
  });

  it('knows a Mac by its user agent', () => {
    expect(onMac(MAC)).toBe(true);
    expect(onMac(WINDOWS)).toBe(false);
  });
});
