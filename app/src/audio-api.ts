import { invoke } from '@tauri-apps/api/core';
import type { Heard, SourceId } from './api.ts';

export type AudioLane = 'main' | 'mic';
/** Actual and selected identities differ while the main source uses a fallback. */
export interface AudioLaneStatus extends Heard {
  source: SourceId | null;
  selected: SourceId | null;
  enabled: boolean;
  unavailable: boolean;
}
export interface AudioStatus {
  main: AudioLaneStatus;
  mic: AudioLaneStatus;
}
export const audioStatus = () => invoke<AudioStatus>('audio_status');
/** null explicitly turns this lane off. Mic accepts device sources only. Channels count from one. */
export const chooseAudioLane = (lane: AudioLane, source: SourceId | null, left = 1, right = 2) => invoke<AudioStatus>('choose_audio_lane', { lane, source, left, right });
