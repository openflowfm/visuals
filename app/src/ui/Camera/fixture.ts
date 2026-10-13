import { DEFAULT_CAMERA_SETTINGS, type CameraController, type CameraState } from '../model/camera';

/** Deterministic UI fixture. No hardware, permissions, model or native backend. */
export function cameraFixture(deny = false): CameraController {
  let state: CameraState = {
    deviceId: '',
    devices: [{ deviceId: 'brio', label: 'Brio' }],
    deviceMessage: '',
    status: 'off',
    message: 'Camera is off.',
    settings: { ...DEFAULT_CAMERA_SETTINGS },
  };
  const listeners = new Set<() => void>();
  const patch = (next: Partial<CameraState>) => {
    state = { ...state, ...next };
    listeners.forEach((fn) => fn());
  };
  return {
    snapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    watchDevices: () => () => {},
    start: async () => patch(deny ? { status: 'failed', message: 'Camera permission denied.' } : { status: 'active', message: 'Camera is active.' }),
    stop: () => patch({ status: 'off', message: 'Camera is off.' }),
    configure: (next) => patch({ settings: { ...state.settings, ...next } }),
    selectDevice: (deviceId) => patch({ deviceId }),
  };
}
