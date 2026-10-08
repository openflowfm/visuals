import { useCallback, useState } from 'react';
import type { Opened, Preset, Problem, Report } from './api.ts';
import { Browse } from './App.tsx';
import { useApply, usePresetEdits } from './editor.ts';
import { Inspector } from './Inspector.tsx';
import { StageGraph } from './StageGraph.tsx';
import type { View } from './views.tsx';

/** What a load or an edit reported wrong, equations then shaders, for the graph and the inspector to mark. */
const reportProblems = (r: Report | null): Problem[] => (r ? [...r.equations, ...r.shaders] : []);

/**
 * The editor, in a lab build only (`npm run app:lab`; `App` loads this module
 * only when `VITE_LAB` is set): browsing as the library view has it, with the
 * open preset's stage graph under the preview and the inspector beside it.
 */
export default function Editor({ start, onMode }: { start: string | null; onMode(view: View, path: string | null): void }) {
  const [preset, setPreset] = useState<Preset | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  // The stage open in the inspector, by id; null is the graph's own first choice.
  const [selected, setSelected] = useState<string | null>(null);
  const apply = useApply(setReport);
  const { edit, set } = usePresetEdits(preset, setPreset, apply);
  // Stable, so the library isn't read again on every render.
  const onOpened = useCallback((o: Opened) => {
    setPreset(o.preset);
    setReport(o.report);
  }, []);

  const problems = reportProblems(report);

  return (
    <Browse
      view="editor"
      start={start}
      onMode={onMode}
      onOpened={onOpened}
      below={<div className="graph">{preset && <StageGraph preset={preset} problems={problems} selected={selected} onSelect={setSelected} onChange={edit} onSet={set} />}</div>}
      side={<aside className="side">{preset && <Inspector preset={preset} selected={selected} problems={problems} onChange={edit} onSet={set} />}</aside>}
    />
  );
}
