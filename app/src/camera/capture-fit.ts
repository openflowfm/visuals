export interface CaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** Centered contain retains the full subject, including portrait cameras. */
export function captureRect(sourceWidth: number, sourceHeight: number, width: number, height: number): CaptureRect | null {
  if (![sourceWidth, sourceHeight, width, height].every((value) => Number.isFinite(value) && value > 0)) return null;
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const w = sourceWidth * scale,
    h = sourceHeight * scale;
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}
/** The Sobel/blur support must not turn transparent padding into a framing line. */
export function gatePaddingEdges(edges: Uint8ClampedArray, width: number, height: number, rect: CaptureRect) {
  const left = rect.x > 0 ? rect.x + 4 : 0,
    right = rect.x + rect.width < width ? rect.x + rect.width - 4 : width;
  const top = rect.y > 0 ? rect.y + 4 : 0,
    bottom = rect.y + rect.height < height ? rect.y + rect.height - 4 : height;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (x < left || x >= right || y < top || y >= bottom) {
        const i = (y * width + x) * 4;
        edges[i] = edges[i + 1] = edges[i + 2] = 0;
      }
}
