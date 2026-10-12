import { cameraBegin, cameraEnd, cameraSubmit, type CameraFrame } from './api';

export interface CameraSettings {
  cameraOpacity: number;
  outlineOpacity: number;
  feedMix: number;
  steadiness: number;
  smoothing: number;
  detail: number;
  threshold: number;
  color: number;
  mirror: boolean;
  personOnly: boolean;
}
export const DEFAULT_CAMERA_SETTINGS: CameraSettings = {
  cameraOpacity: 0,
  outlineOpacity: 0.65,
  feedMix: 0.3,
  steadiness: 85,
  smoothing: 65,
  detail: 45,
  threshold: 12,
  color: 85,
  mirror: true,
  personOnly: true,
};
export type PreparedFrame = Pick<CameraFrame, 'width' | 'height' | 'paths' | 'remainingFreshMs'> & { rgba: Uint8ClampedArray };
export interface CaptureSource {
  ready: Promise<void>;
  frame(settings: CameraSettings): PreparedFrame | null;
  reset(): void;
  dispose(): void;
}
export interface CameraDevice {
  deviceId: string;
  label: string;
}
export interface CameraState {
  deviceId: string;
  devices: CameraDevice[];
  deviceMessage: string;
  status: 'off' | 'starting' | 'active' | 'failed';
  message: string;
  settings: CameraSettings;
}
export interface CameraDependencies {
  acquire(deviceId: string): Promise<MediaStream>;
  enumerate?(): Promise<CameraDevice[]>;
  watchDevices?(changed: () => void): () => void;
  source(stream: MediaStream, fail: (error: unknown) => void): CaptureSource;
  begin(): Promise<string>;
  end(token: string): Promise<void>;
  submit(metadata: CameraFrame, rgba: Uint8ClampedArray): Promise<number>;
  now(): number;
}
/** Persistent capture owner. UI/view lifetime never owns a stream or an IPC loop. */
export class CameraController {
  state: CameraState = { deviceId: '', devices: [], deviceMessage: '', status: 'off', message: 'Camera is off. Enable requests video only.', settings: { ...DEFAULT_CAMERA_SETTINGS } };
  private listeners = new Set<() => void>();
  private generation = 0;
  private epoch = 0;
  private sequence = 0;
  private stream: MediaStream | null = null;
  private source: CaptureSource | null = null;
  private token: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: Promise<unknown> = Promise.resolve();
  private nativeLifecycle: Promise<unknown> = Promise.resolve();
  private deviceRevision = 0;
  constructor(private deps: CameraDependencies) {}
  /** Enumeration never opens a device. Owned by the persistent provider. */
  watchDevices() {
    const unwatch = this.deps.watchDevices?.(() => void this.refreshDevices());
    void this.refreshDevices();
    return () => {
      ++this.deviceRevision;
      unwatch?.();
    };
  }
  async refreshDevices() {
    if (!this.deps.enumerate) return;
    const revision = ++this.deviceRevision;
    try {
      const devices = await this.deps.enumerate();
      if (revision !== this.deviceRevision) return;
      this.state = { ...this.state, devices, deviceMessage: '' };
    } catch {
      if (revision !== this.deviceRevision) return;
      this.state = { ...this.state, deviceMessage: 'Camera list unavailable. You can still try the selected camera.' };
    }
    this.listeners.forEach((listener) => listener());
  }
  selectDevice(deviceId: string) {
    if (deviceId === this.state.deviceId) return;
    const restart = this.state.status === 'starting' || this.state.status === 'active';
    if (restart) this.stop();
    this.state = { ...this.state, deviceId };
    this.listeners.forEach((listener) => listener());
    if (restart) void this.start();
  }
  private native<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.nativeLifecycle.catch(() => {}).then(operation);
    this.nativeLifecycle = next;
    return next;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.state;
  private publish(status: CameraState['status'], message: string) {
    this.state = { ...this.state, status, message };
    this.listeners.forEach((listener) => listener());
  }
  configure(change: Partial<CameraSettings>) {
    const prior = this.state.settings;
    this.state = { ...this.state, settings: { ...prior, ...change } };
    if (prior.mirror !== this.state.settings.mirror || prior.personOnly !== this.state.settings.personOnly) {
      this.epoch++;
      this.source?.reset();
    }
    this.listeners.forEach((listener) => listener());
  }
  async start() {
    if (this.state.status === 'starting' || this.state.status === 'active') return;
    const id = ++this.generation;
    this.publish('starting', 'Waiting for camera permission…');
    try {
      const stream = await this.deps.acquire(this.state.deviceId);
      if (id !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      void this.refreshDevices();
      const track = stream.getVideoTracks()[0];
      if (!track || track.readyState === 'ended') throw new Error('The camera is no longer available.');
      track.onended = () => {
        if (id === this.generation) this.fail('Camera disconnected. Enable it to try again.');
      };
      this.source = this.deps.source(stream, (error) => {
        if (id === this.generation) this.fail(error);
      });
      await this.source.ready;
      if (id !== this.generation) return;
      const token = await this.native(async () => {
        if (id !== this.generation) return null;
        const next = await this.deps.begin();
        if (id !== this.generation) {
          await this.deps.end(next);
          return null;
        }
        // Assign inside the serialized operation so Stop cannot miss a live token.
        this.token = next;
        return next;
      });
      if (!token || id !== this.generation) return;
      this.sequence = 0;
      this.epoch++;
      this.publish('active', 'Camera on · preparing a fresh person mask…');
      // An old submission may still be acknowledged after Stop. Never overlap it.
      await this.pending.catch(() => {});
      if (id === this.generation) void this.tick(id);
    } catch (error) {
      if (id === this.generation) this.fail(error);
    }
  }
  stop() {
    ++this.generation;
    clearTimeout(this.timer);
    this.source?.dispose();
    this.source = null;
    this.stream?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    this.stream = null;
    const token = this.token;
    this.token = null;
    if (token)
      void this.native(() => this.deps.end(token)).catch((error) => {
        if (this.state.status === 'off') this.publish('off', `Camera stopped; native cleanup reported: ${String(error)}`);
      });
    this.publish('off', 'Camera is off.');
  }
  private fail(error: unknown) {
    this.stop();
    this.publish('failed', String(error instanceof Error ? error.message : error));
  }
  private async tick(id: number) {
    const started = this.deps.now();
    try {
      const frame = this.source?.frame(this.state.settings);
      if (id !== this.generation) return;
      if (frame && this.token) {
        const settings = this.state.settings;
        const metadata: CameraFrame = {
          ...frame,
          sessionToken: this.token,
          sequence: ++this.sequence,
          sourceEpoch: this.epoch,
          feedMix: settings.feedMix,
          cameraOpacity: settings.cameraOpacity,
          outlineOpacity: settings.outlineOpacity,
          outlineWidth: 0.85,
          interpolationMs: 65,
        };
        // Explicitly exclude image bytes from JSON metadata.
        delete (metadata as CameraFrame & { rgba?: Uint8ClampedArray }).rgba;
        const expected = metadata.sequence;
        this.pending = this.deps.submit(metadata, frame.rgba);
        const accepted = await this.pending;
        if (id !== this.generation) return;
        if (accepted !== expected) throw new Error('Camera frame was not acknowledged.');
        if (this.state.message !== 'Camera on · feeding edges into the current preset.') this.publish('active', 'Camera on · feeding edges into the current preset.');
      } else if (this.state.message !== 'Camera on · waiting for a fresh frame and person mask.') this.publish('active', 'Camera on · waiting for a fresh frame and person mask.');
    } catch (error) {
      if (id === this.generation) this.fail(error);
      return;
    }
    if (id === this.generation) this.timer = setTimeout(() => void this.tick(id), Math.max(0, 1000 / 30 - (this.deps.now() - started)));
  }
}
export const nativeCameraCommands = { begin: cameraBegin, end: cameraEnd, submit: cameraSubmit };
