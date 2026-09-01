/** Measurements shared by the real flow renderer and sampled footage. */
export interface FrameMetrics {
  /** Mean Rec. 709 luma, 0–255. */
  lum: number;
  /** Share of pixels that are exactly black. Kept for historical reports. */
  black: number;
  /** Share of pixels no brighter than eight, tolerant of video compression. */
  dark: number;
  /** Share of pixels with at least one channel at sixteen or above. */
  coverage: number;
  /** Share of pixels at or above 250 in every channel. */
  white: number;
  /** Brightest single channel value anywhere in the frame. */
  peak: number;
  /** Mean channel range among lit pixels, 0–1. */
  chroma: number;
  /** Mean neighbouring luma change, 0–255. */
  edge: number;
  /** Brightness-weighted horizontal centre, -1 at left and 1 at right. */
  centreX: number;
  /** Brightness-weighted vertical centre, -1 at top and 1 at bottom. */
  centreY: number;
  /** Brightness-weighted RMS distance from the centre in normalized frame space. */
  spread: number;
  /** Similarity to the horizontal mirror image, 0–1. */
  mirrorX: number;
  /** Similarity to the vertical mirror image, 0–1. */
  mirrorY: number;
  /** Mean run length of identical values inside a gradient. */
  terrace: number;
}

const luma = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Runs of one value inside a gradient, which is what a band is. */
export function terraceOf(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): number {
  let runs = 0;
  let total = 0;
  const rows = Math.min(height, 64);
  for (let row = 0; row < rows; row++) {
    const y = Math.floor(((row + 0.5) / rows) * height);
    let runStart = 0;
    let held = -1;
    for (let x = 0; x <= width; x++) {
      const at = (y * width + x) * 4;
      const value = x < width ? pixels[at + 1] : -999;
      if (value === held) continue;
      const length = x - runStart;
      if (held > 4 && value >= 0 && Math.abs(value - held) === 1 && length > 1) {
        runs += 1;
        total += length;
      }
      held = value;
      runStart = x;
    }
  }
  return runs > 0 ? total / runs : 0;
}

export function metricsOf(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): FrameMetrics {
  const count = width * height;
  if (pixels.length !== count * 4) {
    throw new Error(`expected ${count * 4} RGBA bytes, received ${pixels.length}`);
  }

  let sum = 0;
  let black = 0;
  let dark = 0;
  let covered = 0;
  let white = 0;
  let peak = 0;
  let chroma = 0;
  let chromaPixels = 0;
  let weight = 0;
  let centreX = 0;
  let centreY = 0;
  let spread = 0;
  let edges = 0;
  let edgeCount = 0;
  let mirrorX = 0;
  let mirrorY = 0;
  let mirrorCountX = 0;
  let mirrorCountY = 0;

  for (let y = 0; y < height; y++) {
    const ny = ((y + 0.5) / height) * 2 - 1;
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      const r = pixels[at];
      const g = pixels[at + 1];
      const b = pixels[at + 2];
      const now = luma(r, g, b);
      const most = Math.max(r, g, b);
      const least = Math.min(r, g, b);
      const nx = ((x + 0.5) / width) * 2 - 1;

      sum += now;
      if (most === 0) black += 1;
      if (most <= 8) dark += 1;
      if (most >= 16) covered += 1;
      if (r >= 250 && g >= 250 && b >= 250) white += 1;
      peak = Math.max(peak, most);
      if (most > 8) {
        chroma += (most - least) / 255;
        chromaPixels += 1;
      }
      weight += now;
      centreX += nx * now;
      centreY += ny * now;
      spread += (nx * nx + ny * ny) * now;

      if (x > 0) {
        const left = at - 4;
        edges += Math.abs(now - luma(pixels[left], pixels[left + 1], pixels[left + 2]));
        edgeCount += 1;
      }
      if (y > 0) {
        const above = at - width * 4;
        edges += Math.abs(now - luma(pixels[above], pixels[above + 1], pixels[above + 2]));
        edgeCount += 1;
      }
      if (x < width / 2) {
        const opposite = (y * width + (width - x - 1)) * 4;
        mirrorX += Math.abs(
          now - luma(pixels[opposite], pixels[opposite + 1], pixels[opposite + 2]),
        );
        mirrorCountX += 1;
      }
      if (y < height / 2) {
        const opposite = ((height - y - 1) * width + x) * 4;
        mirrorY += Math.abs(
          now - luma(pixels[opposite], pixels[opposite + 1], pixels[opposite + 2]),
        );
        mirrorCountY += 1;
      }
    }
  }

  return {
    lum: sum / count,
    black: black / count,
    dark: dark / count,
    coverage: covered / count,
    white: white / count,
    peak,
    chroma: chromaPixels ? chroma / chromaPixels : 0,
    edge: edgeCount ? edges / edgeCount : 0,
    centreX: weight ? centreX / weight : 0,
    centreY: weight ? centreY / weight : 0,
    spread: weight ? Math.sqrt(spread / weight) : 0,
    mirrorX: mirrorCountX ? 1 - mirrorX / mirrorCountX / 255 : 1,
    mirrorY: mirrorCountY ? 1 - mirrorY / mirrorCountY / 255 : 1,
    terrace: terraceOf(pixels, width, height),
  };
}

/** Mean per-channel difference between two equally-sized RGBA frames, 0–1. */
export function differenceOf(
  left: Uint8Array | Uint8ClampedArray,
  right: Uint8Array | Uint8ClampedArray,
): number {
  if (left.length !== right.length || left.length % 4 !== 0) {
    throw new Error('frame difference needs two equally-sized RGBA frames');
  }
  let sum = 0;
  for (let at = 0; at < left.length; at += 4) {
    sum += Math.abs(left[at] - right[at]);
    sum += Math.abs(left[at + 1] - right[at + 1]);
    sum += Math.abs(left[at + 2] - right[at + 2]);
  }
  return sum / (left.length / 4) / 3 / 255;
}

/** Mean change across equal phase steps, including the last-to-first loop seam. */
export function cyclicMotion(
  frames: readonly (Uint8Array | Uint8ClampedArray)[],
): number {
  if (frames.length < 2) return 0;
  let sum = 0;
  for (let index = 0; index < frames.length; index++) {
    sum += differenceOf(frames[index], frames[(index + 1) % frames.length]);
  }
  return sum / frames.length;
}
