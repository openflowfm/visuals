import { titleOf } from '../HelpOverlay.tsx';
import { Icon } from '../layout/icons.tsx';
import { LinkPanel } from '../LinkPanel.tsx';
import { OutputPanel } from '../OutputPanel.tsx';
import { Popover } from '../Popover.tsx';
import { BeatDot, beatLabel, bpmText, Fps, linked, openSettings, outputLabel, SkipNote, TapButton } from '../Status.tsx';
import { ViewSwitch } from '../views.tsx';
import { say } from '../words.ts';
import type { LiveState } from './live-model.ts';
import { STAGE_CRATE_ID, type FullScreenOfferProps, type StageHeadProps } from './stage-model.ts';
import { useLinkFrame } from './useLive.ts';
import './stage-head.css';

/** The crate's toggle's tooltip: what it does now, show or hide. */
export const crateTitle = (open: boolean): string => `${open ? 'Hide' : 'Show'} the ${say('crate')}`;

/** What the Output light shows beside its glyph: the display the picture is on, or "In this window" (in the header's normal ink) while it is on none. */
export const outputWords = (live: Pick<LiveState, 'status'>): string => live.status.display?.name ?? 'In this window';

/**
 * The Beat light: the dot flashing on each beat, the tempo, and with a Link
 * session the peers keeping it; its popover is tap tempo and Ableton Link.
 * Its own leaf, as Link's frames come ten times a second.
 */
function BeatLight({ live }: { live: LiveState }) {
  const frame = useLinkFrame();
  const bpm = bpmText(frame, live.effects);
  const peers = linked(frame) ? frame.peers : null;
  return (
    <Popover
      className="stage-light"
      name={beatLabel(frame, live.effects)}
      title={titleOf('beat')}
      align="right"
      label={
        <>
          <BeatDot frame={frame} className="stage-beat-dot" />
          <span className="stage-num">{bpm ?? '— BPM'}</span>
          {peers !== null && (
            <span className="stage-light-sub" aria-hidden="true">
              <Icon name="link" size={12} />
              {peers}
            </span>
          )}
        </>
      }
    >
      <div className="wdg stage-pop" data-pop="beat">
        <TapButton effects={live.effects} onTap={() => live.actFx({ kind: 'tap' })} />
        <LinkPanel />
      </div>
    </Popover>
  );
}

/** The Output light: where the picture goes, the display's name or "In this window" in the header's normal ink; its popover picks the display and says how it fits. */
function OutputLight({ live }: { live: LiveState }) {
  return (
    <Popover
      className="stage-light"
      name={outputLabel(live.status)}
      title={titleOf('output')}
      align="right"
      label={
        <>
          <Icon name="output" size={14} />
          <span className="stage-light-text">{outputWords(live)}</span>
        </>
      }
    >
      <div className="wdg stage-pop" data-pop="output">
        <OutputPanel status={live.status} show={live.show} />
      </div>
    </Popover>
  );
}

/**
 * The Stage's header, on the traffic lights' line: two opaque capsules over the
 * picture, and between them the picture itself, which drags the window. The
 * leading one is the crate's toggle and Home | Live, as Home's header switches
 * them; the trailing one says when presets were skipped or the picture runs
 * slow, then the Beat and Output lights (Home's popovers, not modal: live's
 * keys keep working while one is open), ? and settings.
 */
export function StageHead({ live, crateOpen, onCrate, help, onHelp, onView }: StageHeadProps) {
  return (
    <header className="stage-bar" data-tauri-drag-region>
      <div className="stage-cap stage-cap-lead">
        <button type="button" className="stage-tool" aria-label={say('crate')} aria-controls={STAGE_CRATE_ID} aria-expanded={crateOpen} title={crateTitle(crateOpen)} onClick={onCrate}>
          <Icon name="sidebar" />
        </button>
        <span className="stage-switch">
          <ViewSwitch view="live" onChange={onView} />
        </span>
      </div>
      <span className="stage-fill" />
      <div className="stage-cap stage-cap-trail">
        <SkipNote className="stage-skipped" />
        <Fps className="stage-fps" />
        <BeatLight live={live} />
        <OutputLight live={live} />
        <button type="button" className="stage-tool" aria-label="Help" aria-haspopup="dialog" aria-expanded={help} aria-keyshortcuts="?" title={titleOf('help')} onClick={onHelp}>
          <Icon name="help" />
        </button>
        <button type="button" className="stage-tool" aria-label="Settings" aria-haspopup="dialog" aria-keyshortcuts="Meta+," title={`${titleOf('settings')} (⌘,)`} onClick={openSettings}>
          <Icon name="gear" />
        </button>
      </div>
    </header>
  );
}

/**
 * "Go full screen on…", over the picture while it plays in the window (one
 * display, or from the welcome flow): a button for each display, and with only
 * one the note that the picture will cover this window. Nothing while the output
 * is on a display, or before the displays are known.
 */
export function FullScreenOffer({ live }: FullScreenOfferProps) {
  if (!live.inWindow || !live.displays?.length) return null;
  return (
    <div className="stage-offer" role="group" aria-label="Go full screen" title={titleOf('fullscreen')}>
      {live.displays.map((d) => (
        <button key={d.id} type="button" className="stage-offer-go" onClick={() => live.show(d.id)} aria-label={`Go full screen on ${d.name}`}>
          <Icon name="fullscreen" />
          <span>
            Full screen on <b>{d.name}</b>
          </span>
        </button>
      ))}
      {live.displays.length === 1 && <p className="stage-offer-note">One display: the picture will cover this window. ✕ or ⌘⇧L comes back.</p>}
    </div>
  );
}
