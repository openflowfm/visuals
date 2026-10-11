/** Browser-local person confidence mask. Frames never leave this worker's origin. */
export interface PersonConfidenceMask {
  data: Float32Array;
  width: number;
  height: number;
  inferenceMs: number;
}
export type PersonMaskStatus = 'loading' | 'ready' | 'failed' | 'disposed';
export interface PersonMaskOptions {
  intervalMs?: number;
  onStatus?: (status: PersonMaskStatus, error?: string) => void;
}

export class PersonMask {
  latest: PersonConfidenceMask | null = null;
  status: PersonMaskStatus = 'loading';
  error: string | undefined;
  private worker: Worker | null = null;
  private busy = false;
  private lastAt = -Infinity;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: PersonMaskOptions = {}) {
    try {
      this.worker = new Worker(new URL('./person-mask.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }) => {
        if (this.status === 'disposed' || this.status === 'failed') return;
        clearTimeout(this.timer);
        if (data.type === 'ready') this.setStatus('ready');
        else if (data.type === 'mask') {
          this.latest = data.mask;
          this.busy = false;
        } else this.fail(data.error ?? 'Person segmentation failed.');
      };
      this.worker.onerror = (event) => this.fail(event.message || 'Person segmentation worker failed.');
      this.timer = setTimeout(() => this.fail('Person segmentation initialization timed out.'), 20000);
    } catch (error) {
      // Defer so callers can finish assigning their instance before the callback.
      queueMicrotask(() => this.fail(String(error)));
    }
  }

  /** Snapshot at most 10 times/second; busy calls are discarded, never queued. */
  update(canvas: HTMLCanvasElement): void {
    const now = performance.now();
    if (this.status !== 'ready' || this.busy || now - this.lastAt < Math.max(80, this.options.intervalMs ?? 100)) return;
    this.busy = true;
    this.lastAt = now;
    this.timer = setTimeout(() => this.fail('Person segmentation stopped responding.'), 5000);
    // Resize before transferring to bound image upload and readback cost.
    const width = 256;
    const height = Math.max(1, Math.round((canvas.height / canvas.width) * width));
    void createImageBitmap(canvas, { resizeWidth: width, resizeHeight: height, resizeQuality: 'low' }).then(
      (image) => {
        if (this.status !== 'ready' || !this.worker) return image.close();
        this.worker.postMessage({ image, timestamp: now }, [image]);
      },
      (error) => this.fail(`Unable to snapshot person input: ${String(error)}`),
    );
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.worker?.terminate();
    this.worker = null;
    this.latest = null;
    this.busy = false;
    this.setStatus('disposed');
  }

  private fail(error: string): void {
    if (this.status === 'disposed' || this.status === 'failed') return;
    clearTimeout(this.timer);
    this.worker?.terminate();
    this.worker = null;
    this.latest = null;
    this.busy = false;
    this.error = error;
    this.setStatus('failed');
  }

  private setStatus(status: PersonMaskStatus): void {
    this.status = status;
    this.options.onStatus?.(status, this.error);
  }
}
