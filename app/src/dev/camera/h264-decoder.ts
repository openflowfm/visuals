/** One independently decodable Annex-B frame at a time. Caller owns returned frames. */
export class H264Decoder {
  private decoder: VideoDecoder | null = null;
  private configKey = '';
  private disposed = false;
  private busy = false;
  private pending: { resolve: (frame: VideoFrame) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  async decode(data: ArrayBuffer, codec: string, width: number, height: number, timestamp: number): Promise<VideoFrame> {
    if (this.disposed) throw new Error('Video decoder stopped');
    if (this.busy) throw new Error('Video decode already in flight');
    this.busy = true;
    try {
      const key = `${codec}:${width}:${height}`;
      if (key !== this.configKey) {
        const config: VideoDecoderConfig = { codec, codedWidth: width, codedHeight: height, hardwareAcceleration: 'prefer-hardware', optimizeForLatency: true };
        const support = await VideoDecoder.isConfigSupported(config);
        if (this.disposed) throw new Error('Video decoder stopped');
        if (!support.supported) throw new Error(`H.264 profile unavailable: ${codec}`);
        this.decoder?.close();
        this.decoder = new VideoDecoder({
          output: (frame) => {
            const pending = this.pending;
            if (!pending) {
              frame.close();
              return;
            }
            this.pending = null;
            clearTimeout(pending.timer);
            pending.resolve(frame);
          },
          error: (error) => this.fail(error),
        });
        this.decoder.configure(config);
        this.configKey = key;
      }
      return await new Promise<VideoFrame>((resolve, reject) => {
        this.pending = { resolve, reject, timer: setTimeout(() => this.fail(new Error('H.264 decode timed out')), 1500) };
        try {
          this.decoder!.decode(new EncodedVideoChunk({ type: 'key', timestamp, data }));
        } catch (error) {
          this.fail(error instanceof Error ? error : new Error(String(error)));
        }
      });
    } finally {
      this.busy = false;
    }
  }
  private fail(error: Error) {
    const pending = this.pending;
    this.pending = null;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }
  dispose() {
    this.disposed = true;
    this.fail(new Error('Video decoder stopped'));
    if (this.decoder && this.decoder.state !== 'closed') this.decoder.close();
    this.decoder = null;
  }
}
