// The three MilkDrop packages ship no types. Only what this repo calls is
// written down; see `client/render/milk.ts` and `server/presets.ts`.

declare module 'butterchurn' {
  export interface AudioLevels {
    timeByteArray: Uint8Array<ArrayBuffer>;
    timeByteArrayL: Uint8Array<ArrayBuffer>;
    timeByteArrayR: Uint8Array<ArrayBuffer>;
  }
  export interface Visualizer {
    loadPreset(preset: unknown, blendTime?: number): void;
    setRendererSize(width: number, height: number): void;
    setInternalMeshSize(width: number, height: number): void;
    setOutputAA(on: boolean): void;
    render(opts?: { audioLevels?: AudioLevels; elapsedTime?: number }): void;
    /** Private, and pinned with the version: the FFT band edges assume 44.1 kHz. */
    renderer: {
      audioLevels: { starts: number[]; stops: number[] };
      warpShader: { shaderProgram: WebGLProgram };
      compShader: { shaderProgram: WebGLProgram };
    };
  }
  const butterchurn: {
    createVisualizer(
      context: AudioContext | null,
      canvas: HTMLCanvasElement,
      opts: { width: number; height: number; pixelRatio?: number; textureRatio?: number; meshWidth?: number; meshHeight?: number },
    ): Visualizer;
  };
  export default butterchurn;
}

declare module 'butterchurn-presets' {
  const presets: { getPresets(): Record<string, unknown> };
  export default presets;
}

declare module 'milkdrop-preset-converter' {
  const converter: {
    convertPreset(text: string): Promise<any>;
    /** One shader's HLSL, `shader_body { … }` included, to Butterchurn's GLSL. */
    convertShader(text: string): string | Promise<string>;
  };
  export default converter;
}
