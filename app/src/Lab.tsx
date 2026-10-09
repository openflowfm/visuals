import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import * as api from './api.ts';
import type { Entry, Opened, Preset, Problem, Report } from './api.ts';
import { AudioInput } from './AudioInput.tsx';
import { useApply, usePresetEdits } from './editor.ts';
import { useNotice, useTauriEvent } from './hooks.ts';
import { Inspector } from './Inspector.tsx';
import { Library } from './Library.tsx';
import { stepDeck, useLibrary } from './library.ts';
import { stepIn } from './librarySearch.ts';
import * as pl from './playlists.ts';
import { isTyping, nameOf, notice, openFailed } from './shell.ts';
import { StageGraph } from './StageGraph.tsx';
import { FrameRate, Header, Hints, NoticeBanner, NowPlaying, Preview, type View } from './views.tsx';

/** What a load or an edit reported wrong, equations then shaders, for the graph and the inspector to mark. */
const reportProblems = (r: Report | null): Problem[] => (r ? [...r.equations, ...r.shaders] : []);

/**
 * The editor, in a lab build only (`npm run app:lab`; `App` loads this module
 * only when `VITE_LAB` is set): the library in a column, the preview with the
 * open preset's stage graph under it, and the inspector beside them; previous,
 * next and random in the header, as the home has them.
 */
export default function Editor({ start, onMode }: { start: string | null; onMode(view: View, path: string | null): void }) {
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

  return (
    <div className="app" data-view="editor">
      <Header view="editor" onChange={(next) => next !== 'editor' && onMode(next, current?.path ?? null)}>
        <div className="wdg wdg-control-group vf-transport" role="group" aria-label="presets">
          <Button onPress={() => step(-1)} label="previous preset" title="previous preset (←)">
            ◀
          </Button>
          <Button onPress={() => step(1)} label="next preset" title="next preset (→)">
            ▶
          </Button>
          <Button onPress={() => step(0)} label="random preset" title="random preset (R)">
            random
          </Button>
        </div>
        <NowPlaying group={current?.group} name={current?.name} empty={loaded && !library.length ? 'no presets yet' : 'no preset'} />
        <NoticeBanner notice={banner} onDismiss={dismiss} />
        <span className="vf-fill" />
        <AudioInput onError={audioFailed} />
        <FrameRate />
      </Header>
      <aside className="library">
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
      </aside>
      <main>
        <div className="bench-row">
          <Preview className="bench" />
        </div>
        <div className="graph">{preset && <StageGraph preset={preset} problems={problems} selected={selected} onSelect={setSelected} onChange={edit} onSet={set} />}</div>
      </main>
      <aside className="side">{preset && <Inspector preset={preset} selected={selected} problems={problems} onChange={edit} onSet={set} />}</aside>
      <Hints />
    </div>
  );
}
