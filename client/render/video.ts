import { portId, type CircuitVideo } from './circuit.ts';
import type { NumberSample } from './evaluateNumber.ts';
import type { Program } from './gl.ts';
import { mediaUrl } from './media.ts';

interface HeldVideo {
  key: string;
  element: HTMLVideoElement;
  texture: WebGLTexture;
  dirty: boolean;
  lastTime: number;
  frameCallback: number | null;
  trouble: string | null;
}

/**
 * What the graph is telling one decoder to do this frame.
 *
 * All three are CPU-evaluated out of the same number graph the faceplate reads,
 * because none of them is a thing a fragment shader can do: a shader can decide
 * what a frame looks like and only a decoder can decide WHICH frame it is.
 */
export interface VideoControl {
  /** Playback speed, as the centred 0–1 control `videoRate` maps. */
  pace: number;
  /** Hold the frame that is up, and let it run again when this falls. */
  freeze: boolean;
  /** Where in the clip to sit, 0–1, when the node is scrubbing. Null when it plays. */
  position: number | null;
}

export interface VideoBank {
  bind(
    program: Program,
    videos: readonly CircuitVideo[],
    control: (video: CircuitVideo) => VideoControl,
    scope?: string,
  ): void;
  /** Release every decoder when no drawable flow is active. */
  clear(): void;
  readonly error: string | null;
  free(): void;
}

/**
 * What one video node is being told this frame, read off the CPU number graph.
 *
 * `position` is null unless the node is scrubbing, and that is the whole of the
 * decision: a clip is either played — at a speed, possibly frozen — or
 * placed, and there is no coherent third thing where it is both carried along by
 * its own clock and put where a number says. Which is why the two lists of
 * inlets cannot both be mounted, and why this reads the mode rather than
 * guessing from whichever inlet happens to have a cord on it.
 */
export const videoControl = (sample: NumberSample, video: CircuitVideo): VideoControl =>
  video.mode === 'scrub'
    ? { pace: 0.5, freeze: false, position: sample.inlet(portId(video.id, 'position')) ?? 0 }
    : {
        pace: sample.inlet(portId(video.id, 'pace')) ?? 0.5,
        freeze: (sample.inlet(portId(video.id, 'freeze')) ?? 0) > 0.5,
        position: null,
      };

/**
 * How far off the frame that is up an ask has to be before it is worth a seek.
 *
 * A seek is a decode, and a scrub whose number has not moved would ask for the
 * frame already on screen at the display's rate. One thirtieth of a second is
 * about a frame of ordinary footage: below it there is nothing new to show.
 */
const SEEK_EPSILON = 1 / 30;

/** A centred control is normal speed; its useful bounded range is 0.5x–2x. */
export const videoRate = (pace: number): number => 2 ** ((Math.max(0, Math.min(1, pace)) - 0.5) * 2);

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
    // A scrubbed clip is never playing, so it is never started. Starting one and
    // pausing it on the first bind would decode a frame nobody asked for and
    // show it for exactly one frame, which reads as a flash on a cut.
    if (video.mode !== 'scrub') play(state);
    return state;
  };

  const play = (state: HeldVideo) => {
    void state.element.play().catch((err: unknown) => {
      state.trouble = `${state.key}: ${(err as Error).message}`;
    });
  };

  /**
   * The decoder half of a video node, which is everything a shader cannot say.
   *
   * **Scrubbing pauses and seeks**, rather than setting a rate: a position is a
   * place, and the only way to be somewhere in a clip is to go there. It is
   * guarded by `SEEK_EPSILON` because a seek is a decode.
   *
   * **Freezing pauses without seeking**, which is why it is a different inlet
   * rather than a pace of zero. `playbackRate = 0` is not a legal rate in every
   * browser, and the ones that take it disagree about whether the decoder is
   * still holding the frame or has released it.
   */
  const drive = (state: HeldVideo, control: VideoControl) => {
    const element = state.element;
    if (control.position !== null) {
      if (!element.paused) element.pause();
      const span = element.duration;
      if (Number.isFinite(span) && span > 0) {
        const want = Math.max(0, Math.min(1, control.position)) * span;
        if (Math.abs(want - element.currentTime) > SEEK_EPSILON) element.currentTime = want;
      }
      return;
    }
    element.playbackRate = videoRate(control.pace);
    if (control.freeze) {
      if (!element.paused) element.pause();
    } else if (element.paused && !element.ended) play(state);
  };

  return {
    get error() {
      return [...held.values()].find((state) => state.trouble)?.trouble ?? null;
    },
    bind(program, videos, control, scope = '') {
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
        drive(state, control(video));
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
