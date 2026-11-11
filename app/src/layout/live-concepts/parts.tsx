import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import * as api from '../../api.ts';
import { refresh, setMotion, useMotion } from '../../access.ts';
import * as fx from '../../fx.ts';
import { padKey, titleOf, type ControlId } from '../../HelpOverlay.tsx';
import { playsFrom } from '../../home.ts';
import { useNotice, useTauriEvent } from '../../hooks.ts';
import * as link from '../../link.ts';
import { LinkPanel } from '../../LinkPanel.tsx';
import { intensityOf, keyOf, openEffects, padLabel, playsWindowed, ratingOf, sendIntensity, starred, starsText, whenText, whereText } from '../../Live.tsx';
import { REDUCE_HINT, ReduceFlashing, WARNING_TEXT } from '../../Onboarding.tsx';
import * as output from '../../output.ts';
import { OutputPanel } from '../../OutputPanel.tsx';
import * as pl from '../../playlists.ts';
import { Popover } from '../../Popover.tsx';
import { nameOf, notice } from '../../shell.ts';
import { bpmText, outputText, TapButton } from '../../Status.tsx';
import { say, Say } from '../../words.ts';
import type { TransportBarProps } from '../TransportBar.tsx';
import { Glyph, type GlyphName } from './glyphs.tsx';
import './parts.css';

/**
 * Live's functions as parts in Home's language, shared by the Live view's
 * concepts (`Live/Concepts`, stories only). The state is Live.tsx's, read the
 * same way from the same commands (the stories' fake app serves them), so a
 * concept's pads, intensity, crate and lights really act; only the look is new.
 * Nothing here is imported by the app.
 */

/** Everything a concept shows and does: Live.tsx's state and actions. */
export interface LiveState {
  lists: pl.Lists | null;
  deck: pl.Deck | null;
  /** The preset playing's path. */
  current: string | null;
  held: boolean;
  effects: fx.Fx | null;
  /** Where the output is. */
  status: output.Status;
  displays: output.Display[] | null;
  /** Playing in the window: no output open on a display. */
  inWindow: boolean;
  data: api.LibraryData | null;
  rows: api.LibraryRow[];
  frame: link.Frame | null;
  star: boolean;
  rating: number | null;
  says: pl.NextSays;
  up: pl.Up | null;
  error: ReturnType<typeof useNotice>['notice'];
  dismiss(): void;
  setError: ReturnType<typeof useNotice>['set'];
  act(action: pl.Action): void;
  actFx(action: fx.FxAction): void;
  show(id: number | null): void;
  /** The Intensity fader's position, 0–1. */
  intensity: number;
  setIntensity(v: number): void;
  favourite(): void;
  setLists(l: pl.Lists): void;
}

/** Live.tsx's state, read and followed as it reads it; `windowed` plays in the window (the welcome flow's way in, or `live-windowed`). */
export function useLive({ windowed = false }: { windowed?: boolean } = {}): LiveState {
  const [lists, setLists] = useState<pl.Lists | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const { notice: error, set: setError, fail, dismiss } = useNotice();
  const [status, setStatus] = useState<output.Status>({ display: null, size: null });
  const [displays, setDisplays] = useState<output.Display[] | null>(null);
  const [effects, setEffects] = useState<fx.Fx | null>(null);
  const [data, setData] = useState<api.LibraryData | null>(null);
  const [rows, setRows] = useState<api.LibraryRow[]>([]);
  const [frame, setFrame] = useState<link.Frame | null>(null);

  const held = (effects?.hold ?? lists?.deck.hold) === true;
  const heldNow = useRef(held);
  heldNow.current = held;

  const show = useCallback((id: number | null) => void output.open(id).then(setStatus, fail("Couldn't show the output on that display.")), [fail]);

  useEffect(() => {
    let gone = false;
    output.displays().then(
      (ds) => {
        if (gone) return;
        setDisplays(ds);
        if (!playsWindowed(windowed, ds)) show(null);
      },
      () => {},
    );
    fx.state().then(setEffects, fail("Couldn't read the effects."));
    link.state().then(
      (f) => !gone && setFrame((was) => was ?? f),
      () => {},
    );
    api.libraryData().then(setData, () => {});
    api.libraryIndex().then(setRows, () => {});
    pl.lists().then((l) => {
      if (gone) return;
      setLists(l);
      setCurrent((c) => c ?? l.deck.current);
    }, fail("Couldn't read the playlists."));
    return () => {
      gone = true;
    };
  }, [show, fail, windowed]);
  useTauriEvent(output.onStatus, setStatus);
  useTauriEvent(fx.onFx, setEffects);
  useTauriEvent(link.onFrame, setFrame);
  useTauriEvent(api.onLibraryChanged, setData);
  useTauriEvent(pl.onLists, setLists);
  useTauriEvent(pl.onLive, (now) => {
    setLists((l) => (l ? { ...l, deck: now.deck } : l));
    if (now.path) setCurrent(now.path);
  });

  const act = useCallback(
    (action: pl.Action) =>
      void pl.act(action).catch((e) => setError(heldNow.current && action.kind !== 'go' ? notice('HOLD is on, so the preset stays — press H to let go.', e) : notice("Couldn't play that.", e))),
    [setError],
  );
  const actFx = useCallback((action: fx.FxAction) => void fx.act(action).catch(fail("Couldn't change that effect.")), [fail]);
  const key = useMemo(() => keyOf(rows, current), [rows, current]);
  const star = starred(data, key);
  const favourite = useCallback(() => {
    if (!key) return;
    api.librarySet([key], { star: !star }).then(setData, fail("Couldn't star that preset."));
  }, [key, star, fail]);
  const intensity = intensityOf(effects?.sensitivity ?? 1);
  const setIntensity = useCallback(
    (v: number) => {
      setEffects((e) => (e ? { ...e, sensitivity: 0.5 * 4 ** v } : e));
      sendIntensity(v).catch(fail("Couldn't change the intensity."));
    },
    [fail],
  );

  return {
    lists,
    deck: lists?.deck ?? null,
    current,
    held,
    effects,
    status,
    displays,
    inWindow: status.display === null && displays !== null,
    data,
    rows,
    frame,
    star,
    rating: ratingOf(data, key),
    says: pl.nextSays(lists, held),
    up: pl.upNext(lists),
    error,
    dismiss,
    setError,
    act,
    actFx,
    show,
    intensity,
    setIntensity,
    favourite,
    setLists,
  };
}

/** The deck's way of saying how long a preset plays, for the transport's time: its seconds while it moves on by itself, else none. */
function lengthOf(deck: pl.Deck | null): number | null {
  if (!deck || deck.hold || !deck.auto) return null;
  return deck.seconds;
}

/**
 * Home's transport bar driving the deck, as Home drives it: play/pause is HOLD
 * (pause holds the preset), ◀ ▶ step, R random. The time is a still for the
 * story (12 s in).
 */
export function transportFor(live: LiveState, onAudioError: (e: unknown) => void = () => {}): TransportBarProps {
  const deck = live.deck;
  const name = live.current ? nameOf(live.current) : null;
  return {
    playing: !live.held,
    onPlayPause: () => live.actFx({ kind: 'hold', on: null }),
    onStep: (by) => live.act({ kind: by === -1 ? 'previous' : by === 1 ? 'next' : 'random' }),
    stepIn: deck?.playlist ? ' in the playlist' : '',
    position: live.current ? { elapsed: 12, length: lengthOf(deck) } : null,
    onAudioError,
    now: name ? { name, from: deck && live.lists ? playsFrom(deck, live.lists.playlists) : undefined } : null,
  };
}

/** The preview's stand-in: the still where the native view would draw, a box with nothing over it (as `Preview` is). */
export function Picture({ src, className, style }: { src: string; className?: string; style?: CSSProperties }) {
  return (
    <div className={className ? `lc-picture ${className}` : 'lc-picture'} role="img" aria-label={`${say('bench')} of the playing preset`} style={style}>
      <img src={src} alt="" draggable={false} />
    </div>
  );
}

/** A small caption over a group: Home's section label. */
export function Label({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <p className="lc-label" id={id}>
      {children}
    </p>
  );
}

/** When the next preset comes: on Link's beat ("in 3 beats"), or every n seconds. */
export function nextWhen(live: LiveState): string | null {
  const beats = live.frame ? whenText(link.beatsToNext(live.frame, Date.now())) : null;
  if (beats) return beats;
  if (live.deck?.auto) return `every ${Math.round(live.deck.seconds)} s`;
  return null;
}

/** What the Next line names: the item stepping on opens, or why nothing is next. */
export function nextName(live: LiveState): { text: string; quiet: boolean; missing?: boolean } {
  const says = live.says;
  if (says.kind === 'held') return { text: 'held — nothing changes until you let go (H)', quiet: true };
  if (says.kind === 'item' || says.kind === 'filter') return { text: says.item.name, quiet: false, missing: says.item.missing };
  if (says.kind === 'empty') return { text: `${says.up.playlist.name} is empty`, quiet: true };
  return { text: 'the next preset in the library', quiet: true };
}

/**
 * Now and next, as type: the preset playing large (its star, rating and HOLD
 * after it), the next one under it with when and where from. `compact` puts
 * both on one line each at the bar's size.
 */
export function NowNext({ live, compact = false, label = true }: { live: LiveState; compact?: boolean; label?: boolean }) {
  const next = nextName(live);
  const when = live.says.kind === 'held' ? null : nextWhen(live);
  return (
    <div className="lc-nownext" data-compact={compact ? '' : undefined}>
      {label && <Label>Now playing</Label>}
      <p className="lc-now" role="status" aria-atomic="true" title={live.current ?? titleOf('now')}>
        {live.current ? <b>{nameOf(live.current)}</b> : <b className="lc-quiet">Nothing playing — R for a random preset, or play a playlist</b>}
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
        {live.held && (
          <span className="lc-held" title={`${Say('hold')}: steps, ${say('auto-advance')} and Link's changes wait until you let go (H)`}>
            Hold
          </span>
        )}
      </p>
      <p className="lc-next" title={`${titleOf('next')}. ${whereText(live.up, live.deck)}`}>
        <span className="lc-next-label">Next</span>
        <span className={next.quiet ? 'lc-quiet' : 'lc-next-name'}>{next.missing ? <s>{next.text}</s> : next.text}</span>
        {when && <em className="lc-when">{when}</em>}
      </p>
    </div>
  );
}

/**
 * One performing control: a glyph, its name and its key, as one button.
 * `variant` is how it is drawn: `pad`, a raised tile for the main pane; `key`,
 * a glyph and a word, as the transport's keys are. With `hold` it is a held
 * effect: on while pressed, Shift-click latches, Enter or Space toggles.
 */
export function LivePad({
  id,
  glyph,
  name,
  on,
  onPress,
  hold,
  variant = 'pad',
}: {
  id: ControlId;
  glyph: GlyphName;
  name: string;
  on?: boolean;
  onPress?(): void;
  hold?: { kind: fx.Hit; send(action: fx.FxAction): void };
  variant?: 'pad' | 'key';
}) {
  const pressed = useRef(false);
  const release = () => {
    if (!hold || !pressed.current) return;
    pressed.current = false;
    hold.send(fx.hitAction(hold.kind, false));
  };
  const key = padKey(id);
  return (
    <button
      type="button"
      className="lc-pad"
      data-variant={variant}
      data-pad={id}
      aria-pressed={on}
      aria-label={padLabel(id, name)}
      title={titleOf(id)}
      onClick={hold ? undefined : onPress}
      onPointerDown={
        hold
          ? (e) => {
              if (e.button !== 0) return;
              if (e.shiftKey) return hold.send(fx.hitAction(hold.kind, null));
              pressed.current = true;
              e.currentTarget.setPointerCapture?.(e.pointerId);
              hold.send(fx.hitAction(hold.kind, true));
            }
          : undefined
      }
      onPointerUp={hold ? release : undefined}
      onPointerCancel={hold ? release : undefined}
      onLostPointerCapture={hold ? release : undefined}
      onKeyDown={
        hold
          ? (e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              if (!e.repeat) hold.send(fx.hitAction(hold.kind, null));
            }
          : undefined
      }
    >
      <Glyph name={glyph} size={variant === 'pad' ? 20 : 16} />
      <span className="lc-pad-name">{name}</span>
      {key && (
        <small className="lc-pad-key" aria-hidden="true">
          {key}
        </small>
      )}
    </button>
  );
}

/** The deck's steps: previous, random, next, and HOLD. */
export function DeckPads({ live, variant = 'pad', hold = true }: { live: LiveState; variant?: 'pad' | 'key'; hold?: boolean }) {
  return (
    <div className="lc-pads" data-variant={variant} role="group" aria-label="Presets">
      <LivePad id="previous" glyph="previous" name="Previous" variant={variant} onPress={() => live.act({ kind: 'previous' })} />
      <LivePad id="random" glyph="random" name="Random" variant={variant} onPress={() => live.act({ kind: 'random' })} />
      <LivePad id="step" glyph="next" name="Next" variant={variant} onPress={() => live.act({ kind: 'next' })} />
      {hold && <LivePad id="hold" glyph="hold" name="Hold" variant={variant} on={live.held} onPress={() => live.actFx({ kind: 'hold', on: null })} />}
    </div>
  );
}

/** The effects' pads: strobe and freeze held, blackout a toggle; `hold` adds HOLD (when the deck's own pads don't have it). */
export function EffectPads({ live, variant = 'pad', hold = false }: { live: LiveState; variant?: 'pad' | 'key'; hold?: boolean }) {
  const e = live.effects;
  return (
    <div className="lc-pads" data-variant={variant} role="group" aria-label="Effects">
      {hold && <LivePad id="hold" glyph="hold" name="Hold" variant={variant} on={live.held} onPress={() => live.actFx({ kind: 'hold', on: null })} />}
      <LivePad id="strobe" glyph="strobe" name="Strobe" variant={variant} on={e?.strobe === true} hold={{ kind: 'strobe', send: live.actFx }} />
      <LivePad id="blackout" glyph="blackout" name="Blackout" variant={variant} on={e?.blackout === true} onPress={() => live.actFx({ kind: 'blackout', on: null })} />
      <LivePad id="freeze" glyph="freeze" name="Freeze" variant={variant} on={e?.freeze === true} hold={{ kind: 'freeze', send: live.actFx }} />
    </div>
  );
}

/** Intensity: one fader, as a thin track with the value in the numbers' face (sensitivity, brightness and strobe level together). */
export function IntensityFader({ live, label = true }: { live: LiveState; label?: boolean }) {
  const pct = Math.round(live.intensity * 100);
  return (
    <label className="lc-fader" title={titleOf('intensity')} style={{ '--lc-fill': `${pct}%` } as CSSProperties}>
      {label && <span className="lc-fader-name">Intensity</span>}
      <input type="range" min={0} max={1} step={0.01} value={live.intensity} aria-label="Intensity" aria-valuetext={`${pct}%`} onChange={(e) => live.setIntensity(Number(e.currentTarget.value))} />
      <span className="lc-fader-value">{pct}%</span>
    </label>
  );
}

/** "More effects…": the More effects sheet (mirror, invert, punch, reset), as Live opens it; the stories mount no sheet, so here it does nothing. */
export function MoreEffectsButton({ children = 'More effects…' }: { children?: ReactNode }) {
  return (
    <button type="button" className="lc-text-button" onClick={openEffects} title={titleOf('more')}>
      <Glyph name="effects" size={14} />
      {children}
    </button>
  );
}

/** The beat's dot, lit on each beat at the tempo (a CSS pulse at 60/BPM s, so nothing re-renders per beat). */
function BeatDot({ bpm }: { bpm: number | null }) {
  return <span className="lc-beat-dot" aria-hidden="true" style={bpm ? ({ '--lc-beat': `${60 / bpm}s` } as CSSProperties) : undefined} data-on={bpm ? '' : undefined} />;
}

/** The beat: its dot, the tempo and who keeps it; its popover has tap tempo and Ableton Link (Status.tsx's BEAT light, as Home's popover). */
export function BeatLight({ live, align = 'left' }: { live: LiveState; align?: 'left' | 'right' }) {
  const bpm = bpmText(live.frame, live.effects);
  const linked = live.frame?.enabled === true && live.frame.peers > 0;
  return (
    <Popover
      className="lc-light"
      name={`Tempo, and ${say('Ableton Link')}`}
      title={titleOf('beat')}
      align={align}
      label={
        <>
          <BeatDot bpm={linked ? live.frame!.tempo : (live.effects?.bpm ?? null)} />
          <span className="lc-num">{bpm ?? '—'}</span>
          {linked && (
            <span className="lc-light-sub">
              <Glyph name="link" size={12} />
              {live.frame!.peers}
            </span>
          )}
        </>
      }
    >
      <div className="lc-pop">
        <TapButton effects={live.effects} onTap={() => live.actFx({ kind: 'tap' })} />
        <LinkPanel />
      </div>
    </Popover>
  );
}

/** Where the picture goes: the display it is on, or "in this window" in amber; its popover is the output's panel. */
export function OutputLight({ live, align = 'left' }: { live: LiveState; align?: 'left' | 'right' }) {
  const out = outputText(live.status);
  return (
    <Popover
      className="lc-light"
      name="Where the picture goes"
      title={titleOf('output')}
      align={align}
      label={
        <>
          <Glyph name="output" size={14} />
          <span className="lc-light-text" data-warn={out.on ? undefined : ''}>
            {live.status.display ? live.status.display.name : 'In this window'}
          </span>
        </>
      }
    >
      <div className="lc-pop">
        <OutputPanel status={live.status} show={live.show} />
      </div>
    </Popover>
  );
}

/** A quiet glyph button for the header (Home's `home-tool`): help, settings. */
export function ToolButton({ glyph, label, title, onPress, pressed, controls }: { glyph: GlyphName; label: string; title: string; onPress(): void; pressed?: boolean; controls?: string }) {
  return (
    <button type="button" className="home-tool lc-tool" aria-label={label} aria-pressed={pressed} aria-controls={controls} title={title} onClick={onPress}>
      <Glyph name={glyph} />
    </button>
  );
}

/**
 * Playing in the window (one display, or arriving from the welcome flow): a
 * "Go full screen on…" for each display, and with one the note that the picture
 * will cover this window. Nothing when the output is on a display.
 */
export function FullScreenOffer({ live, compact = false }: { live: LiveState; compact?: boolean }) {
  if (!live.inWindow || !live.displays?.length) return null;
  return (
    <div className="lc-fullscreen" data-compact={compact ? '' : undefined} title={titleOf('fullscreen')}>
      {live.displays.map((d) => (
        <button key={d.id} type="button" className="lc-fullscreen-go" onClick={() => live.show(d.id)} aria-label={`Go full screen on ${d.name}`}>
          <Glyph name="fullscreen" size={compact ? 14 : 16} />
          <span>
            Full screen on <b>{d.name}</b>
          </span>
        </button>
      ))}
      {live.displays.length === 1 && !compact && <p className="lc-fullscreen-note">One display: the picture will cover this window. Esc comes back.</p>}
    </div>
  );
}

/**
 * The flashing-lights warning, owed: live waits behind it (App's `FlashWarning`),
 * so nothing plays and the controls are inert until "I understand". In Home's
 * look, sized to sit where the picture would be.
 */
export function WarningCard({ onUnderstood }: { onUnderstood(): void }) {
  const motion = useMotion();
  useEffect(() => {
    refresh().catch(() => {});
  }, []);
  return (
    <section className="lc-warning" role="alertdialog" aria-modal="true" aria-labelledby="lc-warning-title" aria-describedby="lc-warning-text">
      <Glyph name="strobe" size={24} />
      <h2 id="lc-warning-title">Flashing lights</h2>
      <p id="lc-warning-text">{WARNING_TEXT}</p>
      <div className="lc-warning-row">
        <ReduceFlashing motion={motion} onChange={(on) => void setMotion(on).catch(() => {})} />
      </div>
      <p className="lc-warning-hint">{REDUCE_HINT}</p>
      <button type="button" className="lc-warning-go" onClick={onUnderstood}>
        I understand
      </button>
    </section>
  );
}

/** Whether the warning is owed in a story: owed until its "I understand". */
export function useOwedWarning(owed: boolean): { owed: boolean; understood(): void } {
  const [shown, setShown] = useState(owed);
  useEffect(() => setShown(owed), [owed]);
  return { owed: shown, understood: () => setShown(false) };
}
