import { useState } from 'react';
import * as api from '../../api.ts';
import { Crate } from '../../Crate.tsx';
import { HelpOverlay, titleOf } from '../../HelpOverlay.tsx';
import { playsFrom } from '../../home.ts';
import { prepareRow } from '../../librarySearch.ts';
import { keyOf } from '../../Live.tsx';
import * as pl from '../../playlists.ts';
import { notice } from '../../shell.ts';
import { STILL } from '../../stories/fixtures.ts';
import { Header, Mark, NoticeBanner, openSheet, type View } from '../../views.tsx';
import { say } from '../../words.ts';
import { Hero } from '../Hero.tsx';
import { HomeLayout, INSPECTOR_ID, SIDEBAR_ID } from '../HomeLayout.tsx';
import { modesFor, type LayoutPrefs } from '../home-model.ts';
import { Icon } from '../icons.tsx';
import { Inspector } from '../inspector/Inspector.tsx';
import { TransportBar } from '../TransportBar.tsx';
import {
  BeatLight,
  EffectPads,
  FullScreenOffer,
  IntensityFader,
  MoreEffectsButton,
  NowNext,
  OutputLight,
  Picture,
  ToolButton,
  transportFor,
  useLive,
  useOwedWarning,
  WarningCard,
  type LiveState,
} from './parts.tsx';
// The crate's own rules (and help's), then this concept's: the crate drawn as Home's inset sidebar.
import '../../home.css';
import '../../live.css';
import '../inset-sidebar.css';
import './concept-shell.css';

/**
 * Concept A, "Home's shell" (stories only): the Live view built from Home's own
 * window — HomeLayout's inset sidebar, header row, pinned hero, main column,
 * transport bar and inspector — so Live is Home with the performing controls
 * where the library's grid was. See LiveConceptA.stories.tsx for what moved.
 */
export interface ConceptShellProps {
  /** The window's width, for `modesFor` (the story sizes the window to it). */
  width: number;
  /** What the viewer chose for the panels: their start. */
  prefs: LayoutPrefs;
  /** Playing in the window (one display, or the welcome flow's way in). */
  windowed?: boolean;
  /** The flashing warning owed: nothing plays and the controls wait for "I understand". */
  warning?: boolean;
  /** Leave for the other view (the header's switch). */
  onMode(next: View): void;
}

/** The playing preset as the inspector shows it, with "back" from one picked in its field. */
function LiveInspector({ live, onClose }: { live: LiveState; onClose?(): void }) {
  const [picked, setPicked] = useState<api.LibraryRow | null>(null);
  const key = keyOf(live.rows, live.current);
  const playing = key ? (live.rows.find((r) => r.key === key) ?? null) : null;
  const shown = picked ?? playing;
  const lists = live.lists;
  return (
    <Inspector
      subject={shown ? prepareRow(shown, live.data?.presets[shown.key]) : null}
      playing={key}
      from={live.deck && lists ? playsFrom(live.deck, lists.playlists, false) : ''}
      playlists={lists?.playlists ?? null}
      library={live.rows}
      mine={live.data?.presets}
      onSet={(keys, change) => void api.librarySet(keys, change).catch(() => {})}
      onAddTo={(id, paths) => paths.reduce((p, path) => p.then(() => pl.add(id, path).then(live.setLists)), Promise.resolve()).catch(() => {})}
      onPick={(row) => setPicked(row.key === key ? null : row)}
      onBack={() => setPicked(null)}
      onClose={onClose}
    />
  );
}

/** The crate in the sidebar: the mark at its top (decision 71), then the playlists, the moods and up next. */
function Side({ live }: { live: LiveState }) {
  return (
    <div className="cs-side">
      <div className="isb-mark">
        <Mark />
      </div>
      <div className="cs-crate">
        {live.lists ? (
          <Crate lists={live.lists} data={live.data} act={live.act} onLists={live.setLists} onError={(e) => live.setError(notice("Couldn't change the playlist.", e))} current={live.current} />
        ) : (
          <p className="cs-quiet">Reading the playlists…</p>
        )}
      </div>
    </div>
  );
}

/** The window. */
export function ConceptShell({ width, prefs: start, windowed = false, warning = false, onMode }: ConceptShellProps) {
  const live = useLive({ windowed });
  const owed = useOwedWarning(warning);
  const [prefs, setPrefs] = useState(start);
  const [help, setHelp] = useState(false);
  const modes = modesFor(width, prefs);
  const sideShown = modes.sidebar !== 'hidden';
  const inspOpen = modes.inspector !== null;
  // While the warning is owed nothing plays: the bar names nothing and the main column says why.
  const shown: LiveState = owed.owed ? { ...live, current: null, star: false, rating: null } : live;
  const bar = transportFor(shown);

  return (
    <div className="lc cs" style={{ width, height: 900 }} data-owed={owed.owed ? '' : undefined}>
      <HomeLayout
        lights
        sidebarLabel="crate"
        inspectorLabel={say('inspector')}
        sidebarMode={modes.sidebar}
        inspectorMode={modes.inspector}
        onDismiss={() =>
          setPrefs((p) => ({
            sidebar: modes.sidebar === 'overlay' ? false : p.sidebar,
            inspector: modes.inspector === 'overlay' ? false : p.inspector,
          }))
        }
        sidebar={
          <div className="cs-fill" inert={owed.owed}>
            <Side live={live} />
          </div>
        }
        header={
          <Header
            view="live"
            mark={false}
            onChange={(next) => next !== 'live' && onMode(next)}
            lead={
              <button
                type="button"
                className="home-tool home-tool-sidebar"
                aria-label="crate"
                aria-controls={SIDEBAR_ID}
                aria-pressed={sideShown}
                title={`${sideShown ? 'Hide' : 'Show'} the crate: playlists, moods and up next`}
                onClick={() => setPrefs((p) => ({ ...p, sidebar: !sideShown }))}
              >
                <Icon name="sidebar" />
              </button>
            }
          >
            <span className="vf-fill" />
            <div className="cs-tools" inert={owed.owed}>
              <BeatLight live={live} align="right" />
              <OutputLight live={live} align="right" />
              <span className="cs-gap" />
              <ToolButton glyph="help" label="help" title={titleOf('help')} onPress={() => setHelp(true)} />
              <ToolButton glyph="settings" label="settings" title={titleOf('settings')} onPress={() => openSheet('settings')} />
              <button
                type="button"
                className="home-tool home-tool-inspector"
                aria-label={say('inspector')}
                aria-controls={INSPECTOR_ID}
                aria-pressed={inspOpen}
                title={`${inspOpen ? 'Hide' : 'Show'} the ${say('inspector')}: the preset playing`}
                onClick={() => setPrefs((p) => ({ ...p, inspector: !inspOpen }))}
              >
                <Icon name="sidebar" />
              </button>
            </div>
          </Header>
        }
        hero={
          <Hero
            picture={
              owed.owed ? (
                // The warning holds the picture's place: opaque, so it can sit over the native view's hole.
                <div className="hero-pic cs-warning-slot">
                  <WarningCard onUnderstood={owed.understood} />
                </div>
              ) : (
                <Picture className="hero-pic" src={STILL} />
              )
            }
          />
        }
        bar={
          <div className="cs-fill" inert={owed.owed}>
            <TransportBar {...bar} playing={owed.owed ? false : bar.playing} position={owed.owed ? null : bar.position} />
          </div>
        }
        inspector={owed.owed || !inspOpen ? undefined : <LiveInspector live={live} onClose={modes.inspector === 'overlay' ? () => setPrefs((p) => ({ ...p, inspector: false })) : undefined} />}
      >
        <div className="cs-deck" inert={owed.owed}>
          <FullScreenOffer live={live} />
          <NoticeBanner className="cs-notice" notice={live.error} onDismiss={live.dismiss} />
          {owed.owed ? <p className="cs-waits">Live waits for the warning above: nothing plays until “I understand”.</p> : <NowNext live={shown} />}
          <EffectPads live={live} hold />
          <div className="cs-row">
            <div className="cs-fader">
              <IntensityFader live={live} />
            </div>
            <MoreEffectsButton />
          </div>
        </div>
      </HomeLayout>
      <HelpOverlay open={help} onClose={() => setHelp(false)} />
    </div>
  );
}
