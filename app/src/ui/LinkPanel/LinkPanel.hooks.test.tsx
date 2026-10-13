// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emit, localEvents, setBridge, type InvokeArgs } from '../model/ipc';
import type { Frame } from '../model/link';
import type { Notice } from '../model/shell';
import { useLink } from './LinkPanel';

const FRAME = { enabled: false, peers: 0, tempo: 120 } as unknown as Frame;

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
  localEvents().clear();
});

/** `link_state` answers `read`; everything else rejects. */
function backend(read: () => Promise<Frame>) {
  const invoke = vi.fn((cmd: string) => (cmd === 'link_state' ? read() : Promise.reject(new Error(cmd))));
  restore = setBridge({ invoke: invoke as <T>(cmd: string, args?: InvokeArgs) => Promise<T> });
  return invoke;
}

/** The notice the failure banner shows, or null without one. */
const shown = (trouble: ReactElement | null | undefined): Notice | null => (trouble ? (trouble.props as { notice: Notice }).notice : null);

describe('useLink', () => {
  it('reads the frame once, with no trouble', async () => {
    backend(() => Promise.resolve(FRAME));
    const { result } = renderHook(() => useLink());
    await waitFor(() => expect(result.current.frame).toEqual(FRAME));
    expect(shown(result.current.trouble)).toBeNull();
  });

  it("says so when Link can't start", async () => {
    backend(() => Promise.reject(new Error('no network')));
    const { result } = renderHook(() => useLink());
    await waitFor(() => expect(shown(result.current.trouble)).toEqual({ message: "Couldn't start Link.", detail: 'no network' }));
    expect(result.current.frame).toBeNull();
  });

  it('shows a failed change, and a change that works puts it away and shows its frame', async () => {
    backend(() => Promise.resolve(FRAME));
    const { result } = renderHook(() => useLink());
    await waitFor(() => expect(result.current.frame).not.toBeNull());
    await act(() => result.current.run(Promise.reject(new Error('busy')), 'join the Link session'));
    expect(shown(result.current.trouble)).toEqual({ message: "Couldn't join the Link session.", detail: 'busy' });
    expect(result.current.frame).toEqual(FRAME);
    const joined = { ...FRAME, enabled: true };
    await act(() => result.current.run(Promise.resolve(joined), 'join the Link session'));
    expect(shown(result.current.trouble)).toBeNull();
    expect(result.current.frame).toEqual(joined);
  });

  it("follows the app's link event", async () => {
    backend(() => Promise.resolve(FRAME));
    const { result } = renderHook(() => useLink());
    await waitFor(() => expect(result.current.frame).not.toBeNull());
    const later = { ...FRAME, tempo: 128, peers: 2 };
    await act(() => emit('link', later));
    expect(result.current.frame).toEqual(later);
  });
});
