/** Explicit browser input; intentionally never connects to the speakers. */
export class CameraAudio {
  private generation = 0;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private posting: Promise<void> = Promise.resolve();
  private barrier: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  active = false;
  constructor(
    private post: (route: string, body?: BodyInit) => Promise<void>,
    private state: (message: string, active: boolean) => void,
    private meter: (level: number) => void,
    private gain: () => number,
  ) {}
  async start(deviceId: string) {
    const id = this.generation + 1;
    await this.stop();
    if (id !== this.generation) return;
    this.state('Waiting for audio permission…', false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      if (id !== this.generation) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      const context = new AudioContext();
      this.context = context;
      await context.resume();
      if (id !== this.generation) return;
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(1024);
      this.active = true;
      this.state(`Listening · ${stream.getAudioTracks()[0]?.label || 'audio input'}`, true);
      stream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          void this.stop().then(() => this.state('Audio input disconnected.', false));
        };
      });
      const tick = async () => {
        if (id !== this.generation) return;
        analyser.getFloatTimeDomainData(samples);
        const gain = this.gain();
        this.meter(Math.min(1, Math.sqrt(samples.reduce((sum, n) => sum + n * n, 0) / samples.length) * gain * 3));
        // Explicit little-endian encoding, independent of host endianness.
        const bytes = new ArrayBuffer(samples.byteLength);
        const view = new DataView(bytes);
        samples.forEach((sample, i) => view.setFloat32(i * 4, sample, true));
        try {
          this.posting = this.post(`camera/audio?rate=${context.sampleRate}&gain=${gain}`, bytes);
          await this.posting;
        } catch (error) {
          if (id === this.generation) {
            await this.stop();
            this.state(String(error), false);
          }
          return;
        }
        if (id === this.generation)
          this.timer = setTimeout(() => {
            void tick();
          }, 33);
      };
      void tick();
    } catch (error) {
      if (id === this.generation) {
        await this.stop();
        this.state(error instanceof Error ? error.message : String(error), false);
      }
    }
  }
  async stop() {
    this.generation++;
    this.active = false;
    clearTimeout(this.timer);
    this.stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    this.stream = null;
    const context = this.context;
    this.context = null;
    this.meter(0);
    this.state('Audio off', false);
    const last = this.posting;
    this.barrier = this.barrier
      .catch(() => {})
      .then(async () => {
        await last.catch(() => {});
        await this.post('camera/audio/stop').catch(() => {});
      });
    await Promise.all([this.barrier, context?.close().catch(() => {})]);
  }
}
