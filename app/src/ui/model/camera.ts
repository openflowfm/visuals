export interface CameraSettings {
  cameraOpacity: number;
  outlineOpacity: number;
  feedMix: number;
  steadiness: number;
  smoothing: number;
  detail: number;
  threshold: number;
  color: number;
  mirror: boolean;
  personOnly: boolean;
}
export const DEFAULT_CAMERA_SETTINGS: CameraSettings = {
  cameraOpacity: 0,
  outlineOpacity: 0.65,
  feedMix: 0.3,
  steadiness: 85,
  smoothing: 65,
  detail: 45,
  threshold: 12,
  color: 85,
  mirror: true,
  personOnly: true,
};
export interface CameraDevice {
  deviceId: string;
  label: string;
}
export interface CameraState {
  deviceId: string;
  devices: CameraDevice[];
  deviceMessage: string;
  status: 'off' | 'starting' | 'active' | 'failed';
  message: string;
  settings: CameraSettings;
}
/** Host-owned capture adapter: UI never imports MediaPipe or opens hardware itself. */
export interface CameraController {
  /** License accompanying the host's local segmentation model. */
  modelLicenseUrl?: string;
  snapshot(): CameraState;
  subscribe(listener: () => void): () => void;
  watchDevices(): () => void;
  start(): Promise<void>;
  stop(): void;
  configure(settings: Partial<CameraSettings>): void;
  selectDevice(deviceId: string): void;
}
