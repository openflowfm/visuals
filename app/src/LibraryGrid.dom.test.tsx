// @vitest-environment happy-dom
//
// The home's library grid mounted in a DOM, with the app's commands faked: each
// tile's name and author on its picture, and the hover preview — a tile the
// pointer rests on asks the app for its preset moving, draws what comes back,
// and lets it go when the pointer leaves, the page hides or the tile goes.
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryRow } from './api.ts';
import { LibraryGrid } from './LibraryGrid.tsx';
import { prepareRow } from './librarySearch.ts';
import { HOVER_DWELL_MS, HOVER_HEADER } from './previews.ts';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args), convertFileSrc: (p: string) => p }));
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => {}) }));

const row = (key: string, authors: string[]): LibraryRow => ({
  key,
  path: `/p/${key}.milk`,
  hash: key,
  style: 'Hypnotic',
  sub_style: null,
  authors,
  title: key,
  thumbnail: `thumb:${key}`,
  look: null,
  starter: false,
});
const ROWS = [row('Aurora', ['geiss']), row('Bloom', ['flexi', 'rovastar']), row('Coil', [])].map((r) => prepareRow(r, undefined));

/** A hover picture as the app packs it: ticket, width, height, then RGBA. */
function picture(ticket: number, width = 4, height = 2): ArrayBuffer {
  const bytes = new Uint8Array(HOVER_HEADER + width * height * 4).fill(200);
  const view = new DataView(bytes.buffer);
  [ticket, width, height].forEach((n, i) => view.setUint32(i * 4, n, true));
  return bytes.buffer;
}

/** The `hover_preview` asks, as their paths (null: stop). */
const hovers = () => invoke.mock.calls.filter(([cmd]) => cmd === 'hover_preview').map(([, args]) => (args as { path: string | null }).path);

const drawn = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  invoke.mockReset();
  invoke.mockImplementation((cmd: string) => {
    if (cmd === 'hover_preview') return Promise.resolve(7);
    if (cmd === 'hover_frame') return Promise.resolve(picture(7));
    if (cmd === 'presets_failed') return Promise.resolve([]);
    return Promise.resolve(null);
  });
  drawn.mockReset();
  // happy-dom has no 2D canvas: a stand-in that counts the pictures put in.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ putImageData: drawn }) as unknown as CanvasRenderingContext2D);
  if (typeof globalThis.ImageData === 'undefined') {
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
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount() {
  const noop = () => {};
  return render(
    <div className="app home">
      <LibraryGrid rows={ROWS} active={-1} selected={new Set()} current="/p/Aurora.milk" into={null} onMove={noop} onPick={noop} onAdd={noop} onClear={noop} reveal={0} home />
    </div>,
  );
}

const tile = (c: HTMLElement, name: string) => [...c.querySelectorAll<HTMLElement>('.tile')].find((t) => t.querySelector('.tile-name')?.textContent === name)!;

describe('the home library’s tiles', () => {
  it('show the name and author on the picture, the playing one with its level bars', () => {
    const { container } = mount();
    const aurora = tile(container, 'Aurora');
    const caption = aurora.querySelector('.tile-pic > .tile-caption')!;
    expect(caption.querySelector('.tile-name')!.textContent).toBe('Aurora');
    expect(caption.querySelector('.tile-by')!.textContent).toBe('geiss');
    expect(caption.querySelector('.tile-live')).not.toBeNull();
    // Nothing under the picture.
    expect([...aurora.children].map((c) => c.className)).toEqual(['tile-pic']);
    expect(tile(container, 'Bloom').querySelector('.tile-by')!.textContent).toBe('flexi & rovastar');
    // No author: its style says something instead.
    expect(tile(container, 'Coil').querySelector('.tile-by')!.textContent).toBe('Hypnotic');
    expect(tile(container, 'Coil').querySelector('.tile-live')).toBeNull();
  });
});

describe('the hover preview', () => {
  it('asks for the preset the pointer rests on, draws it, and lets it go when the pointer leaves', async () => {
    const { container } = mount();
    const bloom = tile(container, 'Bloom');
    fireEvent.mouseEnter(bloom);
    const canvas = bloom.querySelector('canvas.tile-motion')!;
    expect(canvas).not.toBeNull();
    expect(canvas.hasAttribute('data-drawn')).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(HOVER_DWELL_MS + 100));
    expect(hovers()).toEqual(['/p/Bloom.milk']);
    const asked = invoke.mock.calls.find(([cmd]) => cmd === 'hover_preview')![1] as { width: number; height: number };
    expect(asked.width / asked.height).toBeCloseTo(16 / 9, 1);
    expect(drawn.mock.calls.length).toBeGreaterThan(1);
    expect(canvas.hasAttribute('data-drawn')).toBe(true);
    expect([(canvas as HTMLCanvasElement).width, (canvas as HTMLCanvasElement).height]).toEqual([4, 2]);

    fireEvent.mouseLeave(bloom);
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(hovers()).toEqual(['/p/Bloom.milk', null]);
    expect(bloom.querySelector('canvas')).toBeNull();
    const polls = invoke.mock.calls.filter(([cmd]) => cmd === 'hover_frame').length;
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(invoke.mock.calls.filter(([cmd]) => cmd === 'hover_frame').length).toBe(polls);
  });

  it('asks for nothing when the pointer only passes over a tile', async () => {
    const { container } = mount();
    const aurora = tile(container, 'Aurora');
    fireEvent.mouseEnter(aurora);
    await act(() => vi.advanceTimersByTimeAsync(HOVER_DWELL_MS / 2));
    fireEvent.mouseLeave(aurora);
    await act(() => vi.advanceTimersByTimeAsync(HOVER_DWELL_MS * 2));
    expect(hovers()).toEqual([]);
  });

  it('stops the old preset before asking for the next tile’s', async () => {
    const { container } = mount();
    fireEvent.mouseEnter(tile(container, 'Aurora'));
    await act(() => vi.advanceTimersByTimeAsync(HOVER_DWELL_MS + 50));
    fireEvent.mouseLeave(tile(container, 'Aurora'));
    fireEvent.mouseEnter(tile(container, 'Bloom'));
    await act(() => vi.advanceTimersByTimeAsync(HOVER_DWELL_MS + 50));
    expect(hovers()).toEqual(['/p/Aurora.milk', null, '/p/Bloom.milk']);
  });

  it('draws no picture of another hover', async () => {
    invoke.mockImplementation((cmd: string) => Promise.resolve(cmd === 'hover_preview' ? 8 : cmd === 'hover_frame' ? picture(7) : null));
    const { container } = mount();
    const coil = tile(container, 'Coil');
    fireEvent.mouseEnter(coil);
    await act(() => vi.advanceTimersByTimeAsync(HOVER_DWELL_MS + 200));
    expect(drawn).not.toHaveBeenCalled();
    expect(coil.querySelector('canvas')!.hasAttribute('data-drawn')).toBe(false);
  });

  it('stops while the page is hidden, and goes on when it shows again', async () => {
    const { container } = mount();
    fireEvent.mouseEnter(tile(container, 'Coil'));
    await act(() => vi.advanceTimersByTimeAsync(HOVER_DWELL_MS + 50));
    const shown = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(hovers()).toEqual(['/p/Coil.milk', null]);
    shown.mockReturnValue('visible');
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    await act(() => vi.advanceTimersByTimeAsync(HOVER_DWELL_MS + 50));
    expect(hovers()).toEqual(['/p/Coil.milk', null, '/p/Coil.milk']);
  });

  it('lets the preset go when the grid goes (live mode, another view)', async () => {
    const { container, unmount } = mount();
    fireEvent.mouseEnter(tile(container, 'Aurora'));
    await act(() => vi.advanceTimersByTimeAsync(HOVER_DWELL_MS + 50));
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(50));
    expect(hovers()).toEqual(['/p/Aurora.milk', null]);
  });
});
