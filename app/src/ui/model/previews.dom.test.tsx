// @vitest-environment happy-dom
import { createElement } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setBridge, type InvokeArgs } from './ipc';
import { HOVER_DWELL_MS, HOVER_HEADER, useHoverPreview, usePreview } from './previews';

/** Every command the page sends, answered by `answer`. */
function bridge(answer: (cmd: string, args?: InvokeArgs) => unknown = () => null) {
  const calls: [string, InvokeArgs | undefined][] = [];
  const restore = setBridge({
    invoke: <T,>(cmd: string, args?: InvokeArgs) => {
      calls.push([cmd, args]);
      return Promise.resolve(answer(cmd, args) as T);
    },
  });
  const of = (cmd: string) => calls.filter(([c]) => c === cmd);
  return { calls, of, restore };
}

/** A hover picture as the app packs it (`unpackHover`): ticket, count, width, height, then the pixels. */
function hoverPicture(ticket: number, count: number, width: number, height: number): ArrayBuffer {
  const buffer = new ArrayBuffer(HOVER_HEADER + width * height * 4);
  const header = new DataView(buffer);
  [ticket, count, width, height].forEach((v, i) => header.setUint32(i * 4, v, true));
  return buffer;
}

const TICKET = 7;
let putImageData: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  putImageData = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({ putImageData })) as unknown as HTMLCanvasElement['getContext']);
  if (typeof ImageData === 'undefined') {
    vi.stubGlobal(
      'ImageData',
      class {
        constructor(
          public data: Uint8ClampedArray,
          public width: number,
          public height: number,
        ) {}
      },
    );
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Hover({ path }: { path: string | null }) {
  const { ref, drawn } = useHoverPreview(path);
  return createElement('canvas', { ref, 'data-testid': 'hover', 'data-drawn': String(drawn) });
}

describe('useHoverPreview', () => {
  let visibility: DocumentVisibilityState;
  let b: ReturnType<typeof bridge>;
  let frame: () => ArrayBuffer;

  beforeEach(() => {
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    frame = () => hoverPicture(TICKET, 1, 2, 2);
    b = bridge((cmd) => (cmd === 'hover_preview' ? TICKET : cmd === 'hover_frame' ? frame() : null));
  });
  afterEach(() => {
    b.restore();
    delete (document as unknown as Record<string, unknown>).visibilityState;
  });

  const drawn = (el: HTMLElement) => el.getAttribute('data-drawn');

  it('asks for nothing while the pointer sweeps across tiles', async () => {
    const view = render(createElement(Hover, { path: 'a.milk' }));
    await act(() => vi.advanceTimersByTimeAsync(HOVER_DWELL_MS - 50));
    view.rerender(createElement(Hover, { path: 'b.milk' }));
    await act(() => vi.advanceTimersByTimeAsync(HOVER_DWELL_MS - 50));
    view.rerender(createElement(Hover, { path: null }));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(b.calls).toEqual([]);
    view.unmount();
  });

  it('asks once after the dwell, draws the first picture, and stops when the path changes', async () => {
    const view = render(createElement(Hover, { path: 'a.milk' }));
    const canvas = view.getByTestId('hover') as HTMLCanvasElement;
    await act(() => vi.advanceTimersByTimeAsync(HOVER_DWELL_MS - 1));
    expect(b.calls).toEqual([]);
    expect(drawn(canvas)).toBe('false');
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(b.of('hover_preview')).toEqual([['hover_preview', { path: 'a.milk', width: 192, height: 108 }]]);
    expect(b.of('hover_frame')[0]).toEqual(['hover_frame', { after: 0 }]);
    expect(drawn(canvas)).toBe('true');
    expect([canvas.width, canvas.height]).toEqual([2, 2]);
    expect(putImageData).toHaveBeenCalled();
    // The next poll asks for pictures newer than the one drawn.
    await act(() => vi.advanceTimersByTimeAsync(40));
    expect(b.of('hover_frame')[1]).toEqual(['hover_frame', { after: 1 }]);

    view.rerender(createElement(Hover, { path: null }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(drawn(canvas)).toBe('false');
    expect(b.of('hover_preview').at(-1)).toEqual(['hover_preview', { path: null, width: 0, height: 0 }]);
    const polls = b.of('hover_frame').length;
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(b.of('hover_frame').length).toBe(polls);
    view.unmount();
  });

  it('stops the app drawing when unmounted after the ask', async () => {
    const view = render(createElement(Hover, { path: 'a.milk' }));
    await act(() => vi.advanceTimersByTimeAsync(HOVER_DWELL_MS + 10));
    view.unmount();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(b.of('hover_preview').at(-1)).toEqual(['hover_preview', { path: null, width: 0, height: 0 }]);
    const polls = b.of('hover_frame').length;
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(b.of('hover_frame').length).toBe(polls);
  });

  it('ends the poll on a preset that failed, leaving the thumbnail', async () => {
    frame = () => hoverPicture(TICKET, 0, 0, 0).slice(0, HOVER_HEADER);
    const view = render(createElement(Hover, { path: 'broken.milk' }));
    const canvas = view.getByTestId('hover');
    await act(() => vi.advanceTimersByTimeAsync(HOVER_DWELL_MS + 500));
    expect(b.of('hover_frame')).toHaveLength(1);
    expect(drawn(canvas)).toBe('false');
    expect(putImageData).not.toHaveBeenCalled();
    view.unmount();
  });

  it('asks for nothing while the page is hidden', async () => {
    visibility = 'hidden';
    const view = render(createElement(Hover, { path: 'a.milk' }));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(b.calls).toEqual([]);
    view.unmount();
  });

  it('stops when the page goes hidden mid-hover, and starts again when shown', async () => {
    const view = render(createElement(Hover, { path: 'a.milk' }));
    await act(() => vi.advanceTimersByTimeAsync(HOVER_DWELL_MS + 10));
    expect(b.of('hover_preview')).toHaveLength(1);
    visibility = 'hidden';
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(b.of('hover_preview').at(-1)).toEqual(['hover_preview', { path: null, width: 0, height: 0 }]);
    const polls = b.of('hover_frame').length;
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(b.of('hover_frame').length).toBe(polls);
    expect(b.of('hover_preview')).toHaveLength(2);

    visibility = 'visible';
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(() => vi.advanceTimersByTimeAsync(HOVER_DWELL_MS + 10));
    expect(b.of('hover_preview').at(-1)).toEqual(['hover_preview', { path: 'a.milk', width: 192, height: 108 }]);
    view.unmount();
  });

  it('stops listening for the page being shown when unmounted', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const view = render(createElement(Hover, { path: null }));
    const listener = add.mock.calls.find(([type]) => type === 'visibilitychange')?.[1];
    expect(listener).toBeTypeOf('function');
    view.unmount();
    expect(remove).toHaveBeenCalledWith('visibilitychange', listener);
  });
});

function Stage({ which }: { which: number }) {
  const ref = usePreview(which);
  return createElement('canvas', { ref, 'data-testid': 'stage' });
}

describe("usePreview (the stages' pictures)", () => {
  let b: ReturnType<typeof bridge>;
  beforeEach(() => {
    // On screen: a box of its own inside the window.
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 192, bottom: 108, width: 192, height: 108, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    b = bridge((cmd) => (cmd === 'previews' ? new ArrayBuffer(0) : null));
  });
  afterEach(async () => {
    // Let the poll see no canvases and finish, so the next test starts it afresh.
    cleanup();
    await vi.advanceTimersByTimeAsync(500);
    b.restore();
  });

  it('starts polling on the first canvas and tells the engine to stop after the last one goes', async () => {
    const both = (shown: number[]) => createElement('div', null, ...shown.map((which) => createElement(Stage, { key: which, which })));
    const view = render(both([1, 2]));
    await act(() => vi.advanceTimersByTimeAsync(0));
    // Canvases mounted together share the first poll: both in its one `set_previews`.
    expect(b.calls[0]).toEqual(['set_previews', { which: [1, 2], width: 192, height: 108 }]);
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(b.of('previews').length).toBeGreaterThan(1);
    // The same pictures aren't asked for again each poll.
    expect(b.of('set_previews')).toEqual([['set_previews', { which: [1, 2], width: 192, height: 108 }]]);

    view.rerender(both([2]));
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(b.of('set_previews').at(-1)).toEqual(['set_previews', { which: [2], width: 192, height: 108 }]);
    view.unmount();
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(b.of('set_previews').at(-1)).toEqual(['set_previews', { which: [], width: 192, height: 108 }]);
    const polls = b.of('previews').length;
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(b.of('previews').length).toBe(polls);
  });

  it('starts again for a canvas mounted after the poll stopped', async () => {
    const view = render(createElement(Stage, { which: 4 }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    // A layer needs the frame it draws into too.
    expect(b.calls[0]).toEqual(['set_previews', { which: [0, 4], width: 192, height: 108 }]);
    view.unmount();
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(b.of('set_previews').at(-1)?.[1]).toMatchObject({ which: [] });
  });
});
