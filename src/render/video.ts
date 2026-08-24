import type { CircuitVideo } from './circuit.ts';
import type { Program } from './gl.ts';

interface HeldVideo {
  key: string;
  element: HTMLVideoElement;
  texture: WebGLTexture;
  dirty: boolean;
  lastTime: number;
  frameCallback: number | null;
  trouble: string | null;
}

export interface VideoBank {
  bind(
    program: Program,
    videos: readonly CircuitVideo[],
    pace: (video: CircuitVideo) => number,
    scope?: string,
  ): void;
  /** Release every decoder when no drawable flow is active. */
  clear(): void;
  readonly error: string | null;
  free(): void;
}

/** A centred control is normal speed; its useful bounded range is 0.5x–2x. */
export const videoRate = (pace: number): number => 2 ** ((Math.max(0, Math.min(1, pace)) - 0.5) * 2);

export const mediaUrl = (asset: string): string =>
  `/media/${asset
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')}`;

export function createVideoBank(gl: WebGL2RenderingContext): VideoBank {
  const held = new Map<number, HeldVideo>();
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

  const release = (state: HeldVideo) => {
    if (state.frameCallback !== null && state.element.cancelVideoFrameCallback) {
      state.element.cancelVideoFrameCallback(state.frameCallback);
    }
    state.element.pause();
    state.element.removeAttribute('src');
    state.element.load();
    gl.deleteTexture(state.texture);
  };

  const create = (video: CircuitVideo, key: string): HeldVideo => {
    const element = document.createElement('video');
    const texture = gl.createTexture()!;
    const state: HeldVideo = {
      key,
      element,
      texture,
      dirty: true,
      lastTime: -1,
      frameCallback: null,
      trouble: null,
    };
    element.muted = true;
    element.defaultMuted = true;
    element.playsInline = true;
    element.preload = 'auto';
    element.loop = video.mode === 'loop';
    element.src = mediaUrl(video.asset);
    element.addEventListener('loadeddata', () => {
      state.dirty = true;
      state.trouble = null;
    });
    element.addEventListener('error', () => {
      state.trouble = `${video.asset}: ${element.error?.message || 'the browser could not decode this video'}`;
    });

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Uploads are driven by decoded frames, not RAF. The fallback below watches
    // currentTime for browsers without the callback and still avoids duplicate uploads.
    if (element.requestVideoFrameCallback) {
      const next = () => {
        state.frameCallback = element.requestVideoFrameCallback(() => {
          state.dirty = true;
          next();
        });
      };
      next();
    }
    void element.play().catch((err: unknown) => {
      state.trouble = `${video.asset}: ${(err as Error).message}`;
    });
    return state;
  };

  return {
    get error() {
      return [...held.values()].find((state) => state.trouble)?.trouble ?? null;
    },
    bind(program, videos, pace, scope = '') {
      const active = new Set(videos.map((video) => video.index));
      for (const [index, state] of held) {
        if (active.has(index)) continue;
        release(state);
        held.delete(index);
      }

      for (let index = 0; index < 2; index++) {
        const video = videos.find((entry) => entry.index === index);
        const unit = gl.TEXTURE1 + index;
        gl.activeTexture(unit);
        if (!video?.asset) {
          const old = held.get(index);
          if (old) {
            release(old);
            held.delete(index);
          }
          gl.bindTexture(gl.TEXTURE_2D, blank);
          gl.uniform1i(program.uniform(`uVideo${index}`), 1 + index);
          gl.uniform2f(program.uniform(`uVideoSize[${index}]`), 1, 1);
          continue;
        }

        const key = `${scope}:${video.id}:${video.asset}:${video.mode}`;
        let state = held.get(index);
        if (!state || state.key !== key) {
          if (state) release(state);
          state = create(video, key);
          held.set(index, state);
        }
        state.element.playbackRate = videoRate(pace(video));
        if (!state.element.requestVideoFrameCallback && state.element.currentTime !== state.lastTime) {
          state.dirty = true;
        }
        if (state.dirty && state.element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          gl.bindTexture(gl.TEXTURE_2D, state.texture);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, state.element);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          state.dirty = false;
          state.lastTime = state.element.currentTime;
        } else gl.bindTexture(gl.TEXTURE_2D, state.texture);
        gl.uniform1i(program.uniform(`uVideo${index}`), 1 + index);
        gl.uniform2f(
          program.uniform(`uVideoSize[${index}]`),
          state.element.videoWidth || 1,
          state.element.videoHeight || 1,
        );
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
