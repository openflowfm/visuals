// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { clearMocks, mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { currentBridge } from '@satoramoto/zen/visuals';
import { installTauriBridge } from './zenBridge.ts';

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
  clearMocks();
});

/** The Tauri commands the page sent, as mockIPC got them. */
function tauri(answer: (cmd: string, args: unknown) => unknown = () => null) {
  const sent: { cmd: string; args: unknown }[] = [];
  mockWindows('main');
  mockIPC(
    (cmd, args) => {
      sent.push({ cmd, args });
      return answer(cmd, args);
    },
    { shouldMockEvents: true },
  );
  return sent;
}

describe("zen's bridge over Tauri", () => {
  it('is not installed until the app installs it: zen rejects commands without a backend', async () => {
    tauri();
    await expect(currentBridge().invoke('library_index')).rejects.toThrow(/no backend installed/);
  });

  it("sends zen's commands to the app as Tauri commands, with their arguments, and hands back the answer", async () => {
    const sent = tauri((cmd) => (cmd === 'deck_items' ? ['a.milk', 'b.milk'] : null));
    restore = installTauriBridge();
    await expect(currentBridge().invoke('deck_items', { playlist: 'Warm' })).resolves.toEqual(['a.milk', 'b.milk']);
    expect(sent).toContainEqual({ cmd: 'deck_items', args: { playlist: 'Warm' } });
  });

  it("delivers the app's events to zen's listeners, until they stop listening", async () => {
    tauri();
    restore = installTauriBridge();
    const got: unknown[] = [];
    const stop = await currentBridge().listen<{ path: string }>('now_playing', (e) => got.push(e.payload));
    await currentBridge().emit('now_playing', { path: 'a.milk' });
    stop();
    await currentBridge().emit('now_playing', { path: 'b.milk' });
    expect(got).toEqual([{ path: 'a.milk' }]);
  });

  it("is the app's main window, so zen draws the overlay chrome", () => {
    tauri();
    restore = installTauriBridge();
    expect(currentBridge().currentWindow().label).toBe('main');
  });

  it("opens links with the opener plugin rather than zen's in-memory bus", async () => {
    const sent = tauri();
    restore = installTauriBridge();
    await currentBridge().openUrl('https://github.com/openflowfm/visuals');
    expect(sent.find((s) => s.cmd.startsWith('plugin:opener|'))?.args).toMatchObject({ url: 'https://github.com/openflowfm/visuals' });
  });

  it('puts the previous bridge back when restored', async () => {
    tauri();
    installTauriBridge()();
    await expect(currentBridge().invoke('library_index')).rejects.toThrow(/no backend installed/);
  });
});
