import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonMask } from './person-mask';

class FakeWorker {
  static current: FakeWorker;
  onmessage?: (event: { data: unknown }) => void;
  onerror?: (event: { message: string }) => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    FakeWorker.current = this;
  }
  emit(data: unknown) {
    this.onmessage?.({ data });
  }
}
const canvas = { width: 640, height: 360 } as HTMLCanvasElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('Worker', FakeWorker);
  vi.spyOn(performance, 'now').mockReturnValue(1000);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('person mask worker lifecycle', () => {
  it('drops frames while busy and retains only the latest completed result', async () => {
    const bitmap = { close: vi.fn() };
    const snapshot = vi.fn().mockResolvedValue(bitmap);
    vi.stubGlobal('createImageBitmap', snapshot);
    const mask = new PersonMask();
    const worker = FakeWorker.current;
    mask.update(canvas);
    expect(snapshot).not.toHaveBeenCalled();
    worker.emit({ type: 'ready' });
    mask.update(canvas);
    mask.update(canvas);
    await Promise.resolve();
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(snapshot).toHaveBeenCalledWith(canvas, { resizeWidth: 256, resizeHeight: 144, resizeQuality: 'low' });
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    const result = { data: new Float32Array([1, 0]), width: 2, height: 1, inferenceMs: 6 };
    worker.emit({ type: 'mask', mask: result });
    expect(mask.latest).toBe(result);
    mask.update(canvas);
    expect(snapshot).toHaveBeenCalledTimes(1);
    vi.mocked(performance.now).mockReturnValue(1100);
    mask.update(canvas);
    await Promise.resolve();
    expect(snapshot).toHaveBeenCalledTimes(2);
    mask.dispose();
  });

  it('closes a pending bitmap after disposal without posting it', async () => {
    let resolve!: (bitmap: unknown) => void;
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      ),
    );
    const mask = new PersonMask();
    const worker = FakeWorker.current;
    worker.emit({ type: 'ready' });
    mask.update(canvas);
    mask.dispose();
    const bitmap = { close: vi.fn() };
    resolve(bitmap);
    await Promise.resolve();
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('reports stalled initialization and clears stale masks on inference failure', () => {
    const mask = new PersonMask();
    const worker = FakeWorker.current;
    vi.advanceTimersByTime(20000);
    expect(mask.status).toBe('failed');
    expect(mask.error).toContain('timed out');
    expect(worker.terminate).toHaveBeenCalledOnce();
    const second = new PersonMask();
    FakeWorker.current.emit({ type: 'ready' });
    FakeWorker.current.emit({ type: 'mask', mask: { data: new Float32Array([1]) } });
    FakeWorker.current.emit({ type: 'error', error: 'WASM failed' });
    expect(second.latest).toBeNull();
    expect(second.status).toBe('failed');
    expect(second.error).toBe('WASM failed');
  });
});

it('rejects a delayed mask based on source capture time, not arrival time', () => {
  const mask = new PersonMask();
  const worker = FakeWorker.current;
  worker.emit({ type: 'ready' });
  const result = { data: new Float32Array([1]), width: 1, height: 1, inferenceMs: 20, capturedAt: 1000 };
  worker.emit({ type: 'mask', mask: result });
  expect(mask.current(1249)).toBe(result);
  expect(mask.current(1251)).toBeNull();
  vi.mocked(performance.now).mockReturnValue(1500);
  worker.emit({ type: 'mask', mask: result });
  expect(mask.current()).toBeNull();
  worker.emit({ type: 'mask', mask: { ...result, capturedAt: 1490 } });
  expect(mask.current()).not.toBeNull();
  mask.dispose();
});
