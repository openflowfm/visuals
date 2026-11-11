import { useEffect, useRef, useState, type RefObject } from 'react';
import { Crate } from '../../Crate.tsx';
import { HelpOverlay, titleOf } from '../../HelpOverlay.tsx';
import { starsText, whereText } from '../../Live.tsx';
import { notice } from '../../shell.ts';
import { Mark, NoticeBanner, openSheet, ViewSwitch, type View } from '../../views.tsx';
import { Icon } from '../icons.tsx';
import { TransportBar } from '../TransportBar.tsx';
import { Glyph } from './glyphs.tsx';
import {
  BeatLight,
  EffectPads,
  FullScreenOffer,
  IntensityFader,
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
import '../layout.css';
import '../inset-sidebar.css';
import './concept-stage.css';

/** The crate panel's id: its toggle names it in `aria-controls`, and a press on the toggle doesn't put the laid-over crate away. */
export const STAGE_CRATE_ID = 'lcs-crate';

/** Below this the crate is laid over the picture (and starts put away), as Home's sidebar is (home-model.ts's 1100). */
export const STAGE_DOCK_MIN = 1100;

/** How the crate shows: beside nothing (it always floats over the picture), but docked keeps the dock and header clear of it; overlay lies over them. */
export type CrateMode = 'docked' | 'overlay' | 'hidden';

/** The crate's mode from the window's width and the viewer's choice (null: the width's default). */
export function crateMode(width: number, shown: boolean | null): CrateMode {
  const wide = width >= STAGE_DOCK_MIN;
  if (shown === false) return 'hidden';
  if (shown === null) return wide ? 'docked' : 'hidden';
  return wide ? 'docked' : 'overlay';
}

export interface ConceptStageProps {
  /** The window's width (the stories' window), for the crate's mode. */
  width: number;
  /** The picture's stand-in (the native preview, full-bleed under the page). */
  picture: string;
  /** The crate shown (true), put away (false), or as the width has it (null). */
  crate?: boolean | null;
  /** The flashing-lights warning is owed: nothing plays and the controls wait for "I understand". */
  warning?: boolean;
  /** Play in the window (the welcome flow's way in). */
  windowed?: boolean;
  /** home|live: leaving for Home. */
  onView?(next: View): void;
}

/** The deck's Next line, the favourite's star and rating before it: what the transport bar's now line doesn't say. */
function NextLine({ live }: { live: LiveState }) {
  const next = nextName(live);
  const when = live.says.kind === 'held' ? null : nextWhen(live);
  return (
    <div className="lcs-next">
      {live.held && (
        <span className="lc-held" title={titleOf('hold')}>
          Hold
        </span>
      )}
      {live.star && (
        <span className="lc-star" title="A favourite (L takes the star off)" role="img" aria-label="favourite">
          <Glyph name="star" size={12} />
        </span>
      )}
      {live.rating !== null && (
        <span className="lc-rating" role="img" aria-label={`rated ${live.rating} of 5`}>
          {starsText(live.rating)}
        </span>
      )}
      <p className="lc-next" title={`${titleOf('next')}. ${whereText(live.up, live.deck)}`}>
        <span className="lc-next-label">Next</span>
        <span className={next.quiet ? 'lc-quiet' : 'lc-next-name'}>{next.missing ? <s>{next.text}</s> : next.text}</span>
        {when && <em className="lc-when">{when}</em>}
      </p>
    </div>
  );
}

/** Escape, or a press outside the crate and its toggle, puts a laid-over crate away (HomeLayout's way). */
function useDismiss(on: boolean, panel: RefObject<HTMLElement | null>, dismiss: () => void) {
  const latest = useRef(dismiss);
  latest.current = dismiss;
  useEffect(() => {
    if (!on) return;
    const press = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (panel.current?.contains(t) || t.closest(`[aria-controls~="${STAGE_CRATE_ID}"]`)) return;
      latest.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) latest.current();
    };
    document.addEventListener('pointerdown', press);
    window.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', press);
      window.removeEventListener('keydown', key);
    };
  }, [on, panel]);
}

/**
 * Concept B, "Stage": the output picture full-bleed across the window, Home's
 * inset panels floating over it — the crate down the left as Home's sidebar,
 * the header's two capsules along the top, and Home's transport bar grown a
 * second row (Next, the effects, Intensity, More effects) docked along the
 * bottom as an inset panel. Every panel is opaque page paint: the picture is
 * the native view under the page, and no blur reaches it.
 */
export function ConceptStage({ width, picture, crate = null, warning = false, windowed = false, onView = () => {} }: ConceptStageProps) {
  const live = useLive({ windowed });
  const owed = useOwedWarning(warning);
  const [shown, setShown] = useState<boolean | null>(crate);
  useEffect(() => setShown(crate), [crate]);
  const [help, setHelp] = useState(false);
  const mode = crateMode(width, shown);
  const open = mode !== 'hidden';
  const panel = useRef<HTMLElement | null>(null);
  useDismiss(mode === 'overlay', panel, () => setShown(false));
  // A crate laid over the picture takes focus when it opens, so Escape and the keyboard reach it.
  useEffect(() => {
    if (mode === 'overlay') panel.current?.querySelector<HTMLElement>('button')?.focus();
  }, [mode]);
  const transport = transportFor(live, (e) => live.setError(notice("Couldn't use that audio input.", e)));

  return (
    <div className="app home lay lc lcs" data-lights="" data-crate={mode} data-warning={owed.owed ? '' : undefined} data-windowed={live.inWindow ? '' : undefined}>
      {owed.owed ? <div className="lcs-dark" aria-hidden="true" /> : <Picture src={picture} className="lcs-picture" />}

      {open && (
        <div className="lcs-crate-cell" data-mode={mode} inert={owed.owed || undefined}>
          <nav className="lay-side" id={STAGE_CRATE_ID} aria-label="crate" ref={panel} tabIndex={-1}>
            <div className="lay-side-band" data-tauri-drag-region />
            <div className="lay-side-body">
              <div className="isb">
                <div className="isb-mark">
                  <Mark />
                </div>
                <div className="isb-sections">{live.lists && <Crate lists={live.lists} data={live.data} act={live.act} onLists={live.setLists} onError={live.setError} current={live.current} />}</div>
              </div>
            </div>
          </nav>
        </div>
      )}

      <header className="lcs-head" data-tauri-drag-region>
        <div className="lcs-island lcs-island-lead">
          <button
            type="button"
            className="home-tool lcs-crate-toggle"
            aria-label="crate"
            aria-controls={STAGE_CRATE_ID}
            aria-expanded={open}
            title={open ? 'Hide the crate: playlists, moods and up next' : 'Show the crate: playlists, moods and up next'}
            onClick={() => setShown(!open)}
          >
            <Icon name="sidebar" />
          </button>
          <ViewSwitch view="live" onChange={onView} />
        </div>
        <span className="lcs-fill" />
        <div className="lcs-island">
          <BeatLight live={live} align="right" />
          <OutputLight live={live} align="right" />
          <ToolButton glyph="help" label="help" title={titleOf('help')} pressed={help} onPress={() => setHelp(true)} />
          <ToolButton glyph="settings" label="settings" title={titleOf('settings')} onPress={() => openSheet('settings')} />
        </div>
      </header>

      {!owed.owed && live.inWindow && (live.displays?.length ?? 0) > 0 && (
        <div className="lcs-offer">
          <FullScreenOffer live={live} />
        </div>
      )}

      {owed.owed && (
        <div className="lcs-warning">
          <WarningCard onUnderstood={owed.understood} />
        </div>
      )}

      <section className="lcs-dock" aria-label="Live controls" inert={owed.owed || undefined}>
        <NoticeBanner className="lcs-notice" notice={live.error} onDismiss={live.dismiss} />
        <TransportBar {...transport} />
        <div className="lcs-row">
          <NextLine live={live} />
          <div className="lcs-fx">
            <EffectPads live={live} variant="key" />
            <span className="lcs-gap" aria-hidden="true" />
            <div className="lcs-fader">
              <IntensityFader live={live} />
            </div>
            <MoreEffectsButton />
          </div>
        </div>
      </section>

      <span className="lay-lights" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <HelpOverlay open={help} onClose={() => setHelp(false)} />
    </div>
  );
}
