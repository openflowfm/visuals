import { useEffect, useState, type ReactNode } from 'react';
import { CameraAction } from '../Camera/Camera';
import { ActionButtonFace as ButtonFace } from '@satoramoto/zen';
import { useForm, type Forms, type Length } from '@satoramoto/zen';
import { Text } from '@satoramoto/zen';
import { titleOf } from '../HelpOverlay/HelpOverlay';
import { Icon } from '../Icon/Icon';
import { LinkPanel } from '../LinkPanel/LinkPanel';
import * as api from '../model/api';
import type { LiveState } from '../model/live-model';
import { notice } from '../model/shell';
import type { FullScreenOfferProps, StageHeadProps } from '../model/stage-model';
import { useLinkFrame } from '../model/useLive';
import { silenceWatch } from '../Onboarding/Onboarding';
import { OutputPanel } from '../OutputPanel/OutputPanel';
import { Popover } from '../Popover/Popover';
import { BeatDot, beatLabel, bpmText, Fps, linked, openSettings, outputLabel, SkipNote, TapButton } from '../Status/Status';
import { TransportAudio } from '../TransportBar/TransportBar';
import { NoticeBanner, ViewSwitch } from '../Views/Views';
import './StageHead.css';

export type StageHeadForm = 'full' | 'short';

/** The title bar's 52px. */
const TITLEBAR: Length = { space: [6, 4, 1] };

/** what the header's type needs, in the shell's header row */
export const STAGE_HEAD_FORMS: Forms<StageHeadForm> = [
  // full: the switch, the lights with their whole words, the mixer and its meter, the four glyphs — 808px, the original's 900px window less the 84px lights room and 8px right inset
  { id: 'full', min: { w: { unit: 202 }, h: TITLEBAR }, ideal: { w: { unit: 202 }, h: TITLEBAR }, grow: { w: true } },
  // short: the lights' words and the notes cut shorter, so the row keeps to one line
  { id: 'short', min: { w: { control: 10 }, h: TITLEBAR }, ideal: { w: { control: 10 }, h: TITLEBAR }, grow: { w: true } },
];

/** What ✕ is called, and its tooltip: it leaves at once, as ⌘⇧L does; Esc held does too. */
export const LEAVE_LABEL = 'Leave live';
export const LEAVE_TITLE = 'Leave live (⌘⇧L, hold Esc)';

/** The quiet word in the status area while `\` pins the controls shown. */
export const PINNED_TEXT = 'Pinned';

/** The quiet word in the status area while nothing has been heard for a few seconds. */
export const SILENT_TEXT = 'No sound';

/** What the Output light shows beside its glyph: the display the picture is on, or "In this window" while it is on none. */
export const outputWords = (live: Pick<LiveState, 'status'>): string => live.status.display?.name ?? 'In this window';

/** The header's props: Home | Live, the notes, the lights, the mixer, the camera, ?, settings and ✕ (the crate's toggle is gone with the crate). */
export type StageHeadOwnProps = Omit<StageHeadProps, 'crateOpen' | 'onCrate'> & {
  /** ✕: leave live at once. */
  onLeave(): void;
  /** `\` pins the controls shown: the status area says "Pinned". */
  pinned?: boolean;
  form?: StageHeadForm;
};

/** Figures in a light's label: tabular, at the label's size (StageHead.css matches its weight). */
function LightNum({ className, children, ...rest }: { className: string; children: ReactNode; 'aria-hidden'?: 'true' }) {
  return (
    <Text size="inherit" tabular className={`vs-stagehead-num ${className}`} {...rest}>
      {children}
    </Text>
  );
}

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
      className="vs-stagehead-light"
      name={beatLabel(frame, live.effects)}
      title={titleOf('beat')}
      align="right"
      label={
        <>
          <BeatDot frame={frame} className="vs-stagehead-beat-dot" />
          <LightNum className="vs-num">{bpm ?? '— BPM'}</LightNum>
          {peers !== null && (
            <LightNum className="vs-stagehead-light-sub vs-num" aria-hidden="true">
              <Icon name="link" size={12} />
              {peers}
            </LightNum>
          )}
        </>
      }
    >
      <div className="vs-stagehead-pop" data-pop="beat">
        <TapButton effects={live.effects} onTap={() => live.actFx({ kind: 'tap' })} />
        <LinkPanel />
      </div>
    </Popover>
  );
}

/**
 * The Output light: a dot and where the picture goes, as words, white while it is on a display and
 * grey while in this window; its popover offers "Full screen on…" each display while the picture
 * plays here, then picks the display and says how it fits.
 */
function OutputLight({ live }: { live: LiveState }) {
  const on = live.status.display != null;
  return (
    <Popover
      className="vs-stagehead-light vs-stagehead-output"
      name={outputLabel(live.status)}
      title={titleOf('output')}
      align="right"
      label={
        <>
          <span className="vs-stagehead-output-dot" data-on={on ? '' : undefined} aria-hidden="true" />
          <span className="vs-stagehead-light-text" data-on={on ? '' : undefined}>
            {outputWords(live)}
          </span>
        </>
      }
    >
      <div className="vs-stagehead-pop" data-pop="output">
        <FullScreenOffer live={live} />
        <OutputPanel status={live.status} show={live.show} />
      </div>
    </Popover>
  );
}

/** Whether nothing has been heard for a few seconds (Onboarding's `silenceWatch` over the input's levels, read four times a second). */
function useSilent(): boolean {
  const [quiet, setQuiet] = useState(false);
  useEffect(() => {
    const watch = silenceWatch();
    let on = true;
    let timer: number | undefined;
    const tick = () => {
      api.levels().then(
        ([l, r]) => {
          if (!on) return;
          setQuiet(watch.hear(Math.max(l, r), Date.now()));
          timer = window.setTimeout(tick, 250);
        },
        () => {
          if (on) timer = window.setTimeout(tick, 250);
        },
      );
    };
    tick();
    return () => {
      on = false;
      window.clearTimeout(timer);
    };
  }, []);
  return quiet;
}

/**
 * The status area's notes, before Beat, as quiet words (no toasts): the skipped presets, a low
 * frame rate, no sound, a failure (with its dismiss), a quiet state line, and "Pinned".
 */
function Notes({ live, pinned }: { live: LiveState; pinned: boolean }) {
  const silent = useSilent();
  return (
    <>
      <SkipNote className="vs-stagehead-skipped" />
      <Fps className="vs-stagehead-fps" />
      {silent && (
        <Text
          role="caption"
          leading="normal"
          className="vs-stagehead-note"
          ariaRole="status"
          data-note=""
          title="Nothing heard for a few seconds: is the music on? Pick what to listen to in the mixer"
        >
          {SILENT_TEXT}
        </Text>
      )}
      {live.error && (
        <span className="vs-stagehead-noteslot" data-note="">
          <NoticeBanner className="vs-stagehead-note vs-stagehead-notice" notice={live.error} onDismiss={live.dismiss} />
        </span>
      )}
      {live.hint && (
        <Text role="caption" leading="normal" className="vs-stagehead-note" ariaRole="status" data-note="">
          {live.hint}
        </Text>
      )}
      {pinned && (
        <Text role="caption" leading="normal" className="vs-stagehead-note" title={titleOf('panels')}>
          {PINNED_TEXT}
        </Text>
      )}
    </>
  );
}

/**
 * **Job.** The Stage's header, laid out as Home's: one row of bare type on the window buttons'
 * line, 16px in from the window's edge. On the left Home | Live, as Home's header switches them.
 * On the right the status area: quiet notes when there are any (skipped presets, a low frame rate,
 * no sound, a failure, "Pinned" while `\` pins the controls), the Beat and Output lights (a dot and
 * words; Home's popovers, not modal: live's keys keep working while one is open); a hairline; then
 * the app's icons in Home's order: the mixer with its level meter (Home's folded audio input, the
 * source chosen in its popover), the camera, ? and settings, and a quiet ✕ that leaves live. The
 * empty line between them is the title bar: a drag there moves the window. It shows and fades with
 * the controls (the shell's one overlay, StageLayout).
 *
 * **Changed.** Design C: no corner toasts. "Full screen on…" is in the Output light's popover, and
 * the notices are quiet words in the status area. The Output light has a dot, as Beat does. The
 * mixer (`TransportAudio folded`, its slow warning left to the notes) moved up from the transport.
 * The narrow window's shorter words are a form (`STAGE_HEAD_FORMS`: full → short) the assembled
 * screen picks, or the `form` prop.
 *
 * **Kept.** Every name, label, tooltip and key shortcut of the lights, ?, settings and ✕; the drag
 * region; how far the words shorten when narrow.
 */
export function StageHead({ live, help, onHelp, onView, onLeave, pinned = false, form }: StageHeadOwnProps) {
  const f = useForm(STAGE_HEAD_FORMS, form);
  return (
    <Text as="header" className="vs-stagehead" data-form={f} data-tauri-drag-region>
      <span className="vs-stagehead-switch">
        <ViewSwitch view="live" onChange={onView} />
      </span>
      <span className="vs-stagehead-fill" />
      <Notes live={live} pinned={pinned} />
      <BeatLight live={live} />
      <OutputLight live={live} />
      <span className="vs-stagehead-rule" aria-hidden="true" />
      <span className="vs-stagehead-tools">
        <TransportAudio onAudioError={(e) => live.setError(notice("Couldn't use that audio input.", e))} folded slow={false} />
        <CameraAction className="vs-stagehead-tool" />
        <ButtonFace tone="quiet" className="vs-stagehead-tool" aria-label="Help" aria-haspopup="dialog" aria-expanded={help} aria-keyshortcuts="?" title={titleOf('help')} onClick={onHelp}>
          <Icon name="help" />
        </ButtonFace>
        <ButtonFace tone="quiet" className="vs-stagehead-tool" aria-label="Settings" aria-haspopup="dialog" aria-keyshortcuts="Meta+," title={`${titleOf('settings')} (⌘,)`} onClick={openSettings}>
          <Icon name="gear" />
        </ButtonFace>
        <ButtonFace tone="quiet" className="vs-stagehead-tool vs-stagehead-leave" aria-label={LEAVE_LABEL} aria-keyshortcuts="Meta+Shift+L" title={LEAVE_TITLE} onClick={onLeave}>
          <Icon name="close" />
        </ButtonFace>
      </span>
    </Text>
  );
}
StageHead.forms = STAGE_HEAD_FORMS;

/**
 * **Job.** "Full screen on…", at the top of the Output light's popover while the picture plays in
 * the window (as it does on the way in: live never opens the output by itself): a button for each
 * display, and with only one the note that the picture will cover this window. Nothing while the
 * output is on a display, or before the displays are known.
 *
 * **Changed.** Design C: no longer a corner toast over the picture: the popover's panel is its
 * surface, so it paints none of its own; caption type, each display's button a quiet `ButtonFace`.
 *
 * **Kept.** The group's name and tooltip, the buttons' names and the note.
 */
export function FullScreenOffer({ live }: FullScreenOfferProps) {
  if (!live.inWindow || !live.displays?.length) return null;
  return (
    <Text as="div" size="caption" leading="normal" className="vs-stagehead-offer" ariaRole="group" aria-label="Go full screen" title={titleOf('fullscreen')}>
      {live.displays.map((d) => (
        <ButtonFace key={d.id} tone="quiet" className="vs-stagehead-offer-go" onClick={() => live.show(d.id)} aria-label={`Go full screen on ${d.name}`}>
          <Icon name="fullscreen" size={14} />
          <span>
            Full screen on{' '}
            <Text as="b" size="inherit" weight="strong" leading="tight" className="vs-stagehead-offer-name">
              {d.name}
            </Text>
          </span>
        </ButtonFace>
      ))}
      {live.displays.length === 1 && (
        <Text as="p" size="caption" className="vs-stagehead-offer-note">
          One display: the picture will cover this window. ✕ or ⌘⇧L comes back.
        </Text>
      )}
    </Text>
  );
}
