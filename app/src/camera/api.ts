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
  validateCameraFrame(metadata, rgba.length);
  const json = new TextEncoder().encode(JSON.stringify(metadata));
  if (json.length > 1024 * 1024 || json.length + 8 + rgba.length > 2 * 1024 * 1024) throw new Error('Camera packet exceeds the transport budget.');
  const packet = new Uint8Array(8 + json.length + rgba.length);
  packet.set([67, 65, 77, 49]);
  new DataView(packet.buffer).setUint32(4, json.length, true);
  packet.set(json, 8);
  packet.set(rgba, 8 + json.length);
  return invoke<number>('camera_submit', packet);
}

/** Mirror native limits before allocating a transport packet. Native remains authoritative. */
export function validateCameraFrame(frame: CameraFrame, rgbaLength: number) {
  const bounded = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max;
  const integer = (value: number, min: number, max: number) => Number.isInteger(value) && bounded(value, min, max);
  if (!frame.sessionToken || !integer(frame.sequence, 1, 0xffffffff) || !integer(frame.sourceEpoch, 0, 0xffffffff)) throw new Error('Invalid camera session or sequence.');
  if (!integer(frame.width, 1, 640) || !integer(frame.height, 1, 360) || rgbaLength !== frame.width * frame.height * 4) throw new Error('Invalid camera image dimensions.');
  if (
    ![frame.feedMix, frame.cameraOpacity, frame.outlineOpacity].every((v) => bounded(v, 0, 1)) ||
    !bounded(frame.remainingFreshMs, 0, 250) ||
    !bounded(frame.outlineWidth, 0.25, 4) ||
    !bounded(frame.interpolationMs, 0, 100)
  )
    throw new Error('Invalid camera controls.');
  let points = 0;
  if (frame.paths.length > 512) throw new Error('Too many camera paths.');
  for (const path of frame.paths) {
    points += path.points.length;
    if (typeof path.closed !== 'boolean' || points > 8192) throw new Error('Invalid camera path budget.');
    for (const point of path.points)
      if (!bounded(point.x, 0, frame.width) || !bounded(point.y, 0, frame.height) || point.color.length !== 3 || !point.color.every((v) => bounded(v, 0, 1))) throw new Error('Invalid camera vertex.');
  }
}
