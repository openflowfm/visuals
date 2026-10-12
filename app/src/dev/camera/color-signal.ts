/** Two views of one source: saturated emission for the loop, a crisp identity
 * plate for the foreground. Work stays at capture resolution; no full-size CPU FX. */
export class ColorSignal {
  readonly emission: Uint8ClampedArray<ArrayBuffer>;
  readonly identity: Uint8ClampedArray<ArrayBuffer>;
  private readonly palette = new Uint8ClampedArray(256 * 3);
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.emission = new Uint8ClampedArray(width * height * 4);
    this.identity = new Uint8ClampedArray(width * height * 4);
  }
  prepare(edges: Uint8ClampedArray, source: Uint8ClampedArray, opacity: Float32Array | null, color: number, time: number) {
    const saturation = Math.max(0, Math.min(1, color / 100));
    // A traveling spectrum maps facial luminance and vertical position to hue.
    for (let i = 0; i < 256; i++) {
      const hue = (i / 256) * 6 + time * 0.12;
      for (let c = 0; c < 3; c++) {
        const ramp = Math.max(0, Math.min(1, Math.abs(((hue + [0, 4, 2][c]) % 6) - 3) - 1));
        this.palette[i * 3 + c] = 255 * (1 - saturation + saturation * ramp);
      }
    }
    for (let i = 0; i < this.width * this.height; i++) {
      const p = i * 4;
      const edge = edges[p] / 255;
      const alpha = opacity ? opacity[i] : 1;
      const luma = (source[p] * 0.2126 + source[p + 1] * 0.7152 + source[p + 2] * 0.0722) / 255;
      const band = (Math.floor(i / this.width) * 1.1 + luma * 95) & 255;
      const shade = Math.round(luma * 5) / 5;
      for (let c = 0; c < 3; c++) {
        const tone = this.palette[band * 3 + c];
        this.emission[p + c] = edge * tone;
        // Warm original shading plus spectral ink retains eyes, nose and mouth.
        this.identity[p + c] = source[p + c] * 0.65 + tone * shade * 0.35;
      }
      this.emission[p + 3] = 255;
      this.identity[p + 3] = alpha * 0.42 * 255;
    }
    return this.emission;
  }
}
