export interface ForegroundMask {
  data: Float32Array;
  width: number;
  height: number;
}

/** Bounded, reusable CPU contour filter. All rows are top-to-bottom RGBA8. */
export class Contours {
  readonly pixels: Uint8ClampedArray<ArrayBuffer>;
  private readonly gray: Float32Array;
  private readonly horizontal: Float32Array;
  private readonly smooth: Float32Array;
  private readonly strength: Float32Array;
  private readonly direction: Uint8Array;
  readonly foreground: Float32Array;
  private readonly cutoutPixels: Uint8ClampedArray<ArrayBuffer>;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    const count = width * height;
    this.pixels = new Uint8ClampedArray(count * 4);
    for (let i = 3; i < this.pixels.length; i += 4) this.pixels[i] = 255;
    this.gray = new Float32Array(count);
    this.horizontal = new Float32Array(count);
    this.smooth = new Float32Array(count);
    this.strength = new Float32Array(count);
    this.direction = new Uint8Array(count);
    this.foreground = new Float32Array(count);
    this.cutoutPixels = new Uint8ClampedArray(count * 4);
  }

  /** Bilinear confidence sampling keeps the decimated mask aligned to input. */
  cutout(rgba: Uint8ClampedArray, mask: ForegroundMask) {
    const { width: w, height: h, foreground, cutoutPixels: out } = this;
    if (rgba.length !== w * h * 4 || mask.width < 1 || mask.height < 1 || mask.data.length !== mask.width * mask.height) throw new Error('Invalid foreground mask');
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const mx = (x / Math.max(1, w - 1)) * (mask.width - 1),
          my = (y / Math.max(1, h - 1)) * (mask.height - 1);
        const x0 = Math.floor(mx),
          y0 = Math.floor(my),
          x1 = Math.min(mask.width - 1, x0 + 1),
          y1 = Math.min(mask.height - 1, y0 + 1);
        const a = mask.data[y0 * mask.width + x0] * (1 - (mx - x0)) + mask.data[y0 * mask.width + x1] * (mx - x0);
        const b = mask.data[y1 * mask.width + x0] * (1 - (mx - x0)) + mask.data[y1 * mask.width + x1] * (mx - x0);
        let alpha = Math.min(1, Math.max(0, (a + (b - a) * (my - y0) - 0.3) / 0.4));
        alpha = alpha * alpha * (3 - 2 * alpha);
        const i = y * w + x;
        foreground[i] = alpha;
        out[i * 4] = rgba[i * 4] * alpha;
        out[i * 4 + 1] = rgba[i * 4 + 1] * alpha;
        out[i * 4 + 2] = rgba[i * 4 + 2] * alpha;
        out[i * 4 + 3] = 255;
      }
    return out;
  }

  /** Detail 0..100 controls spatial denoising. Threshold is Sobel contrast 0..60. */
  process(rgba: Uint8ClampedArray, detail: number, threshold: number, mask?: ForegroundMask) {
    const { width: w, height: h, gray, horizontal, smooth, strength, direction, pixels } = this;
    if (rgba.length !== w * h * 4) throw new Error('Contour frame dimensions do not match');
    if (mask) rgba = this.cutout(rgba, mask);
    const extra = 1 - Math.max(0, Math.min(100, detail)) / 100;
    for (let i = 0; i < gray.length; i++) gray[i] = rgba[i * 4] * 0.2126 + rgba[i * 4 + 1] * 0.7152 + rgba[i * 4 + 2] * 0.0722;
    // Separable binomial blur. A wider five-tap kernel at lower detail rejects
    // camera grain and fine room textures before any contrast is amplified.
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const a = gray[y * w + Math.max(0, x - 1)],
          b = gray[y * w + Math.min(w - 1, x + 1)];
        const small = (a + 2 * gray[i] + b) / 4;
        const large = (gray[y * w + Math.max(0, x - 2)] + 4 * a + 6 * gray[i] + 4 * b + gray[y * w + Math.min(w - 1, x + 2)]) / 16;
        horizontal[i] = small + extra * (large - small);
      }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const a = horizontal[Math.max(0, y - 1) * w + x],
          b = horizontal[Math.min(h - 1, y + 1) * w + x];
        const small = (a + 2 * horizontal[i] + b) / 4;
        const large = (horizontal[Math.max(0, y - 2) * w + x] + 4 * a + 6 * horizontal[i] + 4 * b + horizontal[Math.min(h - 1, y + 2) * w + x]) / 16;
        smooth[i] = small + extra * (large - small);
      }
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        let gx = smooth[i - w + 1] + 2 * smooth[i + 1] + smooth[i + w + 1] - smooth[i - w - 1] - 2 * smooth[i - 1] - smooth[i + w - 1];
        let gy = smooth[i + w - 1] + 2 * smooth[i + w] + smooth[i + w + 1] - smooth[i - w - 1] - 2 * smooth[i - w] - smooth[i - w + 1];
        if (mask) {
          const a = this.foreground;
          const mx = (a[i - w + 1] + 2 * a[i + 1] + a[i + w + 1] - a[i - w - 1] - 2 * a[i - 1] - a[i + w - 1]) * 128;
          const my = (a[i + w - 1] + 2 * a[i + w] + a[i + w + 1] - a[i - w - 1] - 2 * a[i - w] - a[i - w + 1]) * 128;
          if (mx * mx + my * my > gx * gx + gy * gy) {
            gx = mx;
            gy = my;
          }
        }
        strength[i] = Math.hypot(gx, gy) / 4;
        direction[i] = Math.abs(gy) < Math.abs(gx) * 0.414 ? 0 : Math.abs(gx) < Math.abs(gy) * 0.414 ? 1 : gx * gy > 0 ? 2 : 3;
      }
    const floor = Math.max(0, Math.min(60, threshold));
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let edge = 0;
        if (x > 1 && y > 1 && x < w - 2 && y < h - 2) {
          const step = direction[i] === 0 ? 1 : direction[i] === 1 ? w : direction[i] === 2 ? w + 1 : w - 1;
          const level = strength[i];
          // Nonmaximum suppression keeps silhouettes narrow, not a glowing fog.
          if (level >= strength[i - step] && level > strength[i + step]) edge = Math.min(1, Math.max(0, (level - floor) / 8)) * 255;
        }
        pixels[i * 4] = pixels[i * 4 + 1] = pixels[i * 4 + 2] = edge;
      }
    return pixels;
  }
}

/** Validate raw output before constructing ImageData, including truncated frames. */
export function rawFrameSize(headers: Headers, byteLength: number): [number, number] {
  const w = Number(headers.get('X-Frame-Width')),
    h = Number(headers.get('X-Frame-Height'));
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 1920 || h > 1080 || byteLength !== w * h * 4) throw new Error('Invalid native RGBA output frame');
  return [w, h];
}
