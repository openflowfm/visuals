import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { fitLine, leave } from './OutputPanel.tsx';
import type { Display } from './output.ts';

const display = (width: number, height: number): Display => ({ id: 1, index: 0, name: 'Projector', width, height, main: false });

describe('fitLine', () => {
  it('says how it will fit while nothing is showing', () => {
    expect(fitLine({ display: null, size: null })).toMatch(/^The whole picture, with black bars/);
  });

  it('fills a display turned on its side', () => {
    expect(fitLine({ display: display(1080, 1920), size: [1080, 1920] })).toBe('Fills Projector, drawn tall to match it.');
  });

  it('fills a display the picture matches, or whose size is not known yet', () => {
    expect(fitLine({ display: display(1920, 1080), size: [1920, 1080] })).toBe('Fills Projector.');
    expect(fitLine({ display: display(1920, 1080), size: null })).toBe('Fills Projector.');
  });

  it('says where the black bars go', () => {
    expect(fitLine({ display: display(1920, 1080), size: [1440, 1080] })).toBe('The whole picture, 1440×1080 on Projector, with black bars at the sides.');
    expect(fitLine({ display: display(1920, 1200), size: [1920, 1080] })).toBe('The whole picture, 1920×1080 on Projector, with black bars above and below.');
  });
});

describe('leave', () => {
  // The IPC mock lives on `window`, which the node test environment doesn't have.
  beforeEach(() => vi.stubGlobal('window', globalThis));
  afterEach(() => {
    clearMocks();
    vi.unstubAllGlobals();
  });

  it('resets the effects, then closes the output', async () => {
    const calls: [string, unknown][] = [];
    mockIPC((cmd, args) => {
      calls.push([cmd, args]);
      return cmd === 'output_close' ? { display: null, size: null } : null;
    });
    leave();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls).toEqual([
      ['act', { action: { kind: 'fx_reset' } }],
      ['output_close', {}],
    ]);
  });

  it('closes the output even when the reset fails', async () => {
    const calls: string[] = [];
    mockIPC((cmd) => {
      calls.push(cmd);
      if (cmd === 'act') throw new Error('no engine');
      return { display: null, size: null };
    });
    leave();
    await vi.waitFor(() => expect(calls).toEqual(['act', 'output_close']));
  });
});
