import { useEffect, useRef, useState } from 'react';
import { ActionButtonFace as ButtonFace } from '@satoramoto/zen';
import { Text } from '@satoramoto/zen';
import * as api from '../model/api';
import { plural } from '../model/controls';
import type * as fx from '../model/fx';
import { useTauriEvent } from '../model/hooks';
import type * as link from '../model/link';
import type * as output from '../model/output';
import { say, Say } from '../model/words';
import { control } from '../HelpOverlay/HelpOverlay';
import { openSheet } from '../Views/Views';
import './Status.css';

// A port of visual[flow]'s `app/src/Status.tsx`: the live status readouts (the beat, the
// tempo, the output, the frame rate, the skipped note) with the same exports and words.
// Changed throughout: each leaf wears its own `vs-status-*` class (numerals tabular, green
// only for the signal) beside the caller's `className`, which still places it.

const cls = (own: string, theirs?: string) => (theirs ? `${own} ${theirs}` : own);

/** Below this many frames a second the Stage's header says how many the picture draws. */
export const FPS_SHOWN_BELOW = 50;

/** How much of each beat the beat dot stays lit, from the start of the beat. */
export const BEAT_LIT = 0.15;

/** What the header says about the frame rate: "<n> fps" while it is low, nothing while it is fine or before a first reading. */
export function fpsShown(fps: number): string | null {
  return Number.isFinite(fps) && fps > 0 && fps < FPS_SHOWN_BELOW ? `${Math.round(fps)} fps` : null;
}

/** Whether the beat dot is lit at `now`: the first part of each beat, run on from the last frame at its tempo. */
export function beatLit(frame: link.Frame | null, now: number): boolean {
  if (!frame || !(frame.tempo > 0)) return false;
  const beat = frame.beat + Math.max(0, now - frame.at) * (frame.tempo / 60000);
  return beat - Math.floor(beat) < BEAT_LIT;
}

/** Whether the tempo is a Link session's: on the network with someone else in it. */
export const linked = (frame: link.Frame | null): frame is link.Frame => frame !== null && frame.enabled && frame.peers > 0;

/** The tempo shown: a Link session's when there is one, otherwise the effects' tempo; null before either is known. */
export function bpmText(frame: link.Frame | null, effects: fx.Fx | null): string | null {
  if (linked(frame)) return `${Math.round(frame.tempo)} BPM`;
  return effects && effects.bpm > 0 ? `${Math.round(effects.bpm)} BPM` : null;
}

/** Where the picture goes: the display it is on, or that it is only in this window. */
export function outputText(status: output.Status): { on: boolean; text: string } {
  return status.display ? { on: true, text: `on ${status.display.name}` } : { on: false, text: 'in this window' };
}

/** The tap button's name: what sets the tempo, and what it is. "Tap tempo, 120 BPM (T)". */
export const tempoLabel = (linked: boolean, bpm: number | null): string => `${linked ? 'Link' : 'Tap'} tempo${bpm !== null && bpm > 0 ? `, ${Math.round(bpm)} BPM` : ''} (${control('tempo').keys})`;

/** What the tap key says on its face: what a press does, or that Link keeps the tempo (a tap does nothing then). */
export const tapWords = (linked: boolean): string => (linked ? 'Tempo from Link' : 'Tap in time');

/**
 * **Job.** Tap tempo, at the top of the beat popover, as a key: what a press does on the left, the
 * tempo and T's keycap on the right; lit (not pressed) while Link keeps the tempo. T taps it from
 * anywhere in live mode.
 *
 * **Changed.** The core `ButtonFace`, widened to fill its line as a soft tint (no key bevel, as the
 * Stage's popover drew it); lit is an accent wash, since Link keeping the tempo is a state, not
 * the signal. The tempo is a tabular numeral in the readout face.
 *
 * **Kept.** Its accessible name, tooltip, words and keycap; `lit` while linked.
 */
export function TapButton({ effects, onTap }: { effects: fx.Fx | null; onTap(): void }) {
  const linked = effects?.linked === true;
  const bpm = effects?.bpm ?? null;
  return (
    <ButtonFace className="vs-status-tap" lit={linked} aria-label={tempoLabel(linked, bpm)} title={`${control('tempo').does} (${control('tempo').keys})`} onClick={onTap}>
      <Text leading="tight" className="vs-status-tap-what">
        {tapWords(linked)}
      </Text>
      <Text leading="tight" className="vs-status-tap-bpm">
        <Text as="b" role="numeral" size="heading" className="vs-status-tap-num">
          {bpm !== null && bpm > 0 ? Math.round(bpm) : '—'}
        </Text>{' '}
        BPM
      </Text>
      <Text as="kbd" weight="strong" leading="tight" className="vs-status-tap-key" aria-hidden="true">
        {control('tempo').keys}
      </Text>
    </ButtonFace>
  );
}

/** ⚙: the Settings sheet, over live mode (it takes Esc while open). */
export const openSettings = () => openSheet('settings');

/**
 * **Job.** The beat dot: lit at the start of each beat. Its own leaf, checked every animation
 * frame, re-rendering only when it turns on or off.
 *
 * **Changed.** Its own `vs-status-beat` look: a dot in the faint step, the signal's green while
 * lit (the beat is the signal). It shows or goes at once (no motion).
 *
 * **Kept.** The check every animation frame, `data-on`, `aria-hidden`.
 */
export function BeatDot({ frame, className }: { frame: link.Frame | null; className: string }) {
  const [lit, setLit] = useState(false);
  const latest = useRef(frame);
  latest.current = frame;
  useEffect(() => {
    let id = 0;
    const tick = () => {
      setLit(beatLit(latest.current, Date.now()));
      id = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(id);
  }, []);
  return <span className={cls('vs-status-beat', className)} data-on={lit ? '' : undefined} aria-hidden="true" />;
}

/**
 * **Job.** The frame rate, read once a second and shown only while it is low. Its own leaf, so a
 * reading re-renders nothing else.
 *
 * **Changed.** Tabular figures in the readout face, in caution (`--warning`): it only shows when
 * something is wrong.
 *
 * **Kept.** The polling, the threshold, the words and tooltip.
 */
export function Fps({ className }: { className: string }) {
  const [fps, setFps] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => {
      api.stats().then(
        (s) => setFps(Math.round(s.fps)),
        () => {},
      );
    }, 1000);
    return () => window.clearInterval(t);
  }, []);
  const shown = fpsShown(fps);
  if (!shown) return null;
  return (
    <Text role="caption" leading="normal" tabular className={cls('vs-status-fps', className)} title="the picture is drawing fewer frames a second than usual: try a simpler preset or close other apps">
      {shown}
    </Text>
  );
}

/** How long the skipped note stays after the last skip before it starts to fade (ms). */
export const SKIP_SHOWN_FOR = 4000;
/** How long the skipped note takes to fade (ms); its CSS fades it over the same time. */
export const SKIP_FADE = 1000;

/** The skipped note: how many broken presets were skipped since it showed, and when the last one was (ms). */
export interface Skips {
  count: number;
  at: number;
  /** Stepping stopped (`resume::STOPPED`) after this many presets in a row wouldn't draw; the note says so until the next skip. */
  stopped?: number;
}

/** A skip at `now`: counted into the note while it is still up (fading or not), a new note of one once it has gone. */
export const addSkip = (was: Skips | null, now: number): Skips => ({ count: was && skipPhase(was, now) !== 'gone' ? was.count + 1 : 1, at: now });

/** Stepping stopped at `now` after `inARow` presets wouldn't draw: the note says so, and the stop isn't counted as a skip. */
export const addStop = (was: Skips | null, now: number, inARow: number): Skips => ({ count: was && skipPhase(was, now) !== 'gone' ? was.count : 0, at: now, stopped: inARow });

/** Where the note is at `now`: up, fading, or gone. */
export function skipPhase(note: Skips | null, now: number): 'shown' | 'fading' | 'gone' {
  if (!note) return 'gone';
  const since = now - note.at;
  return since < SKIP_SHOWN_FOR ? 'shown' : since < SKIP_SHOWN_FOR + SKIP_FADE ? 'fading' : 'gone';
}

/** When the note next changes phase, from its last skip (ms); null once it has gone. */
export function skipNextChange(note: Skips | null, now: number): number | null {
  const phase = skipPhase(note, now);
  if (!note || phase === 'gone') return null;
  return note.at + SKIP_SHOWN_FOR + (phase === 'fading' ? SKIP_FADE : 0);
}

/** The note's words: "Skipped 1 broken preset", "Skipped 3 broken presets". */
export const skipText = (count: number): string => `Skipped ${plural(count, say('failed preset'))}`;

/** The note's words once stepping stopped: "Stopped skipping: 8 presets in a row wouldn't draw". */
export const stopText = (inARow: number): string => `${Say('skip budget spent')}: ${plural(inARow, 'preset')} ${say('skip budget why')}`;

/** What the note says: that stepping stopped, or how many were skipped. */
export const noteText = (note: Skips): string => (note.stopped !== undefined ? stopText(note.stopped) : skipText(note.count));

/**
 * **Job.** The note that next, previous, random or auto-advance skipped a preset that won't load
 * (decision 60): skips in quick succession counted into one line, which fades a few seconds after
 * the last; when stepping past presets that won't draw stops, it says that instead, and fades the
 * same way. Its own leaf; the polite live region is always there (empty while nothing is said), so
 * VoiceOver reads each new count. Its tooltip says it whole, for when a narrow header cuts it short.
 *
 * **Changed.** Its own `vs-status-skip` look: a caution caption, tabular counts, cut with an
 * ellipsis. Its fade is kept (the principles' one exception, a hint's fade).
 *
 * **Kept.** The counting, the phases and timers, the live region, the words.
 */
export function SkipNote({ className }: { className: string }) {
  const [note, setNote] = useState<Skips | null>(null);
  const [now, setNow] = useState(0);
  useTauriEvent(api.onPresetSkipped, () => {
    const t = Date.now();
    setNote((was) => addSkip(was, t));
    setNow(t);
  });
  useTauriEvent(api.onSkippingStopped, (inARow) => {
    const t = Date.now();
    setNote((was) => addStop(was, t, inARow));
    setNow(t);
  });
  useEffect(() => {
    const next = skipNextChange(note, now);
    if (next === null) return;
    const t = window.setTimeout(() => setNow(Date.now()), Math.max(0, next - now));
    return () => window.clearTimeout(t);
  }, [note, now]);
  const phase = skipPhase(note, now);
  const text = note && phase !== 'gone' ? noteText(note) : '';
  return (
    <Text
      role="caption"
      leading="normal"
      tabular
      className={cls('vs-status-skip', className)}
      ariaRole="status"
      aria-live="polite"
      title={text || undefined}
      data-fading={phase === 'fading' ? '' : undefined}
    >
      {text}
    </Text>
  );
}

/** What VoiceOver calls the beat button: "Beat, 120 BPM, 2 in time"; the tempo and who keeps it, without the dot. */
export function beatLabel(frame: link.Frame | null, effects: fx.Fx | null): string {
  const bpm = bpmText(frame, effects);
  return ['Beat', bpm, linked(frame) ? `${frame.peers} in time` : null].filter(Boolean).join(', ');
}

/** What VoiceOver calls the output button: "Output, on Projector". */
export const outputLabel = (status: output.Status): string => `Output, ${outputText(status).text}`;
