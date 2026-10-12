import { useEffect, useState, type ReactNode } from 'react';
import { ThemeRoot } from '@openflow/widgets/theme/ThemeRoot.tsx';
import { DEFAULT_THEME } from '@openflow/widgets/theme/theme.ts';
import '@openflow/widgets/palette.css';
import '@openflow/widgets/tokens.css';
import './lab.css';
import Editor from './Editor.tsx';
import * as output from './output.ts';

/**
 * A lab build's page (`VITE_LAB=1`; main.tsx loads this module only then, so
 * none of it reaches the app people get): the editor, still on the suite's
 * widgets as the page was before zen, which has no editor. It starts in the
 * editor unless `VISUALS_VIEW` says another view, as the lab always did; that
 * view, or leaving the editor for the home or live, is `app` (zen's UI).
 */
export default function Lab({ app }: { app: ReactNode }) {
  const [start, setStart] = useState<{ editor: boolean; preset: string | null } | null>(null);
  useEffect(() => {
    Promise.all([output.startPreset(), output.liveStart()]).then(
      ([preset, view]) => setStart({ editor: output.startIn(view, 'editor').view === 'editor', preset }),
      () => setStart({ editor: true, preset: null }),
    );
  }, []);
  if (!start) return null;
  if (!start.editor) return app;
  return (
    <ThemeRoot theme={DEFAULT_THEME} className="vf-root">
      <Editor start={start.preset} onMode={() => setStart({ editor: false, preset: null })} />
    </ThemeRoot>
  );
}
