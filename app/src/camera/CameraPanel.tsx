import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { Slider } from '@openflow/widgets/controls/Slider.tsx';
import { range } from '../controls';
import { Sheet } from '../Settings';
import { SwitchRow } from '../Switch';
import { openSheet } from '../views';
import { CameraController, DEFAULT_CAMERA_SETTINGS, type CameraSettings } from './controller';
import { createCameraController } from './capture';
import './camera.css';
const CameraContext = createContext<CameraController | null>(null);
const OFF = { status: 'off' as const, message: 'Camera is off.', settings: DEFAULT_CAMERA_SETTINGS };
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
    const stop = () => controller.stop();
    window.addEventListener('pagehide', stop);
    return () => {
      window.removeEventListener('pagehide', stop);
      controller.stop();
    };
  }, [controller]);
  return <CameraContext.Provider value={controller}>{children}</CameraContext.Provider>;
}
export function CameraAction({ className = '' }: { className?: string }) {
  const { status } = useCamera();
  const on = status === 'active' || status === 'starting';
  return (
    <Button
      tone="quiet"
      className={`camera-action ${on ? 'camera-active' : ''} ${className}`}
      label={on ? 'Camera on: open controls' : 'Camera controls'}
      title="Open camera controls"
      onPress={() => openSheet('camera')}
    >
      <span aria-hidden="true">◉</span> Camera{on ? ' on' : ''}
    </Button>
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
  const { controller, status, message, settings } = useCamera();
  if (!open) return null;
  const on = status === 'active' || status === 'starting';
  return (
    <Sheet title="Camera" className="settings camera-panel" onClose={onClose}>
      <div className="wdg camera-body">
        <p>Feed your edges into the playing preset. Your current music input and presets keep playing.</p>
        <Button onPress={() => (on ? controller?.stop() : void controller?.start())} disabled={!controller}>
          {on ? 'Stop camera' : 'Enable camera'}
        </Button>
        <p role={status === 'failed' ? 'alert' : 'status'} className="camera-status">
          {message}
        </p>
        <p className="camera-note">Video only, processed locally. Closing this panel keeps the camera on. Stop camera releases it.</p>
        <SwitchRow name="Person only" on={settings.personOnly} onChange={(personOnly) => controller?.configure({ personOnly })} title="Remove the room; waits for a fresh local person mask" />
        <SwitchRow name="Mirror camera" on={settings.mirror} onChange={(mirror) => controller?.configure({ mirror })} />
        {SLIDERS.map(({ key, label, hint, normalized, max = 100 }) => {
          const value = Math.round(settings[key] * (normalized ? 100 : 1));
          return (
            <div className="camera-control" key={key}>
              <span>{label}</span>
              <Slider
                param={range(label, 0, max, DEFAULT_CAMERA_SETTINGS[key] * (normalized ? 100 : 1))}
                value={value}
                onChange={(next) => controller?.configure({ [key]: next / (normalized ? 100 : 1) })}
                display={`${value}${max === 100 ? '%' : ''}`}
                orientation="horizontal"
                layout="inside"
                title={hint}
              />
              <small>{hint}</small>
            </div>
          );
        })}
        <Button tone="quiet" onPress={() => controller?.configure({ outlineOpacity: 1 })}>
          Bring my outline back
        </Button>
      </div>
    </Sheet>
  );
}
