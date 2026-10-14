// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setBridge, type DragDropEvent, type EventCallback, type InvokeArgs, type UnlistenFn } from '../model/ipc';
import { useDropToAdd } from './Pack';

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

/** A webview whose drag-and-drop events the test sends, and a `pack_add` answered by `answer`. */
function webview(answer: (args?: InvokeArgs) => Promise<number>) {
  let handler: EventCallback<DragDropEvent> | undefined;
  const invoke = vi.fn((cmd: string, args?: InvokeArgs) => (cmd === 'pack_add' ? answer(args) : Promise.reject(new Error(cmd))));
  restore = setBridge({
    invoke: invoke as <T>(cmd: string, args?: InvokeArgs) => Promise<T>,
    currentWebview: () => ({
      onDragDropEvent: (h) => {
        handler = h;
        return Promise.resolve(() => (handler = undefined));
      },
    }),
  });
  const send = (payload: DragDropEvent) => act(() => handler!({ event: 'tauri://drag-drop', id: 0, payload }));
  return { invoke, send, listening: () => handler !== undefined };
}

const at = { x: 0, y: 0 };

describe('useDropToAdd', () => {
  it('is over while files are above the window, and not after they leave', async () => {
    const w = webview(() => Promise.resolve(0));
    const { result } = renderHook(() => useDropToAdd());
    await waitFor(() => expect(w.listening()).toBe(true));
    expect(result.current.over).toBe(false);
    w.send({ type: 'enter', paths: ['/a.milk'], position: at });
    expect(result.current.over).toBe(true);
    w.send({ type: 'over', position: at });
    expect(result.current.over).toBe(true);
    w.send({ type: 'leave' });
    expect(result.current.over).toBe(false);
    expect(w.invoke).not.toHaveBeenCalled();
  });

  it('adds the dropped paths and says how many came in', async () => {
    const w = webview(() => Promise.resolve(1234));
    const { result } = renderHook(() => useDropToAdd());
    await waitFor(() => expect(w.listening()).toBe(true));
    w.send({ type: 'enter', paths: ['/a.milk', '/b'], position: at });
    w.send({ type: 'drop', paths: ['/a.milk', '/b'], position: at });
    expect(result.current.over).toBe(false);
    expect(w.invoke).toHaveBeenCalledWith('pack_add', { items: [{ path: '/a.milk' }, { path: '/b' }] });
    await waitFor(() => expect(result.current.note).toEqual({ text: 'Added 1,234 presets', error: false }));
  });

  it('says "preset" for one', async () => {
    const w = webview(() => Promise.resolve(1));
    const { result } = renderHook(() => useDropToAdd());
    await waitFor(() => expect(w.listening()).toBe(true));
    w.send({ type: 'drop', paths: ['/a.milk'], position: at });
    await waitFor(() => expect(result.current.note).toEqual({ text: 'Added 1 preset', error: false }));
  });

  it('says why an add failed', async () => {
    const w = webview(() => Promise.reject(new Error('the disk is full')));
    const { result } = renderHook(() => useDropToAdd());
    await waitFor(() => expect(w.listening()).toBe(true));
    w.send({ type: 'drop', paths: ['/a.milk'], position: at });
    await waitFor(() => expect(result.current.note).toEqual({ text: 'the disk is full', error: true }));
  });

  it('does nothing with an empty drop but put the highlight away', async () => {
    const w = webview(() => Promise.resolve(0));
    const { result } = renderHook(() => useDropToAdd());
    await waitFor(() => expect(w.listening()).toBe(true));
    w.send({ type: 'enter', paths: [], position: at });
    w.send({ type: 'drop', paths: [], position: at });
    await act(async () => {});
    expect(result.current.over).toBe(false);
    expect(result.current.note).toBeNull();
    expect(w.invoke).not.toHaveBeenCalled();
  });

  it('stops following drops on unmount', async () => {
    const w = webview(() => Promise.resolve(0));
    const { unmount } = renderHook(() => useDropToAdd());
    await waitFor(() => expect(w.listening()).toBe(true));
    unmount();
    expect(w.listening()).toBe(false);
  });
});
