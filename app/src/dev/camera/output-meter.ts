interface Sample {
  at: number;
  unique: boolean;
  verified: boolean;
}
/** Count delivered render generations, never infer unseen frames from ID gaps. */
export class OutputMeter {
  private samples: Sample[] = [];
  private lastSequence: string | null = null;
  private startedAt: number;
  constructor(now: number) {
    this.startedAt = now;
  }
  reset(now: number) {
    this.samples = [];
    this.lastSequence = null;
    this.startedAt = now;
  }
  record(now: number, header: string | null) {
    const sequence = header !== null && /^\d+$/.test(header) ? BigInt(header).toString() : null;
    const unique = sequence !== null && sequence !== this.lastSequence;
    if (sequence !== null) this.lastSequence = sequence;
    this.samples.push({ at: now, unique, verified: sequence !== null });
    this.prune(now);
    return sequence === null || unique;
  }
  private prune(now: number) {
    this.samples = this.samples.filter((sample) => sample.at > now - 10_000);
  }
  snapshot(now: number, windowMs = 10_000) {
    this.prune(now);
    const duration = Math.max(1, Math.min(windowMs, now - this.startedAt));
    const samples = this.samples.filter((sample) => sample.at > now - windowMs);
    return {
      verified: samples.length > 0 && samples.every((sample) => sample.verified),
      nativeFps: (samples.filter((sample) => sample.unique).length * 1000) / duration,
      readsPerSecond: (samples.length * 1000) / duration,
      seconds: duration / 1000,
    };
  }
}
