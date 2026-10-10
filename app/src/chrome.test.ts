import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

/** A file next to this test, read from disk: vitest hands a test empty CSS for an import. */
const read = (file: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), file), 'utf8');
const px = (css: string, name: string) => Number(css.match(new RegExp(`${name}: (\\d+)px;`))![1]);

describe('the window buttons, in one place for every view', () => {
  // Tauri sets the buttons' place only when it builds the window, so the home's
  // sidebar band, its header, live mode's strip and onboarding's head all make
  // room for the same place.
  const conf = JSON.parse(read('../src-tauri/tauri.conf.json')) as { app: { windows: { label: string; trafficLightPosition: { x: number; y: number } }[] } };
  const at = conf.app.windows.find((w) => w.label === 'main')!.trafficLightPosition;
  const chrome = read('chrome.css');
  const layout = read('layout/layout.css');

  it('sit in the docked sidebar’s top band, clear of its panel’s corner', () => {
    expect(at).toEqual({ x: 24, y: 28 });
    const inset = px(layout, '--lay-inset');
    const radius = px(layout, '--lay-side-radius');
    const band = px(layout, '--lay-titlebar');
    // Past the panel's rounded corner, and within its band (the buttons are 12px).
    expect(at.x - inset).toBeGreaterThanOrEqual(radius - 4);
    expect(at.y + 6).toBeLessThanOrEqual(band);
    // The stories' stand-in is where the real ones are.
    const lights = layout.match(/\.app\.home\.lay \.lay-lights \{([^}]*)\}/)![1];
    expect(lights).toContain(`left: ${at.x}px;`);
    expect(lights).toContain(`top: ${at.y - 6}px;`);
  });

  it('leave the bars room where no sidebar is docked: the three buttons and a gap after them', () => {
    // The buttons are 12px, 8px apart: 52px from the first's left edge.
    expect(px(chrome, '--chrome-lights')).toBeGreaterThanOrEqual(at.x + 52 + 12);
    const rule = chrome.match(/([^{}]+)\{[^{}]*padding-left: var\(--chrome-lights\);/)![1];
    expect(rule).toContain(':is(.vf-header, .live-status-strip, .ob-head)');
    expect(rule).toContain(":not(.lay[data-sidebar='docked'] .vf-header)");
    expect(rule).toContain(':not([data-fullscreen])');
  });

  it('go in full screen, and the sidebar’s band shrinks to a margin', () => {
    expect(chrome).toMatch(/:root\[data-fullscreen\] \.app\.home\.lay \{\s*--lay-band: 12px;\s*\}/);
    expect(layout).toMatch(/padding-top: var\(--lay-band\);/);
  });
});
