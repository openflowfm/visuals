import { CameraPanel, CameraProvider } from '../Camera/Camera';
import type { CameraController } from '../model/camera';
import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { Layer } from '@satoramoto/zen';
import { Text } from '@satoramoto/zen';
import { ThemeScope, resolveTheme, type ModeChoice, type ThemeChoice } from '@satoramoto/zen';
import { HOME as HOME_VIEW, ViewList, useSheet, viewsFor, type View } from '../Views/Views';
import { Home } from '../Home/Home';
import { Settings } from '../Settings/Settings';
import { MoreEffects } from '../MoreEffects/MoreEffects';
import { CrashPrompt } from '../CrashPrompt/CrashPrompt';
import { Live } from '../Live/Live';
import { Update } from '../Update/Update';
import { FlashWarning, Onboarding, useFlashWarning, useWelcome } from '../Onboarding/Onboarding';
import { useAccessibility } from '../model/access';
import { startChrome } from '../model/chrome';
import { currentBridge, defaultBridge } from '../model/ipc';
import * as output from '../model/output';
import '../visuals.css';
import './App.css';

/** The views a lab build's headers offer. */
const LAB_VIEWS = viewsFor(true);

/** The window whose title bar is the page's own top bar (`chrome.ts`); Tauri's label for it. */
export const MAIN_WINDOW = 'main';

/** The view showing, the preset it starts on, whether live plays in the window, and whether the home opens on its library pane. */
interface Mode {
  view: View;
  preset: string | null;
  windowed?: boolean;
  library?: boolean;
}

/**
 * The original's `App`: the home (playlists and the library, with the preview of
 * what plays) and live mode (performing controls, the output full screen on a
 * display); Settings and More effects open over either (`openSheet`). The app's
 * `live_start` and `start_preset` say which view and preset it starts on. With the
 * flashing warning owed, live waits for its "I understand". Given a `lab` editor (a lab
 * build), the `editor` view shows it and the app starts there; without one, the home.
 */
function Shell({ lab }: { lab?: LabEditor }) {
  const HOME: View = lab ? 'editor' : HOME_VIEW;
  const [mode, setMode] = useState<Mode | null>(null);
  const welcome = useWelcome();
  const warning = useFlashWarning(welcome.shown === false);
  useEffect(() => {
    Promise.all([output.startPreset(), output.liveStart()]).then(
      ([preset, view]) => setMode({ ...output.startIn<View>(view, HOME), preset }),
      () => setMode({ view: HOME, preset: null }),
    );
  }, []);
  const onMode = useCallback((view: View, preset: string | null) => setMode({ view, preset }), []);
  const { sheet, close } = useSheet(welcome.shown === false);
  useAccessibility();
  if (!mode || welcome.shown === null) return null;
  if (welcome.shown)
    return (
      <Onboarding
        onDone={() => {
          welcome.close();
          // Finished or skipped, the flow ends on the home.
          setMode({ view: HOME, preset: null });
        }}
      />
    );
  // Nothing plays live behind an owed warning: live starts once it is understood.
  return (
    <FlashWarning warning={warning} live={mode.view === 'live'}>
      <Page mode={mode} onMode={onMode} lab={lab} />
      <Settings open={sheet === 'settings'} onClose={close} />
      <CameraPanel open={sheet === 'camera'} onClose={close} />
      <MoreEffects open={sheet === 'effects'} onClose={close} />
      <CrashPrompt />
    </FlashWarning>
  );
}

/** The view showing, under the sheets `Shell` lays over every view. */
function Page({ mode, onMode, lab: Lab }: { mode: Mode; onMode(view: View, preset: string | null): void; lab?: LabEditor }) {
  if (mode.view === 'editor' && Lab) return <Lab start={mode.preset} onMode={onMode} />;
  if (mode.view === 'live') return <Live start={mode.preset} onMode={onMode} windowed={mode.windowed} />;
  return <Home start={mode.preset} onMode={onMode} library={mode.library} />;
}

/** The lab's editor (`@satoramoto/zen/visuals/lab`'s `VisualsEditor`), as `VisualsApp` mounts it for the `editor` view. */
export type LabEditor = ComponentType<{ start: string | null; onMode(view: View, path: string | null): void }>;

export interface VisualsAppProps {
  /**
   * A lab build's editor (`VisualsEditor` from `@satoramoto/zen/visuals/lab`, its own entry so
   * none of it reaches an app built without it). Given, every header's switch offers `editor`
   * and the app starts in it.
   */
  lab?: LabEditor;
  /** Host-owned persistent camera runtime; omitted hosts show disabled capture. */
  cameraController?: CameraController;
  /** The theme pack and any facet swapped in; the `visuals` pack by default. */
  theme?: ThemeChoice;
  /** Light, dark, or the system's; the system's by default. */
  mode?: ModeChoice;
  /**
   * Default true: the app draws its own window, a theme scope, the `ground` layer and `.vs-root`.
   * False when the host already has (Storybook's `withVisualsFrame` and `withLibraryTheme`).
   */
  frame?: boolean;
  /**
   * Default true: in the bridge's main window (`label === 'main'`), mark the page for the overlay
   * title bar (`startChrome`; it does anything only on a Mac). False to leave the page unmarked.
   */
  chrome?: boolean;
}

/**
 * visual[flow]'s whole UI on zen: the original's `App` and `Update`, with main.tsx's
 * setup minus Tauri. The host installs the bridge first (`setBridge`, over Tauri in the
 * app) and renders this in its own root (StrictMode, createRoot are the host's). With
 * no bridge installed it says so, as the original's page outside the app did.
 */
export function VisualsApp({ theme, mode = 'system', frame = true, chrome = true, lab, cameraController }: VisualsAppProps) {
  const inApp = currentBridge() !== defaultBridge;
  useEffect(() => {
    if (!chrome || currentBridge().currentWindow().label !== MAIN_WINDOW) return;
    return startChrome();
  }, [chrome]);
  const body = inApp ? (
    <>
      <CameraProvider controller={cameraController}>
        {lab ? (
          <ViewList.Provider value={LAB_VIEWS}>
            <Shell lab={lab} />
          </ViewList.Provider>
        ) : (
          <Shell />
        )}
      </CameraProvider>
      <Update />
    </>
  ) : (
    <p className="vs-app-outside vs-quiet">This is visual[flow]’s page without the app behind it: no backend is installed (setBridge).</p>
  );
  if (!frame) return body;
  return (
    <Framed theme={theme} mode={mode}>
      {body}
    </Framed>
  );
}

/**
 * The window: the theme scope, the ground layer (the desktop shows through glass packs) and
 * `.vs-root`, a body `Text` whose type (visuals.css: the lead size) the whole app inherits.
 */
function Framed({ theme, mode, children }: { theme?: ThemeChoice; mode: ModeChoice; children: ReactNode }) {
  const { facets } = resolveTheme({ theme: 'visuals', ...theme });
  return (
    <ThemeScope facets={facets} mode={mode} bleed>
      <Layer level="ground" className="vs-app">
        <Text as="div" className="vs-root">
          {children}
        </Text>
      </Layer>
    </ThemeScope>
  );
}
