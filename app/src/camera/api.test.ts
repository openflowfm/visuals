import { expect, test, vi } from 'vitest';
const invoke = vi.hoisted(() => vi.fn(async () => 1));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
import { cameraSubmit, validateCameraFrame, type CameraFrame } from './api';
const frame: CameraFrame = {
  sessionToken: 'test',
  sequence: 1,
  sourceEpoch: 0,
  width: 1,
  height: 1,
  remainingFreshMs: 180,
  feedMix: 0.3,
  cameraOpacity: 0,
  outlineOpacity: 0.65,
  outlineWidth: 0.85,
  interpolationMs: 65,
  paths: [],
};
test('CAM1 carries atomic metadata followed by exact RGBA bytes', async () => {
  await cameraSubmit(frame, new Uint8Array([1, 2, 3, 128]));
  const [command, value] = invoke.mock.calls[0] as unknown as [string, Uint8Array];
  expect(command).toBe('camera_submit');
  expect(new TextDecoder().decode(value.subarray(0, 4))).toBe('CAM1');
  const length = new DataView(value.buffer).getUint32(4, true);
  expect(JSON.parse(new TextDecoder().decode(value.subarray(8, 8 + length)))).toEqual(frame);
  expect([...value.subarray(8 + length)]).toEqual([1, 2, 3, 128]);
});
test('rejects malformed dimensions, finite/range errors and excessive geometry', () => {
  for (const change of [
    { width: 641 },
    { sequence: 0 },
    { cameraOpacity: NaN },
    { remainingFreshMs: 251 },
    { outlineWidth: 0 },
    { paths: Array(513).fill({ closed: false, points: [] }) },
    { paths: [{ closed: false, points: Array(8193).fill({ x: 0, y: 0, color: [1, 1, 1] }) }] },
  ])
    expect(() => validateCameraFrame({ ...frame, ...change }, 4)).toThrow();
  expect(() => validateCameraFrame(frame, 3)).toThrow();
  expect(() => validateCameraFrame({ ...frame, paths: [{ closed: false, points: [{ x: 2, y: 0, color: [1, 0, 0] }] }] }, 4)).toThrow();
});
