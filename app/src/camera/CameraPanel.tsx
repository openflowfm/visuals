import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { Select } from '@openflow/widgets/controls/Select.tsx';
import { Slider } from '@openflow/widgets/controls/Slider.tsx';
import { range } from '../controls';
import { Icon } from '../layout/icons';
import { Sheet } from '../Settings';
import { SwitchRow } from '../Switch';
import { openSheet } from '../views';
import { CameraController, DEFAULT_CAMERA_SETTINGS, type CameraSettings } from './controller';
import { createCameraController } from './capture';
import modelLicense from './person-assets/LICENSE.mediapipe?url';
import './camera.css';
const CameraContext = createContext<CameraController | null>(null);
const OFF = { deviceId: '', devices: [], deviceMessage: '', status: 'off' as const, message: 'Camera is off.', settings: DEFAULT_CAMERA_SETTINGS };
const noSubscribe = () => () => {};
const offSnapshot = () => OFF;
function useCamera() {
  const controller = useContext(CameraContext);
  const state = useSyncExternalStore(controller?.subscribe ?? noSubscribe, controller?.snapshot ?? offSnapshot);
  return { controller, ...state };
}
/** Mounted once by App. Closing sheets, changing views and presets keep capture alive. */
export function CameraProvider({ children, controller: provided }: { children: ReactNode; controller?: CameraController }) {
  const [controller] = useState(() => provided ?? createCameraController());
  useEffect(() => {
    const unwatch = controller.watchDevices();
    const stop = () => controller.stop();
    window.addEventListener('pagehide', stop);
    return () => {
      window.removeEventListener('pagehide', stop);
      unwatch();
      controller.stop();
    };
  }, [controller]);
  return <CameraContext.Provider value={controller}>{children}</CameraContext.Provider>;
}
export function CameraAction({ className = '' }: { className?: string }) {
  const { status } = useCamera();
  const on = status === 'active' || status === 'starting';
  return (
    <button
      type="button"
      className={`camera-action ${on ? 'camera-active' : ''} ${className}`}
      aria-label={on ? 'Camera on: open controls' : 'Camera controls'}
      aria-haspopup="dialog"
      title={on ? 'Camera on: open controls' : 'Open camera controls'}
      onClick={() => openSheet('camera')}
    >
      <Icon name="camera" />
    </button>
  );
}
const SLIDERS: {
  key: keyof Pick<CameraSettings, 'cameraOpacity' | 'outlineOpacity' | 'feedMix' | 'steadiness' | 'smoothing' | 'color' | 'threshold'>;
  label: string;
  hint: string;
  normalized?: boolean;
  max?: number;
}[] = [
  { key: 'cameraOpacity', label: 'Camera opacity', hint: 'Original camera image above the effects', normalized: true },
  { key: 'outlineOpacity', label: 'Outline opacity', hint: 'Recognizable edges above the effects', normalized: true },
  { key: 'feedMix', label: 'Edge feed', hint: 'Edges entering the preset’s trails', normalized: true },
  { key: 'steadiness', label: 'Edge steadiness', hint: 'More stability adds some motion delay' },
  { key: 'smoothing', label: 'Curve smoothing', hint: 'Round the contours into flowing strokes' },
  { key: 'color', label: 'Edge color', hint: 'Silver contours to spectral color' },
  { key: 'threshold', label: 'Noise cutoff', hint: 'Raise to remove faint texture', max: 60 },
];
export function CameraPanel({ open, onClose }: { open: boolean; onClose(): void }) {
  const { controller, status, message, settings, deviceId, devices, deviceMessage } = useCamera();
  if (!open) return null;
  const on = status === 'active' || status === 'starting';
  const choices = [{ deviceId: '', label: 'System default camera' }, ...devices.map((device, index) => ({ ...device, label: device.label || `Camera ${index + 1}` }))];
  if (deviceId && !choices.some((device) => device.deviceId === deviceId)) choices.push({ deviceId, label: 'Selected camera · unavailable' });
  const sliders = (keys: (typeof SLIDERS)[number]['key'][]) =>
    keys.map((key) => {
      const { label, hint, normalized, max = 100 } = SLIDERS.find((slider) => slider.key === key)!;
      const value = Math.round(settings[key] * (normalized ? 100 : 1));
      return (
        <Slider
          key={key}
          param={range(label, 0, max, DEFAULT_CAMERA_SETTINGS[key] * (normalized ? 100 : 1))}
          value={value}
          onChange={(next) => controller?.configure({ [key]: next / (normalized ? 100 : 1) })}
          display={`${value}${max === 100 ? '%' : ''}`}
          orientation="horizontal"
          length="auto"
          layout="stacked"
          fill
          title={hint}
        />
      );
    });
  return (
    <Sheet title="Camera" className="settings camera-panel" onClose={onClose}>
      <div className="wdg camera-body" data-appearance="dark">
        <div className="camera-power">
          <SwitchRow name="Enable camera" on={on} onChange={(enabled) => (enabled ? void controller?.start() : controller?.stop())} disabled={!controller} />
          <p role={status === 'failed' ? 'alert' : 'status'} className="camera-status">
            {message}
          </p>
        </div>
        <section className="settings-section camera-group" aria-label="Source">
          <h3>Source</h3>
          <Select
            label="Camera device"
            items={choices.map((device) => device.label)}
            index={choices.findIndex((device) => device.deviceId === deviceId)}
            onChange={(index) => controller?.selectDevice(choices[index].deviceId)}
            disabled={!controller}
          />
          {deviceMessage && <p className="camera-note">{deviceMessage}</p>}
          <div className="camera-switches">
            <SwitchRow name="Person only" on={settings.personOnly} onChange={(personOnly) => controller?.configure({ personOnly })} title="Remove the room; waits for a fresh local person mask" />
            <SwitchRow name="Mirror camera" on={settings.mirror} onChange={(mirror) => controller?.configure({ mirror })} />
          </div>
          {sliders(['threshold'])}
        </section>
        <section className="settings-section camera-group" aria-label="Appearance">
          <h3>Appearance</h3>
          {sliders(['cameraOpacity', 'outlineOpacity', 'color'])}
          <Button tone="quiet" onPress={() => controller?.configure({ outlineOpacity: 1 })}>
            Bring my outline back
          </Button>
        </section>
        <section className="settings-section camera-group" aria-label="Motion">
          <h3>Motion</h3>
          {sliders(['feedMix', 'steadiness', 'smoothing'])}
        </section>
        <footer className="camera-note">
          <p>Video stays on this device. Closing this panel keeps it running. Your music input stays unchanged.</p>
          <a href={modelLicense} target="_blank" rel="noreferrer">
            Local person model · Apache 2.0
          </a>
        </footer>
      </div>
    </Sheet>
  );
}
