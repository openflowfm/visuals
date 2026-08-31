import type { CircuitImage } from './circuit.ts';
import type { Program } from './gl.ts';
import { mediaUrl } from './media.ts';

interface HeldImage {
  key: string;
  texture: WebGLTexture;
  width: number;
  height: number;
  abort: AbortController;
  trouble: string | null;
}

export interface ImageBank {
  bind(program: Program, images: readonly CircuitImage[], scope?: string): void;
  clear(): void;
  readonly error: string | null;
  free(): void;
}

export const MAX_IMAGE_EDGE = 4096;

export function boundedImageSize(width: number, height: number, edge: number) {
  const scale = Math.min(1, edge / Math.max(1, width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function createImageBank(gl: WebGL2RenderingContext): ImageBank {
  const held = new Map<number, HeldImage>();
  const blank = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, blank);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 0]),
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const edge = Math.min(MAX_IMAGE_EDGE, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);

  const release = (state: HeldImage) => {
    state.abort.abort();
    gl.deleteTexture(state.texture);
  };

  const create = (image: CircuitImage, key: string): HeldImage => {
    const texture = gl.createTexture()!;
    const state: HeldImage = {
      key,
      texture,
      width: 1,
      height: 1,
      abort: new AbortController(),
      trouble: null,
    };
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 0]),
    );

    void (async () => {
      try {
        const response = await fetch(mediaUrl(image.asset), { signal: state.abort.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const probe = await createImageBitmap(blob);
        const size = boundedImageSize(probe.width, probe.height, edge);
        const bitmap =
          size.width === probe.width && size.height === probe.height
            ? probe
            : await createImageBitmap(blob, {
                resizeWidth: size.width,
                resizeHeight: size.height,
                resizeQuality: 'high',
              });
        if (bitmap !== probe) probe.close();
        if (state.abort.signal.aborted || held.get(image.index) !== state) {
          bitmap.close();
          return;
        }
        gl.activeTexture(gl.TEXTURE3 + image.index);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        state.width = bitmap.width;
        state.height = bitmap.height;
        state.trouble = null;
        bitmap.close();
      } catch (err) {
        if (!state.abort.signal.aborted) {
          state.trouble = `${image.asset}: ${(err as Error).message || 'the browser could not decode this image'}`;
        }
      }
    })();
    return state;
  };

  return {
    get error() {
      return [...held.values()].find((state) => state.trouble)?.trouble ?? null;
    },
    bind(program, images, scope = '') {
      const active = new Set(images.map((image) => image.index));
      for (const [index, state] of held) {
        if (active.has(index)) continue;
        release(state);
        held.delete(index);
      }
      for (let index = 0; index < 4; index++) {
        const image = images.find((entry) => entry.index === index);
        gl.activeTexture(gl.TEXTURE3 + index);
        if (!image?.asset) {
          const old = held.get(index);
          if (old) {
            release(old);
            held.delete(index);
          }
          gl.bindTexture(gl.TEXTURE_2D, blank);
          gl.uniform1i(program.uniform(`uImage${index}`), 3 + index);
          gl.uniform2f(program.uniform(`uImageSize[${index}]`), 1, 1);
          continue;
        }
        const key = `${scope}:${image.id}:${image.asset}`;
        let state = held.get(index);
        if (!state || state.key !== key) {
          if (state) release(state);
          state = create(image, key);
          held.set(index, state);
        }
        gl.bindTexture(gl.TEXTURE_2D, state.texture);
        gl.uniform1i(program.uniform(`uImage${index}`), 3 + index);
        gl.uniform2f(program.uniform(`uImageSize[${index}]`), state.width, state.height);
      }
    },
    clear() {
      for (const state of held.values()) release(state);
      held.clear();
    },
    free() {
      this.clear();
      gl.deleteTexture(blank);
    },
  };
}
