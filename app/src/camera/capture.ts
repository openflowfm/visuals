import { captureRect, gatePaddingEdges } from './capture-fit';
import { budgetContours } from './geometry-budget';
import { Contours } from './contours';
import { traceContours } from './curve-contours';
import { TemporalContours } from './temporal-contours';
import { ColorSignal } from './color-signal';
import { contourPacket } from './contour-packet';
import { PersonMask } from './person-mask';
import { CameraController, nativeCameraCommands, type CameraSettings, type CaptureSource, type PreparedFrame } from './controller';
const WIDTH = 320,
  HEIGHT = 180;
/** Only observed decoded-frame generations can renew a submission's lifetime. */
export class VideoFreshness {
  private last = -Infinity;
  private consumed = -Infinity;
  private at = -Infinity;
  observe(sequence: number, at: number) {
    if (Number.isFinite(sequence) && sequence > 0 && sequence !== this.last && Number.isFinite(at)) {
      this.last = sequence;
      this.at = at;
    }
  }
  take(now: number): number | null {
    if (this.last === this.consumed || now < this.at || now - this.at > 250) return null;
    this.consumed = this.last;
    return this.at;
  }
}
export class BrowserCapture implements CaptureSource {
  readonly ready: Promise<void>;
  private video = document.createElement('video');
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private contours = new Contours(WIDTH, HEIGHT);
  private temporal = new TemporalContours(WIDTH, HEIGHT);
  private signal = new ColorSignal(WIDTH, HEIGHT);
  private freshness = new VideoFreshness();
  private mask: PersonMask | null = null;
  private disposed = false;
  private maskWasFresh = false;
  private callbackId: number | null = null;
  private callbackFrames: boolean;
  private track: MediaStreamTrack | undefined;
  constructor(
    stream: MediaStream,
    private fail: (error: unknown) => void,
  ) {
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Camera image processing is unavailable.');
    this.ctx = ctx;
    this.track = stream.getVideoTracks()[0];
    this.callbackFrames = typeof this.video.requestVideoFrameCallback === 'function';
    if (!this.callbackFrames && typeof this.video.getVideoPlaybackQuality !== 'function') throw new Error('This window cannot report decoded camera frames. Camera capture is unavailable.');
    if (this.callbackFrames) {
      const observed: VideoFrameRequestCallback = (at, metadata) => {
        if (this.disposed) return;
        this.freshness.observe(metadata.presentedFrames, at);
        this.callbackId = this.video.requestVideoFrameCallback(observed);
      };
      this.callbackId = this.video.requestVideoFrameCallback(observed);
    }
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = stream;
    this.ready = this.video.play();
  }
  reset() {
    this.temporal.reset();
    this.mask?.dispose();
    this.mask = null;
    this.maskWasFresh = false;
  }
  frame(settings: CameraSettings): PreparedFrame | null {
    if (this.disposed || this.video.readyState < 2) return null;
    if (settings.personOnly && !this.mask)
      this.mask = new PersonMask({
        onStatus: (status, error) => {
          if (status === 'failed' && !this.disposed) this.fail(error ?? 'Person isolation is unavailable.');
        },
      });
    const now = performance.now();
    // Check stale masks even while the camera itself has stalled.
    if (settings.personOnly && !this.mask?.current(now) && this.maskWasFresh) {
      this.temporal.reset();
      this.maskWasFresh = false;
    }
    if (this.track?.muted) return null;
    if (!this.callbackFrames) this.freshness.observe(this.video.getVideoPlaybackQuality().totalVideoFrames, now);
    const capturedAt = this.freshness.take(now);
    if (capturedAt === null) return null;
    const rect = captureRect(this.video.videoWidth, this.video.videoHeight, WIDTH, HEIGHT);
    if (!rect) return null;
    this.ctx.resetTransform();
    this.ctx.clearRect(0, 0, WIDTH, HEIGHT);
    this.ctx.setTransform(settings.mirror ? -1 : 1, 0, 0, 1, settings.mirror ? WIDTH : 0, 0);
    this.ctx.drawImage(this.video, rect.x, rect.y, rect.width, rect.height);
    this.ctx.resetTransform();
    if (settings.personOnly) this.mask?.update(this.canvas);
    const mask = settings.personOnly ? this.mask?.current() : null;
    if (settings.personOnly && !mask) return null;
    this.maskWasFresh = Boolean(mask);
    const source = this.ctx.getImageData(0, 0, WIDTH, HEIGHT).data;
    const edges = this.contours.process(source, settings.detail, settings.threshold, mask ?? undefined);
    gatePaddingEdges(edges, WIDTH, HEIGHT, rect);
    const paths = this.temporal.update(budgetContours(traceContours(edges, WIDTH, HEIGHT, settings.smoothing)), now, settings.steadiness);
    this.signal.prepare(edges, source, mask ? this.contours.foreground : null, settings.color, now / 1000);
    const remainingFreshMs = Math.max(0, 250 - (performance.now() - Math.min(capturedAt, mask?.capturedAt ?? capturedAt)));
    if (remainingFreshMs <= 0) {
      this.temporal.reset();
      return null;
    }
    return {
      width: WIDTH,
      height: HEIGHT,
      paths: contourPacket(paths, WIDTH, HEIGHT, settings.feedMix, (x, y) => this.signal.strokeColor(x, y, source)).paths,
      remainingFreshMs,
      rgba: this.signal.identity,
    };
  }
  dispose() {
    this.disposed = true;
    if (this.callbackId !== null) this.video.cancelVideoFrameCallback(this.callbackId);
    this.callbackId = null;
    this.reset();
    this.video.pause();
    this.video.srcObject = null;
  }
}
export function createCameraController() {
  return new CameraController({
    ...nativeCameraCommands,
    now: () => performance.now(),
    acquire: () => {
      if (!navigator.mediaDevices?.getUserMedia) return Promise.reject(new Error('Camera capture is unavailable in this window.'));
      return navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 60, max: 60 } } });
    },
    source: (stream, fail) => new BrowserCapture(stream, fail),
  });
}
