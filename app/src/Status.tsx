import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ButtonFace } from '@openflow/widgets/controls/ButtonFace.tsx';
import * as api from './api.ts';
import { control } from './HelpOverlay.tsx';
import * as link from './link.ts';
import type * as fx from './fx.ts';
import type * as output from './output.ts';
import { AudioInput } from './AudioInput.tsx';
import { LinkPanel } from './LinkPanel.tsx';
import { OutputPanel } from './OutputPanel.tsx';
import { plural } from './controls.ts';
import { useTauriEvent } from './hooks.ts';
import { meterLevel } from './shell.ts';
import { openSheet } from './views.tsx';
import { say, Say } from './words.ts';

/** Below this many frames a second the strip says how many the picture draws. */
export const FPS_SHOWN_BELOW = 50;

/** How much of each beat the BEAT light stays lit, from the start of the beat. */
export const BEAT_LIT = 0.15;

/** What the strip says about the frame rate: "<n> fps" while it is low, nothing while it is fine or before a first reading. */
export function fpsShown(fps: number): string | null {
  return Number.isFinite(fps) && fps > 0 && fps < FPS_SHOWN_BELOW ? `${Math.round(fps)} fps` : null;
}

/** Whether the BEAT light is lit at `now`: the first part of each beat, run on from the last frame at its tempo. */
export function beatLit(frame: link.Frame | null, now: number): boolean {
  if (!frame || !(frame.tempo > 0)) return false;
  const beat = frame.beat + Math.max(0, now - frame.at) * (frame.tempo / 60000);
  return beat - Math.floor(beat) < BEAT_LIT;
}

/** Whether the tempo is a Link session's: on the network with someone else in it. */
const linked = (frame: link.Frame | null): frame is link.Frame => frame !== null && frame.enabled && frame.peers > 0;

/** The tempo the BEAT light shows: a Link session's when there is one, otherwise the effects' tempo; null before either is known. */
export function bpmText(frame: link.Frame | null, effects: fx.Fx | null): string | null {
  if (linked(frame)) return `${Math.round(frame.tempo)} BPM`;
  return effects && effects.bpm > 0 ? `${Math.round(effects.bpm)} BPM` : null;
}

/** "· N in time" while others in a Link session keep the tempo; nothing otherwise. */
export function peersText(frame: link.Frame | null): string | null {
  return linked(frame) ? `· ${frame.peers} in time` : null;
}

/** Where the picture goes, for the OUTPUT light's name: the display it is on, or that it is only in this window. */
export function outputText(status: output.Status): { on: boolean; text: string } {
  return status.display ? { on: true, text: `on ${status.display.name}` } : { on: false, text: 'in this window' };
}

/** What the OUTPUT light shows beside its dot: nothing while the picture is on a display (its name is in the popover), "in this window" while it isn't. */
export const outputShown = (status: output.Status): string | null => (status.display ? null : outputText(status).text);

/** The tap button's name: what sets the tempo, and what it is. "Tap tempo, 120 BPM (T)". */
export const tempoLabel = (linked: boolean, bpm: number | null): string => `${linked ? 'Link' : 'Tap'} tempo${bpm !== null && bpm > 0 ? `, ${Math.round(bpm)} BPM` : ''} (${control('tempo').keys})`;

/**
 * Tap tempo, at the top of the BEAT light's popover: tapped in time, or lit
 * (not pressed) while Link keeps the tempo. T taps it from anywhere in live mode.
 */
export function TapButton({ effects, onTap }: { effects: fx.Fx | null; onTap(): void }) {
  const linked = effects?.linked === true;
  const bpm = effects?.bpm ?? null;
  return (
    <ButtonFace className="live-tap" lit={linked} aria-label={tempoLabel(linked, bpm)} title={`${control('tempo').does} (${control('tempo').keys})`} onClick={onTap}>
      {linked ? 'Link' : 'Tap'}
      {bpm !== null && bpm > 0 && <b>{Math.round(bpm)}</b>}
      <small aria-hidden="true">{control('tempo').keys}</small>
    </ButtonFace>
  );
}

/** The strip's ⚙: the Settings sheet, over live mode (it takes Esc while open). */
export const openSettings = () => openSheet('settings');

/** A popover the strip can open, one at a time. */
type Pop = 'audio' | 'beat' | 'output';

type Titles = Partial<Record<'audio' | 'beat' | 'output' | 'help' | 'settings' | 'leave', string>>;

/** How long the meter stays at nothing before the AUDIO light is called silent (a gap between notes isn't silence). */
export const SILENT_AFTER = 1000;

/** What VoiceOver calls the AUDIO light: "Audio, hearing" or "Audio, silent". */
export const audioLabel = (hearing: boolean): string => `Audio, ${hearing ? 'hearing' : 'silent'}`;

/** Whether the AUDIO light is hearing at `now`, given when the meter last showed anything (`heard`, ms; null: never). */
export const hearingAt = (heard: number | null, now: number): boolean => heard !== null && now - heard < SILENT_AFTER;

/**
 * The AUDIO light's dot and mini meter. A leaf of its own: it re-renders up to
 * twenty times a second, and the strip doesn't have to; it tells the strip
 * (`onHearing`) only when it turns from hearing to silent or back.
 */
function AudioLevel({ onHearing }: { onHearing(hearing: boolean): void }) {
  const [level, setLevel] = useState(0);
  const said = useRef(onHearing);
  said.current = onHearing;
  useEffect(() => {
    let live = true;
    let heard: number | null = null;
    let was = false;
    const tick = async () => {
      while (live) {
        const [l, r] = await api.levels().catch(() => [0, 0] as [number, number]);
        if (!live) return;
        const now = Date.now();
        const shown = meterLevel(Math.max(l, r));
        if (shown > 0) heard = now;
        const hearing = hearingAt(heard, now);
        if (hearing !== was) said.current((was = hearing));
        // Silence stays silent without a render.
        setLevel(shown);
        await new Promise((done) => setTimeout(done, 60));
      }
    };
    tick();
    return () => {
      live = false;
    };
  }, []);
  return (
    <>
      <span className="live-status-dot" data-on={level > 0 ? '' : undefined} aria-hidden="true" />
      <span className="live-status-meter" aria-hidden="true">
        <span style={{ width: `${(level * 100).toFixed(0)}%` }} />
      </span>
    </>
  );
}

/** The BEAT light's dot: lit at the start of each beat. Its own leaf, checked every animation frame, re-rendering only when it turns on or off. */
function BeatDot({ frame }: { frame: link.Frame | null }) {
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
  return <span className="live-status-dot" data-on={lit ? '' : undefined} aria-hidden="true" />;
}

/** The frame rate, read once a second and shown only while it is low. Its own leaf, so a reading re-renders nothing else. */
function Fps() {
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
    <span className="live-status-fps" title="the picture is drawing fewer frames a second than usual: try a simpler preset or close other apps">
      {shown}
    </span>
  );
}

/** How long the skipped note stays after the last skip before it starts to fade (ms). */
export const SKIP_SHOWN_FOR = 4000;
/** How long the skipped note takes to fade (ms); `live.css` fades it over the same time. */
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
 * The note that next, previous, random or auto-advance skipped a preset that
 * won't load (decision 60): skips in quick succession counted into one line,
 * which fades a few seconds after the last; when stepping past presets that
 * won't draw stops, it says that instead, and fades the same way. Its own leaf; the polite live region
 * is always there (empty while nothing is said), so VoiceOver reads each new count.
 * In a narrow window it takes only the room the strip has left, wrapping onto a
 * second line and then cutting short (`live.css`); its tooltip says it whole.
 */
export function SkipNote() {
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
    <span className="live-status-skipped" role="status" aria-live="polite" title={text || undefined} data-fading={phase === 'fading' ? '' : undefined}>
      {text}
    </span>
  );
}

/** What VoiceOver calls the BEAT light: "Beat, 120 BPM, 2 in time"; the tempo and who keeps it, without the dot. */
export function beatLabel(frame: link.Frame | null, effects: fx.Fx | null): string {
  const bpm = bpmText(frame, effects);
  return ['Beat', bpm, linked(frame) ? `${frame.peers} in time` : null].filter(Boolean).join(', ');
}

/** What VoiceOver calls the OUTPUT light: "Output, on Projector". */
export const outputLabel = (status: output.Status): string => `Output, ${outputText(status).text}`;

/** One light: what it shows, without a caption (its name is its accessible label), and the popover it opens under it (a dialog, but not modal: Esc or a click elsewhere closes it). */
function Light({
  name,
  label,
  popName,
  title,
  on,
  open,
  toggle,
  children,
  pop,
}: {
  name: Pop;
  /** Its accessible name: short, with what it shows; `title` is the longer tooltip. */
  label: string;
  /** The popover's name. */
  popName: string;
  title: string;
  on?: boolean;
  open: boolean;
  toggle(name: Pop): void;
  children: ReactNode;
  pop: ReactNode;
}) {
  const id = `live-status-pop-${name}`;
  return (
    <span className="live-status-item">
      <button
        type="button"
        className="live-status-light"
        data-light={name}
        data-on={on ? '' : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? id : undefined}
        aria-label={label}
        title={title}
        onClick={() => toggle(name)}
      >
        {children}
      </button>
      {open && (
        <div className="live-status-pop" id={id} data-pop={name} role="dialog" aria-label={popName}>
          {pop}
        </div>
      )}
    </span>
  );
}

/**
 * Live mode's top row, lights without captions (VoiceOver reads each one's
 * name): what it listens to (a dot and a meter), the beat (a dot flashing on
 * each one, and the tempo), where the picture goes (a dot, with words only while
 * it is not on a display), the frame rate when it is low, help and settings on
 * the right, and leave apart from them. Each light opens its panel under it —
 * the source picker, tap tempo and Ableton Link, the output — one at a time;
 * Esc or a click elsewhere puts it away without leaving live mode.
 */
export function Status({
  output,
  show,
  effects,
  onHelp,
  onLeave,
  onError,
  onTap = () => {},
  titles = {},
}: {
  output: output.Status;
  show(id: number | null): void;
  effects: fx.Fx | null;
  onHelp(): void;
  /** Tap tempo, from the BEAT popover's Tap button. */
  onTap?(): void;
  onLeave(): void;
  onError(e: unknown): void;
  titles?: Titles;
}) {
  const [open, setOpen] = useState<Pop | null>(null);
  const [frame, setFrame] = useState<link.Frame | null>(null);
  const [hearing, setHearing] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    link.state().then(
      (f) => live && setFrame((was) => was ?? f),
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);
  useTauriEvent(link.onFrame, setFrame);

  // Esc closes the popover before live mode's own Esc handler sees it (that one skips prevented events); a press outside the strip closes it too.
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      // Focus inside the popover goes back to its light, rather than to the page when the popover goes.
      const pop = root.current?.querySelector('.live-status-pop');
      if (pop && document.activeElement && pop.contains(document.activeElement)) root.current?.querySelector<HTMLElement>(`[data-light="${open}"]`)?.focus();
      setOpen(null);
    };
    const press = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener('keydown', key, { capture: true });
    window.addEventListener('pointerdown', press, { capture: true });
    return () => {
      window.removeEventListener('keydown', key, { capture: true });
      window.removeEventListener('pointerdown', press, { capture: true });
    };
  }, [open]);

  const toggle = (name: Pop) => setOpen((was) => (was === name ? null : name));
  const bpm = bpmText(frame, effects);
  const out = outputText(output);
  const shown = outputShown(output);
  const peersTitle = linked(frame) ? ` · ${plural(frame.peers, 'other')} in the session` : '';

  return (
    <div className="live-status-strip" ref={root}>
      <Light
        name="audio"
        label={audioLabel(hearing)}
        popName={`What it will ${say('audio input')}`}
        title={titles.audio ?? `${Say('audio input')}: what the presets hear, and its level`}
        open={open === 'audio'}
        toggle={toggle}
        pop={<AudioInput onError={onError} />}
      >
        <AudioLevel onHearing={setHearing} />
      </Light>
      <Light
        name="beat"
        label={beatLabel(frame, effects)}
        popName={`Tempo, and ${say('Ableton Link')}`}
        title={(titles.beat ?? `the beat: tap the tempo, or ${say('Ableton Link')}`) + peersTitle}
        open={open === 'beat'}
        toggle={toggle}
        pop={
          <>
            <TapButton effects={effects} onTap={onTap} />
            <LinkPanel />
          </>
        }
      >
        <BeatDot frame={frame} />
        {bpm && <span className="live-status-value">{bpm}</span>}
      </Light>
      <Light
        name="output"
        label={outputLabel(output)}
        popName="Where the picture goes"
        title={titles.output ?? 'where the picture goes: a display, or only this window'}
        on={out.on}
        open={open === 'output'}
        toggle={toggle}
        pop={<OutputPanel status={output} show={show} />}
      >
        <span className="live-status-dot" data-on={out.on ? '' : undefined} data-warn={out.on ? undefined : ''} aria-hidden="true" />
        {shown && <span className="live-status-value">{shown}</span>}
      </Light>
      <Fps />
      <SkipNote />
      <span className="live-status-end">
        <button
          type="button"
          className="live-status-btn"
          aria-label="Help"
          aria-haspopup="dialog"
          aria-keyshortcuts="?"
          title={titles.help ?? 'help: what every key does'}
          onClick={() => (setOpen(null), onHelp())}
        >
          <span aria-hidden="true">?</span>
        </button>
        <button type="button" className="live-status-btn" aria-label="Settings" aria-haspopup="dialog" title={titles.settings ?? 'settings'} onClick={() => (setOpen(null), openSettings())}>
          <span aria-hidden="true">⚙</span>
        </button>
      </span>
      {/* ✕ stands apart from ? and ⚙, so a click meant for them doesn't leave live. */}
      <span className="live-status-leave">
        <button
          type="button"
          className="live-status-btn"
          aria-label="Leave live"
          aria-keyshortcuts="Escape Meta+Shift+L"
          title={titles.leave ?? 'leave live mode'}
          onClick={() => (setOpen(null), onLeave())}
        >
          <span aria-hidden="true">✕</span>
        </button>
      </span>
    </div>
  );
}
