import type { AudioLevels } from 'butterchurn';
import type { Show } from '../../protocol.ts';

/**
 * What a MilkDrop preset hears.
 *
 * MilkDrop reads a waveform: 1024 samples per channel, from which it takes an
 * FFT for `bass`, `mid` and `treb` and draws its waves. Live's bridge sends
 * meters, not audio, so there are two sources:
 *
 * - **An audio input** — an interface, or BlackHole carrying the set's output.
 *   Real audio is what presets were written against, and is what makes a wave
 *   look like the song.
 * - **The set itself**, when no input is chosen. A waveform is synthesised from
 *   the master meter and the beat: a low thump on every beat, scaled by how
 *   loud the set is, with mids and highs following the tracks. It is not the
 *   song, but it is on the beat and it is never silence while the set plays.
 *
 * The choice is per machine and shared by every window on it, so it lives in
 * `localStorage`; the wall follows the console through the `storage` event.
 */
export interface MilkAudio {
  levels(show: Show, beat: number, seconds: number): AudioLevels;
  readonly sampleRate: number;
  /** A sentence for the panel: which source, and whether it is working. */
  readonly status: string;
}

export const AUDIO_KEY = 'visuals.milk.input';
/** The channel holding the set's synthesised signal rather than a device. */
export const FROM_SET = '';

const SIZE = 1024;
const SYNTH_RATE = 44100;

export function chosenInput(): string {
  try {
    return localStorage.getItem(AUDIO_KEY) ?? FROM_SET;
  } catch {
    return FROM_SET;
  }
}

export function chooseInput(deviceId: string): void {
  try {
    localStorage.setItem(AUDIO_KEY, deviceId);
  } catch {
    // A private window: the choice lasts as long as the page.
  }
  window.dispatchEvent(new CustomEvent(AUDIO_KEY));
}

/** Audio inputs by id and label. Labels are blank until the first permission grant. */
export async function listInputs(): Promise<Array<{ id: string; label: string }>> {
  const devices = await navigator.mediaDevices?.enumerateDevices?.();
  return (devices ?? [])
    .filter((device) => device.kind === 'audioinput' && device.deviceId)
    .map((device, i) => ({ id: device.deviceId, label: device.label || `input ${i + 1}` }));
}

let shared: MilkAudio | null = null;

/**
 * One per window. A compositor is rebuilt on a lost context or a remount, and
 * an audio input opened per compositor would be a second stream on the same
 * interface every time.
 */
export function milkAudio(): MilkAudio {
  return (shared ??= createMilkAudio());
}

function createMilkAudio(): MilkAudio {
  const levels: AudioLevels = {
    timeByteArray: new Uint8Array(SIZE).fill(128),
    timeByteArrayL: new Uint8Array(SIZE).fill(128),
    timeByteArrayR: new Uint8Array(SIZE).fill(128),
  };
  let context: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let left: AnalyserNode | null = null;
  let right: AnalyserNode | null = null;
  let mono = false;
  let status = 'listening to the set';
  let opened = '';
  let generation = 0;

  const close = () => {
    stream?.getTracks().forEach((track) => track.stop());
    void context?.close().catch(() => {});
    stream = null;
    context = null;
    left = right = null;
  };

  const open = async () => {
    const id = chosenInput();
    if (id === opened) return;
    opened = id;
    const mine = ++generation;
    close();
    if (id === FROM_SET) {
      status = 'listening to the set';
      return;
    }
    status = 'opening the audio input…';
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: id },
          channelCount: 2,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      if (mine !== generation) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      const ctx = new AudioContext();
      // Nothing is played, so no autoplay rule should hold it — but a context
      // that starts suspended reads silence, and asking costs nothing.
      void ctx.resume().catch(() => {});
      const source = ctx.createMediaStreamSource(media);
      const split = ctx.createChannelSplitter(2);
      const make = () => {
        const analyser = ctx.createAnalyser();
        analyser.fftSize = SIZE;
        analyser.smoothingTimeConstant = 0;
        return analyser;
      };
      left = make();
      right = make();
      source.connect(split);
      split.connect(left, 0);
      split.connect(right, 1);
      mono = (media.getAudioTracks()[0]?.getSettings().channelCount ?? 2) < 2;
      stream = media;
      context = ctx;
      const label = media.getAudioTracks()[0]?.label || 'audio input';
      status = `listening to ${label}`;
    } catch (error) {
      if (mine !== generation) return;
      status = `audio input unavailable — ${(error as Error).message}; following the set instead`;
    }
  };

  void open();
  const reopen = () => void open();
  window.addEventListener(AUDIO_KEY, reopen);
  window.addEventListener('storage', (event) => {
    if (event.key === AUDIO_KEY) reopen();
  });

  /** A beat-locked signal from the meters, for when there is no audio. */
  const synthesise = (show: Show, beat: number, seconds: number) => {
    const loud = Math.min(1, show.master * 1.4);
    const since = beat - Math.floor(beat);
    const kick = show.playing ? Math.exp(-since * 7) : 0;
    let busy = 0;
    for (const track of show.tracks) busy = Math.max(busy, track.level * track.opacity);
    const t0 = seconds;
    for (let i = 0; i < SIZE; i++) {
      const t = t0 + i / SYNTH_RATE;
      const low = Math.sin(2 * Math.PI * 55 * t) * kick;
      const mid = Math.sin(2 * Math.PI * 440 * t + Math.sin(t * 3)) * busy * 0.5;
      const high = (Math.random() * 2 - 1) * busy * 0.25;
      const v = Math.max(-1, Math.min(1, (low * 0.8 + mid + high) * loud));
      const byte = Math.round(128 + v * 127);
      levels.timeByteArray[i] = byte;
      levels.timeByteArrayL[i] = byte;
      levels.timeByteArrayR[i] = byte;
    }
  };

  return {
    get sampleRate() {
      return context?.sampleRate ?? SYNTH_RATE;
    },
    get status() {
      return status;
    },
    levels(show, beat, seconds) {
      if (left && right) {
        left.getByteTimeDomainData(levels.timeByteArrayL);
        if (mono) levels.timeByteArrayR.set(levels.timeByteArrayL);
        else right.getByteTimeDomainData(levels.timeByteArrayR);
        for (let i = 0; i < SIZE; i++) {
          levels.timeByteArray[i] = (levels.timeByteArrayL[i] + levels.timeByteArrayR[i]) >> 1;
        }
      } else synthesise(show, beat, seconds);
      return levels;
    },
  };
}
