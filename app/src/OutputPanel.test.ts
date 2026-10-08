import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { leave } from './OutputPanel.tsx';

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
