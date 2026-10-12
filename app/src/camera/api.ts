import { invoke } from '@tauri-apps/api/core';

export interface CameraPoint {
  x: number;
  y: number;
  color: [number, number, number];
}
export interface CameraPath {
  closed: boolean;
  points: CameraPoint[];
}
/** CAM1 metadata; all opacity/mix values are normalized, not percentages. */
export interface CameraFrame {
  sessionToken: string;
  sequence: number;
  sourceEpoch: number;
  width: number;
  height: number;
  remainingFreshMs: number;
  feedMix: number;
  cameraOpacity: number;
  outlineOpacity: number;
  outlineWidth: number;
  interpolationMs: number;
  paths: CameraPath[];
}
export const cameraBegin = () => invoke<string>('camera_begin');
export const cameraEnd = (sessionToken: string) => invoke<void>('camera_end', { sessionToken });

/** Binary transport prevents JSON expansion of the RGBA image. One submission in flight. */
export function cameraSubmit(metadata: CameraFrame, rgba: Uint8Array | Uint8ClampedArray): Promise<number> {
  const json = new TextEncoder().encode(JSON.stringify(metadata));
  const packet = new Uint8Array(8 + json.length + rgba.length);
  packet.set([67, 65, 77, 49]);
  new DataView(packet.buffer).setUint32(4, json.length, true);
  packet.set(json, 8);
  packet.set(rgba, 8 + json.length);
  return invoke<number>('camera_submit', packet);
}
