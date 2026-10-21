import { useEffect, useMemo, useState } from 'react';
import * as api from '../../api.ts';
import { chipAction, litMoods, moods, needsDeckItems, upcoming, type Upcoming } from '../../Crate.tsx';
import { HelpOverlay } from '../../HelpOverlay.tsx';
import { playsFrom, type Pane } from '../../home.ts';
import { prepareRow, STARRED } from '../../librarySearch.ts';
import * as pl from '../../playlists.ts';
import { PresetTile, tileBy, tileName } from '../../PresetTile.tsx';
import { STILL } from '../../stories/fixtures.ts';
import { Header, NoticeBanner, type View } from '../../views.tsx';
import { say } from '../../words.ts';
import { HomeLayout, INSPECTOR_ID, SIDEBAR_ID } from '../HomeLayout.tsx';
import { Hero } from '../Hero.tsx';
import { modesFor, paneName, type LayoutPrefs } from '../home-model.ts';
import { Icon } from '../icons.tsx';
import { InsetSidebar } from '../InsetSidebar.tsx';
import { Inspector } from '../inspector/Inspector.tsx';
import { sidebarSections } from '../sidebar-model.ts';
import { StoryGrid } from '../StoryGrid.tsx';
import { TransportBar } from '../TransportBar.tsx';
import { Glyph } from './glyphs.tsx';
import {
  BeatLight,
  EffectPads,
  FullScreenOffer,
  IntensityFader,
  Label,
  MoreEffectsButton,
  nextName,
  nextWhen,
  OutputLight,
  Picture,
  ToolButton,
  transportFor,
  useLive,
  useOwedWarning,
  WarningCard,
  type LiveState,
} from './parts.tsx';
import './concept-frame.css';

/**
 * Concept C, "One frame" (stories only): Live is not another window but Home's
 * own frame with another main pane. The sidebar, the header, the hero's
 * picture, the transport bar and the inspector stay exactly where Home has
 * them (the same nodes); the header's home|live swaps what sits under the
 * picture: Home's grid, or the performing pane (the pads, Intensity, up next as
 * tiles, the moods). In live, a sidebar row plays its playlist, and the header
 * carries the beat, the output and help.
 */

/** Which view the frame shows: Home's two (the editor is a lab build's, and not part of this). */
export type FrameView = Extract<View, 'home' | 'live'>;

export interface FrameProps {
  /** The window's width, whatever the runner's viewport; it is 900 tall. */
  width: number;
  /** The view it starts in. */
  view: FrameView;
  /** Live plays in the window (the welcome flow's way in): no output opened on a display. */
  windowed?: boolean;
  /** The flashing-lights warning is owed: live waits behind it until "I understand". */
  warning?: boolean;
  /** What the viewer chose for the side panels (home-model.ts's `LayoutPrefs`). */
  prefs?: LayoutPrefs;
}

/** How many tiles "Up next" asks for; the row shows as many as fit on one line. */
const UP_TILES = 8;

/** The pane a deck plays from, as the sidebar marks it in live: its playlist, the starred filter, or the library. */
function playingPane(deck: pl.Deck | null): Pane | null {
  if (!deck) return null;
  if (deck.playlist) return { kind: 'list', id: deck.playlist };
  if (deck.query?.groups.star?.includes(STARRED)) return { kind: 'starred' };
  if (deck.query) return { kind: 'library' };
  return null;
}

/** What playing a sidebar row does in live: its playlist loads, the library or the starred plays as a filter. */
function playAction(pane: Pane, lists: pl.Lists | null): pl.Action | null {
  if (pane.kind === 'library') return { kind: 'query', query: { groups: {}, text: '', browse: true } };
  if (pane.kind === 'starred') return { kind: 'query', query: { groups: { star: [STARRED] }, text: '' } };
  const at = lists?.playlists.findIndex((p) => p.id === pane.id) ?? -1;
  return at >= 0 ? { kind: 'load', playlist: at, index: null } : null;
}

/** The deck's play order after the preset playing, as the crate's "Up next" reads it (`deckItems` when the order isn't the playlist's own). */
function useUpNext(live: LiveState): Upcoming[] {
  const lists = live.lists;
  const fetching = lists ? needsDeckItems(lists) : false;
  const [items, setItems] = useState<string[] | null>(null);
  const deck = lists?.deck;
  const query = JSON.stringify(deck?.query ?? null);
  useEffect(() => {
    if (!fetching) return setItems(null);
    let on = true;
    pl.deckItems().then(
      (paths) => on && setItems(paths),
      () => {},
    );
    return () => {
      on = false;
    };
  }, [fetching, deck?.playlist, query, deck?.order, deck?.count, deck?.current]);
  if (!lists) return [];
  return upcoming({ ...lists, deck: { ...lists.deck, current: lists.deck.current ?? live.current } }, items, UP_TILES);
}

/** The performing pane under the picture: the pads and Intensity first (nearest the picture), then up next as tiles, then the moods. */
function LivePane({ live }: { live: LiveState }) {
  const up = useUpNext(live);
  const next = nextName(live);
  const when = live.held ? null : nextWhen(live);
  const from = live.deck && live.lists ? playsFrom(live.deck, live.lists.playlists, false) : '';
  const all = moods(live.data);
  const lit = live.deck ? litMoods(live.deck) : [];
  const rowOf = useMemo(() => new Map(live.rows.map((r) => [r.path, r])), [live.rows]);
  return (
    <section className="cf-live" aria-label="live">
      <NoticeBanner className="cf-problem" notice={live.error} onDismiss={live.dismiss} />
      <FullScreenOffer live={live} />
      <div className="cf-deck">
        <EffectPads live={live} hold />
        <div className="cf-dial">
          <IntensityFader live={live} />
          <MoreEffectsButton />
        </div>
      </div>
      <section className="cf-section" aria-labelledby="cf-up">
        <div className="cf-head">
          <Label id="cf-up">Up next</Label>
          <span className="cf-head-note">{live.held ? next.text : [when, from].filter(Boolean).join(' · ')}</span>
        </div>
        {up.length === 0 ? (
          <p className="cf-empty">{next.text}</p>
        ) : (
          <ol className="cf-up" data-held={live.held ? '' : undefined}>
            {up.map((u, i) => {
              const r = rowOf.get(u.path);
              const name = r ? tileName(r.title, r.path) : u.name;
              const go = u.at !== null ? () => live.act({ kind: 'go', index: u.at! }) : undefined;
              return (
                <PresetTile
                  as="li"
                  key={`${u.path}:${u.at ?? i}`}
                  className="cf-up-tile"
                  thumbnail={r?.thumbnail ?? null}
                  empty={r?.style ?? ''}
                  name={u.missing ? `${name} (missing)` : name}
                  by={r ? tileBy(r.authors, r.style) : ''}
                  marks={i === 0 ? <span className="cf-next-mark">Next</span> : undefined}
                  title={go ? `Play ${name} now` : name}
                  {...(go
                    ? {
                        role: 'button',
                        tabIndex: 0,
                        'aria-label': `${i === 0 ? 'Next: ' : ''}${name}${u.missing ? ', missing' : ''}`,
                        onClick: go,
                        onKeyDown: (e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return;
                          e.preventDefault();
                          go();
                        },
                      }
                    : {})}
                />
              );
            })}
          </ol>
        )}
      </section>
      <section className="cf-section" aria-labelledby="cf-moods">
        <div className="cf-head">
          <Label id="cf-moods">Moods</Label>
          <span className="cf-head-note">your tags: tap to play, tap more to mix</span>
        </div>
        {all.length === 0 ? (
          <p className="cf-empty">Tag presets in the inspector, and their tags play from here.</p>
        ) : (
          <div className="cf-moods" role="group" aria-label="Moods">
            {all.map((m) => {
              const on = lit.includes(m.tag);
              return (
                <button
                  key={m.tag}
                  type="button"
                  className="cf-chip"
                  aria-pressed={on}
                  title={on ? `Stop mixing in ${m.tag}` : `Play the presets tagged ${m.tag}`}
                  onClick={() => live.act(chipAction(lit, m.tag))}
                >
                  <Glyph name="mood" size={12} />
                  {m.tag}
                  <span className="cf-chip-count lc-num">{m.count}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
}

/** Home's window with live's pane: one frame, two main panes. */
export function ConceptFrame({ width, view: start, windowed = false, warning = false, prefs: startPrefs = { sidebar: null, inspector: null } }: FrameProps) {
  const [view, setView] = useState<FrameView>(start);
  const gate = useOwedWarning(warning);
  const gated = view === 'live' && gate.owed;
  // Nothing opens on a display until live is shown and the warning answered.
  const live = useLive({ windowed: windowed || view !== 'live' || gate.owed });
  const [prefs, setPrefs] = useState(startPrefs);
  const modes = modesFor(width, prefs);
  const [browse, setBrowse] = useState<Pane>({ kind: 'library' });
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [picked, setPicked] = useState<api.LibraryRow | null>(null);
  const [help, setHelp] = useState(false);

  const presets = live.data?.presets ?? {};
  const starred = Object.entries(presets)
    .filter(([, m]) => m.star)
    .map(([k]) => k);
  const sections = sidebarSections(live.lists, { library: live.rows.length, starred: starred.length });
  const selected = view === 'live' ? playingPane(live.deck) : browse;
  const playingRow = live.rows.find((r) => r.path === live.current) ?? null;
  const shown = picked ?? playingRow;

  const play = (row: api.LibraryRow) => {
    setPicked(null);
    const list = browse.kind === 'list' ? live.lists?.playlists.findIndex((p) => p.id === browse.id) : -1;
    const index = list !== undefined && list >= 0 ? live.lists!.playlists[list].items.findIndex((i) => i.path === row.path) : -1;
    live.act(list !== undefined && list >= 0 && index >= 0 ? { kind: 'load', playlist: list, index } : { kind: 'query', query: { groups: {}, text: '', browse: true }, at: row.path });
  };
  const gridRows = (() => {
    if (browse.kind === 'starred') return live.rows.filter((r) => starred.includes(r.key));
    if (browse.kind === 'list') {
      const paths = live.lists?.playlists.find((p) => p.id === browse.id)?.items.map((i) => i.path) ?? [];
      return paths.map((p) => live.rows.find((r) => r.path === p)).filter((r): r is api.LibraryRow => !!r);
    }
    return live.rows;
  })();

  const sideShown = modes.sidebar !== 'hidden';
  const inspOpen = modes.inspector !== null;
  return (
    // `.app.home` for Home's tokens (the help overlay sits outside the layout), `.lc` for the parts.
    <div className="app home lc cf" data-view={view} data-gated={gated ? '' : undefined} style={{ width, height: 900 }}>
      <HomeLayout
        lights
        sidebarMode={modes.sidebar}
        inspectorMode={modes.inspector}
        onDismiss={() =>
          setPrefs((p) => ({
            sidebar: modes.sidebar === 'overlay' ? false : p.sidebar,
            inspector: modes.inspector === 'overlay' ? false : p.inspector,
          }))
        }
        sidebar={
          <InsetSidebar
            sections={sections}
            selected={selected}
            onSelect={(pane) => {
              if (view === 'home') return setBrowse(pane);
              if (gated) return;
              const action = playAction(pane, live.lists);
              if (action) live.act(action);
            }}
            collapsed={collapsed}
            onToggle={(id) => setCollapsed((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))}
          />
        }
        header={
          <Header
            view={view}
            mark={false}
            onChange={(next) => (next === 'home' || next === 'live') && setView(next)}
            lead={
              <button
                type="button"
                className="home-tool home-tool-sidebar"
                aria-label={say('source list')}
                aria-controls={SIDEBAR_ID}
                aria-pressed={sideShown}
                title={`${sideShown ? 'Hide' : 'Show'} the ${say('source list')} (⌃⌘S)`}
                onClick={() => setPrefs((p) => ({ ...p, sidebar: !sideShown }))}
              >
                <Icon name="sidebar" />
              </button>
            }
          >
            <span className="vf-fill" />
            {view === 'live' && (
              <div className="cf-lights" inert={gated || undefined}>
                <BeatLight live={live} align="right" />
                <OutputLight live={live} align="right" />
              </div>
            )}
            {view === 'live' && <ToolButton glyph="help" label="help" title="Every control and its key (?)" onPress={() => setHelp(true)} />}
            <button
              type="button"
              className="home-tool home-tool-inspector"
              aria-label={say('inspector')}
              aria-controls={INSPECTOR_ID}
              aria-pressed={inspOpen}
              title={`${inspOpen ? 'Hide' : 'Show'} the ${say('inspector')} (⌘I)`}
              onClick={() => setPrefs((p) => ({ ...p, inspector: !inspOpen }))}
            >
              <Icon name="sidebar" />
            </button>
          </Header>
        }
        hero={
          <Hero
            picture={
              gated ? (
                <div className="hero-pic cf-waiting" role="img" aria-label={`${say('bench')}: waiting for the warning`}>
                  <span>Nothing plays until you have read the warning.</span>
                </div>
              ) : (
                <Picture className="hero-pic" src={STILL} />
              )
            }
          />
        }
        bar={
          <div className="cf-bar" inert={gated || undefined}>
            <TransportBar {...transportFor(live)} />
          </div>
        }
        inspector={
          <Inspector
            subject={shown ? prepareRow(shown, presets[shown.key]) : null}
            playing={playingRow?.key ?? null}
            from={live.deck && live.lists ? playsFrom(live.deck, live.lists.playlists) : ''}
            playlists={live.lists?.playlists ?? null}
            library={live.rows}
            mine={presets}
            onSet={(keys, change) => void api.librarySet(keys, change).catch(() => {})}
            onAddTo={(id, paths) => paths.forEach((p) => void pl.add(id, p).then(live.setLists, () => {}))}
            onPick={setPicked}
            onBack={() => setPicked(null)}
            onPlay={() => picked && play(picked)}
            onClose={modes.inspector === 'overlay' ? () => setPrefs((p) => ({ ...p, inspector: false })) : undefined}
          />
        }
      >
        {view === 'home' ? (
          <StoryGrid title={paneName(browse, live.lists)} rows={gridRows} playing={live.current} starred={starred} onPlay={play} />
        ) : gated ? (
          <div className="cf-gate">
            <WarningCard onUnderstood={gate.understood} />
          </div>
        ) : (
          <LivePane live={live} />
        )}
      </HomeLayout>
      <HelpOverlay open={help} onClose={() => setHelp(false)} />
    </div>
  );
}
