// @vitest-environment jsdom
import { createElement } from 'react';
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setBridge, type InvokeArgs } from './ipc';
import { BASE, CHAIN } from './stages';
import { apply, defaultShader, previews, setPreviews, setValue, usePicture, writeDefaultShader } from './lab';
import { blank } from '../fixtures/presets';

/** Every command the page sends, answered by `answer`. */
function bridge(answer: (cmd: string, args?: InvokeArgs) => unknown = () => null) {
  const calls: [string, InvokeArgs | undefined][] = [];
  const restore = setBridge({
    invoke: <T>(cmd: string, args?: InvokeArgs) => {
      calls.push([cmd, args]);
      return Promise.resolve(answer(cmd, args) as T);
    },
  });
  return { calls, restore };
}

describe("the lab's commands", () => {
  let b: ReturnType<typeof bridge>;
  beforeEach(() => {
    b = bridge((cmd) => (cmd === 'set_value' ? true : cmd === 'previews' ? new ArrayBuffer(0) : cmd === 'default_shader' ? 'shader_body { }' : null));
  });
  afterEach(() => b.restore());

  it('go to the bridge by the names and with the arguments the app takes', async () => {
    const p = blank();
    await apply(p);
    expect(await setValue(BASE, 'zoom', 1.1)).toBe(true);
    await setPreviews([0, 4]);
    await setPreviews([1], 384, 216);
    expect(await previews()).toBeInstanceOf(ArrayBuffer);
    expect(await defaultShader(p, 'comp')).toBe('shader_body { }');
    expect(b.calls).toEqual([
      ['apply', { preset: p }],
      ['set_value', { owner: { list: 'base' }, key: 'zoom', value: 1.1 }],
      ['set_previews', { which: [0, 4], width: 192, height: 108 }],
      ['set_previews', { which: [1], width: 384, height: 216 }],
      ['previews', undefined],
      ['default_shader', { preset: p, which: 'comp' }],
    ]);
  });
});

describe('writing a shader of my own', () => {
  it("sets the stage's code to the engine's default for this preset, and nothing else", async () => {
    const b = bridge((cmd, args) => (cmd === 'default_shader' ? `default ${(args as { which: string }).which}` : null));
    try {
      const p = { ...blank(), comp: 'kept' };
      const onChange = vi.fn();
      writeDefaultShader(
        p,
        CHAIN.find((s) => s.id === 'warp')!,
        onChange,
      );
      await waitFor(() => expect(onChange).toHaveBeenCalled());
      expect(b.calls).toEqual([['default_shader', { preset: p, which: 'warp' }]]);
      expect(onChange).toHaveBeenCalledWith({ ...p, warp: 'default warp' });
    } finally {
      b.restore();
    }
  });

  it('leaves the preset alone when the engine has none to give', async () => {
    const restore = setBridge({ invoke: () => Promise.reject('no bench') });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const onChange = vi.fn();
      writeDefaultShader(
        blank(),
        CHAIN.find((s) => s.id === 'comp')!,
        onChange,
      );
      await waitFor(() => expect(error).toHaveBeenCalledWith('no bench'));
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
      restore();
    }
  });
});

describe("the lab's stage pictures", () => {
  it("poll through the lab's own commands, and stop the engine's when the last canvas goes", async () => {
    const b = bridge((cmd) => (cmd === 'previews' ? new ArrayBuffer(0) : null));
    try {
      const Face = () => createElement('canvas', { ref: usePicture(3) });
      const { unmount } = render(createElement(Face));
      // Off screen (jsdom lays nothing out), so nothing is asked for.
      await waitFor(() => expect(b.calls[0]).toEqual(['set_previews', { which: [], width: 192, height: 108 }]));
      unmount();
      // Asked once while shown (the same ask isn't repeated), then once more to stop.
      await waitFor(() => expect(b.calls.filter(([cmd]) => cmd === 'set_previews')).toHaveLength(2));
      expect(b.calls.at(-1)).toEqual(['set_previews', { which: [], width: 192, height: 108 }]);
      expect(b.calls.every(([cmd]) => cmd === 'set_previews' || cmd === 'previews')).toBe(true);
    } finally {
      b.restore();
    }
  });
});
