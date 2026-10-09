import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { HOME, useSheet, type View } from './views.tsx';
import { Home } from './Home.tsx';
import { Settings } from './Settings.tsx';
import { MoreEffects } from './MoreEffects.tsx';
import { CrashPrompt } from './CrashPrompt.tsx';
import { useAccessibility } from './access.ts';
import { Live } from './Live.tsx';
import * as output from './output.ts';
import { FlashWarning, Onboarding, useFlashWarning, useWelcome } from './Onboarding.tsx';

// The editor, only in a lab build: without `VITE_LAB` this is `null` at build
// time, and the editor's code (the graph, the inspector, the edits) never reaches
// the bundle.
const Editor = import.meta.env.VITE_LAB ? lazy(() => import('./Lab.tsx')) : null;

/** The view showing, the preset it starts on, whether live plays in the window, and whether the home opens on its library pane. */
interface Mode {
  view: View;
  preset: string | null;
  windowed?: boolean;
  library?: boolean;
}

/**
 * The home (playlists and the library, with the preview of what plays), live
 * mode (performing controls, the output full screen on a display), and in a lab
 * build the editor; Settings and More effects open over any of them
 * (`openSheet`). `VISUALS_LIVE=1` starts in live mode,
 * `VISUALS_VIEW=home|library|live|live-windowed` in that view (`library` is the
 * home on its library pane; `live-windowed` is live in the window, without
 * opening the output), `VISUALS_PRESET=<path>` on a preset. With the flashing
 * warning owed, live waits for its "I understand".
 */
export function App() {
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
  const { sheet, close } = useSheet();
  useAccessibility();
  if (!mode || welcome.shown === null) return null;
  if (welcome.shown)
    return (
      <Onboarding
        onDone={(end) => {
          welcome.close();
          // Arriving from the flow, live mode plays in the window: the output isn't opened on a display.
          setMode({ view: end === 'live' ? 'live' : HOME, preset: null, windowed: end === 'live' });
        }}
      />
    );
  // Nothing plays live behind an owed warning: live starts once it is understood.
  return (
    <FlashWarning warning={warning} live={mode.view === 'live'}>
      <Page mode={mode} onMode={onMode} />
      <Settings open={sheet === 'settings'} onClose={close} />
      <MoreEffects open={sheet === 'effects'} onClose={close} />
      <CrashPrompt />
    </FlashWarning>
  );
}

/** The view showing, under the sheets `App` lays over every view. */
function Page({ mode, onMode }: { mode: Mode; onMode(view: View, preset: string | null): void }) {
  if (mode.view === 'live') return <Live start={mode.preset} onMode={onMode} windowed={mode.windowed} />;
  if (mode.view === 'editor' && Editor)
    return (
      <Suspense fallback={null}>
        <Editor start={mode.preset} onMode={onMode} />
      </Suspense>
    );
  return <Home start={mode.preset} onMode={onMode} library={mode.library} />;
}
