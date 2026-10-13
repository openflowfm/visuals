import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionButton } from '@satoramoto/zen';
import { Group } from '@satoramoto/zen';
import { Layer } from '@satoramoto/zen';
import { Region } from '@satoramoto/zen';
import { Screen } from '@satoramoto/zen';
import * as api from '../model/api';
import type { Entry, Opened, Preset, Problem, Report } from '../model/api';
import { AudioInput } from '../AudioInput/AudioInput';
import { useApply, usePresetEdits } from '../model/editor';
import { useNotice, useTauriEvent } from '../model/hooks';
import { Library } from '../Library/Library';
import { stepDeck, useLibrary } from '../model/library';
import { stepIn } from '../model/librarySearch';
import * as pl from '../model/playlists';
import { isTyping, nameOf, notice, openFailed } from '../model/shell';
import { StageGraph } from '../StageGraph/StageGraph';
import { StageInspector } from '../StageInspector/StageInspector';
import { FrameRate, Header, Hints, NoticeBanner, NowPlaying, Preview, type View } from '../Views/Views';
import './Editor.css';

/** What a load or an edit reported wrong, equations then shaders, for the graph and the inspector to mark. */
const reportProblems = (r: Report | null): Problem[] => (r ? [...r.equations, ...r.shaders] : []);

export interface EditorProps {
  /** The preset to start on (the app's `start_preset`); null picks up where the library left off. */
  start: string | null;
  /** Leave for another view (the header's switch), with the preset showing. */
  onMode(view: View, path: string | null): void;
}

/**
 * **Job.** The lab's preset editor (a lab build only: `VisualsEditor`, the package's
 * `./visuals/lab` entry): the library in a column, the preview with the open preset's stage
 * graph under it, and the stage inspector beside them; previous, next and random in the
 * header, as the home has them; the hint strip along the bottom. ← → step and R picks at
 * random; a playlist or a followed grid playing steps the live deck instead.
 *
 * **Changed.** A library `Screen`: the shared `Header` as its fixed header and `Hints` as its
 * footer, three `Region`s in named areas (`library main side`). The main region paints nothing
 * of its own, because the preview is the native view's `Hole` and anything under it would
 * cover the picture; the graph below it sits on its own `base` Layer. The transport is a row
 * `Group` of core `ActionButton`s. The column and inspector widths are scale steps. Edits go
 * through the lab's own commands (`model/lab.ts`), never `model/api.ts`'s.
 *
 * **Kept.** The original `Editor`'s props, state, keys, copy and accessible names; what it opens,
 * follows (`live` events, the playlists) and applies (`useApply`, `usePresetEdits`).
 *
 * **Tuning knobs** (Editor.css, on `.vs-editor`):
 * - `--vs-editor-library` (220px): the library column's width.
 * - `--vs-editor-side` (380px): the stage inspector's width.
 * - `--vs-editor-bench` (40vh at most): the preview's height; it is 16:9 and never wider than the main column.
 */
export function Editor({ start, onMode }: EditorProps) {
  const [preset, setPreset] = useState<Preset | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  // The stage open in the inspector, by id; null is the graph's own first choice.
  const [selected, setSelected] = useState<string | null>(null);
  const apply = useApply(setReport);
  const { edit, set } = usePresetEdits(preset, setPreset, apply);
  const opened = useCallback((o: Opened) => {
    setPreset(o.preset);
    setReport(o.report);
  }, []);

  const [current, setCurrent] = useState<Entry | null>(null);
  const { notice: banner, set: setNotice, fail, dismiss } = useNotice();
  const [lists, setLists] = useState<pl.Lists | null>(null);
  const audioFailed = useMemo(() => fail("Couldn't read the audio input."), [fail]);

  // Stable, so the library isn't read again on every render.
  const load = useCallback(
    async (e: Entry) => {
      setCurrent(e);
      dismiss();
      try {
        opened(await api.open(e.path));
      } catch (err) {
        setNotice(notice(`Couldn't open ${e.name}.`, err));
      }
    },
    [dismiss, setNotice, opened],
  );
  // Picking up where the app left off, the preset put back stays: shown (unless the deck said first), not opened again.
  const { library, loaded, search, setSearch, found } = useLibrary(start, load, fail, (e) => setCurrent((c) => c ?? e));

  // A playlist is playing, or the deck follows the grid: the live action layer steps.
  const playing = lists?.deck.playlist ?? null;
  const step = useCallback(
    (by: number) => {
      if (playing || lists?.deck.query) {
        stepDeck({ kind: by === 0 ? 'random' : by > 0 ? 'next' : 'previous' }).catch(fail("Couldn't step the playlist."));
        return;
      }
      const next = stepIn(found.shown.length ? found.shown : library, current?.path ?? null, by);
      if (next) load(next);
    },
    [playing, lists?.deck.query, found.shown, library, current, load, fail],
  );

  useEffect(() => {
    pl.lists().then(setLists, fail("Couldn't read the playlists."));
  }, [fail]);
  // Whatever changed the preset live (a playlist step, auto-advance, a controller), the editor follows it here.
  useTauriEvent(pl.onLists, setLists);
  useTauriEvent(pl.onLive, (now) => {
    setLists((l) => (l ? { ...l, deck: now.deck } : l));
    if (!now.path) return;
    const path = now.path;
    setCurrent(library.find((e) => e.path === path) ?? { path, name: nameOf(path), group: '' });
    setNotice(now.error ? openFailed(path, now.error) : null);
    if (now.opened) opened(now.opened);
  });

  // The library's + adds to the manual playlist playing, if any.
  const into = lists?.playlists.find((p) => p.id === playing && p.kind === 'manual') ?? null;

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e)) return;
      if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key.toLowerCase() === 'r') step(0);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [step]);

  const problems = reportProblems(report);

  const header = (
    <Header view="editor" onChange={(next) => next !== 'editor' && onMode(next, current?.path ?? null)}>
      <Group name="presets" label={false} direction="row" gap={1} align="center" className="vs-editor-transport">
        <ActionButton onPress={() => step(-1)} label="previous preset" title="previous preset (←)">
          ◀
        </ActionButton>
        <ActionButton onPress={() => step(1)} label="next preset" title="next preset (→)">
          ▶
        </ActionButton>
        <ActionButton onPress={() => step(0)} label="random preset" title="random preset (R)">
          random
        </ActionButton>
      </Group>
      <NowPlaying group={current?.group} name={current?.name} empty={loaded && !library.length ? 'no presets yet' : 'no preset'} />
      <NoticeBanner notice={banner} onDismiss={dismiss} />
      <span className="vs-fill" />
      <AudioInput onError={audioFailed} />
      <FrameRate />
    </Header>
  );

  return (
    <Screen
      name="editor"
      className="vs-editor"
      header={header}
      footer={<Hints />}
      areas={['library main side']}
      columns="var(--vs-editor-library) minmax(0, 1fr) var(--vs-editor-side)"
      rows="minmax(0, 1fr)"
    >
      <Region name="library" area="library" className="vs-editor-library">
        <Library
          entries={library}
          loaded={loaded}
          search={search}
          onSearch={setSearch}
          found={found}
          current={current?.path ?? null}
          into={into}
          onLoad={load}
          onAdd={(e) => into && pl.add(into.id, e.path).then(setLists, fail(`Couldn't add ${e.name} to ${into.name}.`))}
        />
      </Region>
      <Region name="preset" area="main" className="vs-editor-main">
        <div className="vs-editor-bench-row">
          <Preview className="vs-editor-bench" />
        </div>
        <Layer level="base" className="vs-editor-graph">
          {preset && <StageGraph preset={preset} problems={problems} selected={selected} onSelect={setSelected} onChange={edit} onSet={set} />}
        </Layer>
      </Region>
      <Region name="stage" area="side" className="vs-editor-side">
        {preset && <StageInspector preset={preset} selected={selected} problems={problems} onChange={edit} onSet={set} />}
      </Region>
    </Screen>
  );
}

export default Editor;
