import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { ActionButton as Button, ActionButtonFace as ButtonFace } from '@satoramoto/zen';
import { Switch } from '@satoramoto/zen';
import { Group } from '@satoramoto/zen';
import { Text } from '@satoramoto/zen';
import { Select } from '@satoramoto/zen';
import { Slider } from '@satoramoto/zen';
import { range } from '../model/controls';
import { Icon } from '../Icon/Icon';
import { Sheet } from '../Settings/Settings';
import { openSheet } from '../Views/Views';
import { type CameraController, DEFAULT_CAMERA_SETTINGS, type CameraSettings } from '../model/camera';
import './Camera.css';
const CameraContext = createContext<CameraController | null>(null);
const OFF = {
  deviceId: '',
  devices: [],
  deviceMessage: '',
  status: 'off' as const,
  message: 'Camera is off.',
  settings: DEFAULT_CAMERA_SETTINGS,
};
const noSubscribe = () => () => {};
const offSnapshot = () => OFF;
function useCamera() {
  const controller = useContext(CameraContext);
  const state = useSyncExternalStore(controller?.subscribe ?? noSubscribe, controller?.snapshot ?? offSnapshot);
  return { controller, ...state };
}
/** Mounted once by App. Closing sheets, changing views and presets keep capture alive. */
export function CameraProvider({ children, controller }: { children: ReactNode; controller?: CameraController }) {
  useEffect(() => {
    if (!controller) return;
    const unwatch = controller.watchDevices();
    const stop = () => controller.stop();
    window.addEventListener('pagehide', stop);
    return () => {
      window.removeEventListener('pagehide', stop);
      unwatch();
      controller.stop();
    };
  }, [controller]);
  return <CameraContext.Provider value={controller ?? null}>{children}</CameraContext.Provider>;
}
export function CameraAction({ className = '' }: { className?: string }) {
  const { status } = useCamera();
  const on = status === 'active' || status === 'starting';
  return (
    <ButtonFace
      tone="quiet"
      className={`vs-camera-action ${on ? 'vs-camera-active' : ''} ${className}`}
      aria-label={on ? 'Camera on: open controls' : 'Camera controls'}
      aria-haspopup="dialog"
      title={on ? 'Camera on: open controls' : 'Open camera controls'}
      onClick={() => openSheet('camera')}
    >
      <Icon name="camera" />
    </ButtonFace>
  );
}
const SLIDERS: {
  key: keyof Pick<CameraSettings, 'cameraOpacity' | 'outlineOpacity' | 'feedMix' | 'steadiness' | 'smoothing' | 'color' | 'threshold'>;
  label: string;
  hint: string;
  normalized?: boolean;
  max?: number;
}[] = [
  {
    key: 'cameraOpacity',
    label: 'Camera opacity',
    hint: 'Original camera image above the effects',
    normalized: true,
  },
  {
    key: 'outlineOpacity',
    label: 'Outline opacity',
    hint: 'Recognizable edges above the effects',
    normalized: true,
  },
  {
    key: 'feedMix',
    label: 'Edge feed',
    hint: 'Edges entering the preset’s trails',
    normalized: true,
  },
  {
    key: 'steadiness',
    label: 'Edge steadiness',
    hint: 'More stability adds some motion delay',
  },
  {
    key: 'smoothing',
    label: 'Curve smoothing',
    hint: 'Round the contours into flowing strokes',
  },
  {
    key: 'color',
    label: 'Edge color',
    hint: 'Silver contours to spectral color',
  },
  {
    key: 'threshold',
    label: 'Noise cutoff',
    hint: 'Raise to remove faint texture',
    max: 60,
  },
];
export function CameraPanel({ open, onClose }: { open: boolean; onClose(): void }) {
  const { controller, status, message, settings, deviceId, devices, deviceMessage } = useCamera();
  if (!open) return null;
  const on = status === 'active' || status === 'starting';
  const choices = [
    { deviceId: '', label: 'System default camera' },
    ...devices.map((device, index) => ({
      ...device,
      label: device.label || `Camera ${index + 1}`,
    })),
  ];
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
    <Sheet title="Camera" className="vs-settings vs-camera-panel" onClose={onClose}>
      <div className="vs-camera-body">
        <div className="vs-camera-power">
          <CameraSwitch name="Enable camera" on={on} onChange={(enabled) => (enabled ? void controller?.start() : controller?.stop())} disabled={!controller} />
          <Text as="p" size="caption" ariaRole={status === 'failed' ? 'alert' : 'status'} className="vs-camera-status">
            {message}
          </Text>
        </div>
        <Group direction="column" className="vs-camera-group" name="Source">
          <Select
            label="Camera device"
            items={choices.map((device) => device.label)}
            index={choices.findIndex((device) => device.deviceId === deviceId)}
            onChange={(index) => controller?.selectDevice(choices[index].deviceId)}
            disabled={!controller}
          />
          {deviceMessage && (
            <Text as="p" size="caption" className="vs-camera-note">
              {deviceMessage}
            </Text>
          )}
          <div className="vs-camera-switches">
            <CameraSwitch name="Person only" on={settings.personOnly} onChange={(personOnly) => controller?.configure({ personOnly })} title="Remove the room; waits for a fresh local person mask" />
            <CameraSwitch name="Mirror camera" on={settings.mirror} onChange={(mirror) => controller?.configure({ mirror })} />
          </div>
          {sliders(['threshold'])}
        </Group>
        <Group direction="column" className="vs-camera-group" name="Appearance">
          {sliders(['cameraOpacity', 'outlineOpacity', 'color'])}
          <Button tone="quiet" onPress={() => controller?.configure({ outlineOpacity: 1 })}>
            Bring my outline back
          </Button>
        </Group>
        <Group direction="column" className="vs-camera-group" name="Motion">
          {sliders(['feedMix', 'steadiness', 'smoothing'])}
        </Group>
        <Text as="footer" size="caption" className="vs-camera-note">
          <p>Video stays on this device. Closing this panel keeps it running. Your music input stays unchanged.</p>
          <a href={controller?.modelLicenseUrl ?? 'https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE'} target="_blank" rel="noreferrer">
            Local person model · Apache 2.0
          </a>
        </Text>
      </div>
    </Sheet>
  );
}

function CameraSwitch({ name, on, onChange, disabled, title }: { name: string; on: boolean; onChange(value: boolean): void; disabled?: boolean; title?: string }) {
  return (
    <Switch checked={on} onChange={onChange} disabled={disabled} title={title}>
      {name}
    </Switch>
  );
}
