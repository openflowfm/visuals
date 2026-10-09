import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as api from './api.ts';
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

/** What the OUTPUT light says: the display the picture is on, or that it is only in this window. */
export function outputText(status: output.Status): { on: boolean; text: string } {
  return status.display ? { on: true, text: `on ${status.display.name}` } : { on: false, text: 'in this window' };
}

/** The strip's ⚙: the Settings sheet, over live mode (it takes Esc while open). */
export const openSettings = () => openSheet('settings');

/** A popover the strip can open, one at a time. */
type Pop = 'audio' | 'beat' | 'output';

type Titles = Partial<Record<'audio' | 'beat' | 'output' | 'help' | 'settings' | 'leave', string>>;

/** The AUDIO light's dot and mini meter. A leaf of its own: it re-renders up to twenty times a second, and the strip doesn't have to. */
function AudioLevel() {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    let live = true;
    const tick = async () => {
      while (live) {
        const [l, r] = await api.levels().catch(() => [0, 0] as [number, number]);
        if (!live) return;
        // Silence stays silent without a render.
        setLevel(meterLevel(Math.max(l, r)));
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

/** What VoiceOver calls the BEAT light: "Beat, 120 BPM, 2 in time"; the tempo and who keeps it, without the dot. */
export function beatLabel(frame: link.Frame | null, effects: fx.Fx | null): string {
  const bpm = bpmText(frame, effects);
  return ['Beat', bpm, linked(frame) ? `${frame.peers} in time` : null].filter(Boolean).join(', ');
}

/** What VoiceOver calls the OUTPUT light: "Output, on Projector". */
export const outputLabel = (status: output.Status): string => `Output, ${outputText(status).text}`;

/** One light: a caption, what it shows, and the popover it opens under it (a dialog, but not modal: Esc or a click elsewhere closes it). */
function Light({
  name,
  caption,
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
  caption: string;
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
        <i aria-hidden="true">{caption}</i>
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
 * Live mode's top row: what it listens to (AUDIO, with a meter), the beat
 * (BEAT, flashing on each one, with the tempo and who keeps it), where the
 * picture goes (OUTPUT), the frame rate when it is low, and help, settings and
 * leave on the right. Each light opens its panel under it — the source picker,
 * Ableton Link, the output — one at a time; Esc or a click elsewhere puts it
 * away without leaving live mode.
 */
export function Status({
  output,
  show,
  effects,
  onHelp,
  onLeave,
  onError,
  titles = {},
}: {
  output: output.Status;
  show(id: number | null): void;
  effects: fx.Fx | null;
  onHelp(): void;
  onLeave(): void;
  onError(e: unknown): void;
  titles?: Titles;
}) {
  const [open, setOpen] = useState<Pop | null>(null);
  const [frame, setFrame] = useState<link.Frame | null>(null);
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
  const peers = peersText(frame);
  const out = outputText(output);
  const peersTitle = linked(frame) ? ` · ${plural(frame.peers, 'other')} in the session` : '';

  return (
    <div className="live-status-strip" ref={root}>
      <Light
        name="audio"
        caption="AUDIO"
        label="Audio"
        popName={`What it will ${say('audio input')}`}
        title={titles.audio ?? `${Say('audio input')}: what the presets hear, and its level`}
        open={open === 'audio'}
        toggle={toggle}
        pop={<AudioInput onError={onError} />}
      >
        <AudioLevel />
      </Light>
      <Light
        name="beat"
        caption="BEAT"
        label={beatLabel(frame, effects)}
        popName={Say('Ableton Link')}
        title={(titles.beat ?? `the beat, and ${say('Ableton Link')}`) + peersTitle}
        open={open === 'beat'}
        toggle={toggle}
        pop={<LinkPanel />}
      >
        <BeatDot frame={frame} />
        {bpm && <span className="live-status-value">{bpm}</span>}
        {peers && <span className="live-status-peers">{peers}</span>}
      </Light>
      <Light
        name="output"
        caption="OUTPUT"
        label={outputLabel(output)}
        popName="Where the picture goes"
        title={titles.output ?? 'where the picture goes: a display, or only this window'}
        on={out.on}
        open={open === 'output'}
        toggle={toggle}
        pop={<OutputPanel status={output} show={show} />}
      >
        <span className="live-status-dot" data-on={out.on ? '' : undefined} data-warn={out.on ? undefined : ''} aria-hidden="true" />
        <span className="live-status-value">{out.text}</span>
      </Light>
      <Fps />
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
