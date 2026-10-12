export interface VideoPacket {
  response: Response;
  buffer: ArrayBuffer;
  fetchMs: number;
  bodyMs: number;
}
/** A single packet slot overlaps transport with decode, never queues a stream. */
export class VideoPackets {
  private slot: Promise<VideoPacket> | null = null;
  private controller: AbortController | null = null;
  private disposed = false;
  constructor(private url: (after: string) => string) {}
  prefetch(after: string) {
    if (this.disposed || this.slot) return;
    const controller = new AbortController();
    this.controller = controller;
    this.slot = (async () => {
      const started = performance.now();
      const response = await fetch(this.url(after), { cache: 'no-store', signal: controller.signal });
      const headersAt = performance.now();
      const buffer = await response.arrayBuffer();
      return { response, buffer, fetchMs: headersAt - started, bodyMs: performance.now() - headersAt };
    })();
    // A failed prefetch may wait for the current decode before being consumed.
    void this.slot.catch(() => {});
  }
  async take(after: string) {
    if (this.disposed) throw new Error('Video transport stopped');
    this.prefetch(after);
    const slot = this.slot!;
    try {
      return await slot;
    } finally {
      if (this.slot === slot) {
        this.slot = null;
        this.controller = null;
      }
    }
  }
  async dispose() {
    this.disposed = true;
    this.controller?.abort();
    const slot = this.slot;
    this.slot = null;
    this.controller = null;
    await slot?.catch(() => {});
  }
}
