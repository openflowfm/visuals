import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { ButtonFace } from '@openflow/widgets/controls/ButtonFace.tsx';
import { Slider } from '@openflow/widgets/controls/Slider.tsx';
import * as api from './api.ts';
import { range } from './controls.ts';
import { Crate, isMood } from './Crate.tsx';
import * as fx from './fx.ts';
import { control, HelpOverlay, padKey, titleOf, type ControlId } from './HelpOverlay.tsx';
import * as link from './link.ts';
import { useLiveKeys, type Stars } from './liveKeys.ts';
import * as output from './output.ts';
import { leave } from './OutputPanel.tsx';
import * as pl from './playlists.ts';
import { useNotice, useTauriEvent } from './hooks.ts';
import { nameOf, notice, openFailed } from './shell.ts';
import { SilenceBanner } from './Onboarding.tsx';
import { Status } from './Status.tsx';
import { HOME, NoticeBanner, openSheet, Preview, type View } from './views.tsx';
import { say, Say } from './words.ts';
import './live.css';

/**
 * The Intensity slider's position, 0–1, read back from the sensitivity it set:
 * `fx::intensity` runs sensitivity from ½× to 2× on a log taper, ½ in the middle
 * at 1×, so the slider follows a sensitivity changed anywhere else too.
 */
export function intensityOf(sensitivity: number): number {
  if (!(sensitivity > 0)) return 0.5;
  return Math.max(0, Math.min(1, Math.log2(sensitivity * 2) / 2));
}

/** `fx::FxAction::Intensity`: sensitivity, brightness and strobe level together, on the app's capped curve. */
export interface IntensityAction {
  kind: 'intensity';
  value: number;
}
/** Send the Intensity slider's position through `act`, as a controller would. */
export const sendIntensity = (value: number) => invoke<void>('act', { action: { kind: 'intensity', value: Math.max(0, Math.min(1, value)) } satisfies IntensityAction });

/** A preset's library key (what `librarySet` takes) from its path, or null when the library doesn't list it. */
export function keyOf(rows: readonly api.LibraryRow[], path: string | null): string | null {
  if (!path) return null;
  return rows.find((r) => r.path === path)?.key ?? null;
}

/** Whether the preset at `key` is starred in the user's data. */
export const starred = (data: api.LibraryData | null, key: string | null): boolean => (key ? data?.presets[key]?.star === true : false);

/** The preset at `key`'s rating, 1–5, or null when unrated. */
export const ratingOf = (data: api.LibraryData | null, key: string | null): number | null => (key ? (data?.presets[key]?.rating ?? null) : null);

/** A rating as stars: "★★★☆☆". */
export const starsText = (rating: number): string => '★'.repeat(rating) + '☆'.repeat(Math.max(0, 5 - rating));

/**
 * Whether live mode plays in the window rather than opening the output: asked to
 * (first run), or only one display is connected, so a full-screen output would
 * cover the controls. Unknown displays (the call failed) keep the old behaviour.
 */
export const playsWindowed = (windowed: boolean, displays: readonly output.Display[] | null): boolean => windowed || (displays !== null && displays.length <= 1);

/** The "next" line's when, from Link's next change: "in 3 beats"; null when changes aren't on the beat. */
export function whenText(beats: number | null): string | null {
  if (beats === null || !Number.isFinite(beats)) return null;
  const n = Math.max(1, Math.ceil(beats - 1e-6));
  return `in ${n} beat${n === 1 ? '' : 's'}`;
}

/** Where the next preset comes from, for the Next line's tooltip: "From Chill, 1 of 20", the mood, or the whole library. */
export function whereText(up: pl.Up | null, deck: pl.Deck | null): string {
  if (up) return `From ${up.playlist.name}${up.index !== null ? `, ${up.index + 1} of ${up.count}` : ''}`;
  if (deck?.query) return isMood(deck.query) ? `From the mood ${(deck.query.groups.tags ?? []).join(' + ')}` : `From ${say('library query')}`;
  return 'From the whole library: play a playlist or a mood to set the order';
}

/** The same, read after the Next line's name for screen readers, which don't get its tooltip: ", from Chill, 1 of 20". */
export const whereSr = (up: pl.Up | null, deck: pl.Deck | null): string => `, from${whereText(up, deck).slice('From'.length)}`;

/** "More effects…": the More effects sheet, over live mode (it takes Esc while open). */
export const openEffects = () => openSheet('effects');

const INTENSITY = range('intensity', 0, 1, 0.5);

/** A pad's accessible name: the control's name from the help list, or `name` instead, then its keys: "Previous (← ↑)". */
export function padLabel(id: ControlId, name?: string): string {
  const c = control(id);
  return `${name ?? c.name}${c.keys ? ` (${c.keys})` : ''}`;
}

/** The key under a pad's name: one letter or arrow; the rest of its keys are in its tooltip and the ? overlay. */
function PadKey({ id }: { id: ControlId }) {
  const key = padKey(id);
  return key ? <small aria-hidden="true">{key}</small> : null;
}

/**
 * One of the big buttons; `id` names it from the help list. `on` makes it a
 * toggle (`aria-pressed`).
 */
export function Pad({ id, onPress, on, label, children }: { id: ControlId; onPress(): void; on?: boolean; label?: string; children?: React.ReactNode }) {
  return (
    <ButtonFace className="live-pad" data-pad={id} aria-pressed={on} aria-label={label ?? padLabel(id)} title={titleOf(id)} onClick={onPress}>
      {children}
      <PadKey id={id} />
    </ButtonFace>
  );
}

/**
 * A held effect's pad: on while the pointer is down, off when it comes up or
 * leaves; Shift-click latches. From the keyboard (Enter or space) it toggles.
 */
export function HoldPad({ id, kind, on, send, children }: { id: ControlId; kind: fx.Hit; on: boolean; send(action: fx.FxAction): void; children?: React.ReactNode }) {
  const pressed = useRef(false);
  const release = () => {
    if (!pressed.current) return;
    pressed.current = false;
    send(fx.hitAction(kind, false));
  };
  return (
    <ButtonFace
      className="live-pad"
      data-pad={id}
      aria-pressed={on}
      aria-label={padLabel(id)}
      title={titleOf(id)}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        if (e.shiftKey) {
          send(fx.hitAction(kind, null));
          return;
        }
        pressed.current = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        send(fx.hitAction(kind, true));
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) send(fx.hitAction(kind, null));
      }}
    >
      {children}
      <PadKey id={id} />
    </ButtonFace>
  );
}

/** When the next preset comes on Link's beat: its own leaf, as Link's frames come ten times a second. */
function NextWhen({ auto, seconds }: { auto: boolean; seconds: number }) {
  const [frame, setFrame] = useState<link.Frame | null>(null);
  useEffect(() => {
    link.state().then(
      (f) => setFrame((was) => was ?? f),
      () => {},
    );
  }, []);
  useTauriEvent(link.onFrame, setFrame);
  const beats = frame ? whenText(link.beatsToNext(frame, Date.now())) : null;
  if (beats) return <em className="live-when">{beats}</em>;
  if (auto) return <em className="live-when">every {Math.round(seconds)} s</em>;
  return null;
}

/**
 * Live mode: performing, not editing. Along the top the status strip (what it
 * hears, the beat and tap tempo, where the picture goes, help, settings, and
 * leave apart); then what's playing and what's next, two lines over the
 * preview, which takes the rest of the height; the pads in two rows — previous,
 * random, next; hold, strobe, blackout, freeze — and one Intensity slider; and
 * beside them the crate: playlists, moods from the user's tags, and up next.
 * Everything else is a key (the ? overlay names them all) or in More effects.
 *
 * The output opens full screen on the way in when there's a display for it;
 * with one display, or from the welcome flow, live plays in the window with a
 * big "Go full screen on…" button. Leaving is ✕, ⌘⇧L or Esc — here (not while
 * typing in a field) or on the output, which tells the page (`output.onEscape`).
 * Leaving also puts the effects back, so nothing is left inverted or frozen.
 */
export function Live({
  start,
  onMode,
  windowed = false,
}: {
  start: string | null;
  onMode: (mode: View, path: string | null) => void;
  /** Play in the window: don't open the output on the way in. */ windowed?: boolean;
}) {
  const [lists, setLists] = useState<pl.Lists | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const { notice: error, set: setError, fail, dismiss } = useNotice();
  const [status, setStatus] = useState<output.Status>({ display: null, size: null });
  const [displays, setDisplays] = useState<output.Display[] | null>(null);
  const [effects, setEffects] = useState<fx.Fx | null>(null);
  const [data, setData] = useState<api.LibraryData | null>(null);
  const [rows, setRows] = useState<api.LibraryRow[]>([]);
  const [help, setHelp] = useState(false);

  const held = (effects?.hold ?? lists?.deck.hold) === true;
  const heldNow = useRef(held);
  heldNow.current = held;

  const show = useCallback((id: number | null) => output.open(id).then(setStatus, fail("Couldn't show the output on that display.")), [fail]);

  // Live mode is the output: open it on the way in when another display can take it, close it (and reset the effects) on the way out.
  useEffect(() => {
    api.setPreviews([]).catch(() => {});
    // Left before the displays came back: don't open an output nothing would close.
    let gone = false;
    output.displays().then(
      (ds) => {
        if (gone) return;
        setDisplays(ds);
        if (!playsWindowed(windowed, ds)) show(null);
      },
      () => {
        if (!gone && !windowed) show(null);
      },
    );
    fx.state().then(setEffects, fail("Couldn't read the effects."));
    return () => {
      gone = true;
      leave();
    };
  }, [show, fail, windowed]);
  useTauriEvent(output.onStatus, setStatus);
  useTauriEvent(fx.onFx, setEffects);

  // The user's library data, for the moods and the favourite star; the index, for a preset's key.
  useEffect(() => {
    api.libraryData().then(setData, () => {});
    api.libraryIndex().then(setRows, () => {});
  }, []);
  useTauriEvent(api.onLibraryChanged, setData);

  useEffect(() => {
    pl.lists().then((l) => {
      setLists(l);
      setCurrent((c) => c ?? l.deck.current ?? start);
      // Started in live mode, nothing is playing yet: the preset asked for, or any.
      if (l.deck.current) return;
      if (start) api.open(start).catch((e) => setError(openFailed(start, String(e))));
      else pl.act({ kind: 'random' }).catch(fail("Couldn't pick a preset to start on."));
    }, fail("Couldn't read the playlists."));
  }, [fail, setError, start]);
  useTauriEvent(pl.onLists, setLists);
  useTauriEvent(pl.onLive, (now) => {
    setLists((l) => (l ? { ...l, deck: now.deck } : l));
    if (now.path) setCurrent(now.path);
    // A preset that opened clears a failure to open the last one.
    if (now.error) setError(openFailed(now.path, now.error));
    else if (now.path) dismiss();
  });

  const act = useCallback(
    (action: pl.Action) =>
      pl
        .act(action)
        .catch((e) =>
          setError(
            heldNow.current && (action.kind === 'next' || action.kind === 'previous' || action.kind === 'random')
              ? notice(`HOLD is on, so the preset stays — press H to let go.`, e)
              : notice(
                  action.kind === 'next' || action.kind === 'previous' || action.kind === 'random'
                    ? `Couldn't ${action.kind === 'random' ? 'pick a random preset' : `go to the ${action.kind} preset`}.`
                    : "Couldn't play that.",
                  e,
                ),
          ),
        ),
    [setError],
  );
  const actFx = useCallback((action: fx.FxAction) => fx.act(action).catch(fail("Couldn't change that effect.")), [fail]);

  const key = useMemo(() => keyOf(rows, current), [rows, current]);
  const star = starred(data, key);
  const favourite = useCallback(() => {
    if (!key) return setError(notice("This preset isn't in the library, so it can't be starred."));
    api.librarySet([key], { star: !star }).then(setData, fail("Couldn't star that preset."));
  }, [key, star, fail, setError]);
  const rating = ratingOf(data, key);
  // The same number again takes the rating off.
  const rate = useCallback(
    (stars: Stars) => {
      if (!key) return setError(notice("This preset isn't in the library, so it can't be rated."));
      api.librarySet([key], { rating: rating === stars ? 0 : stars }).then(setData, fail("Couldn't rate that preset."));
    },
    [key, rating, fail, setError],
  );
  const leaveLive = useCallback(() => onMode(HOME, current), [onMode, current]);

  useLiveKeys({ editor: leaveLive, act, fx: actFx, rate, favourite, help: () => setHelp((h) => !h) });
  useTauriEvent(output.onEscape, leaveLive);

  const says = pl.nextSays(lists, held);
  const up = pl.upNext(lists);
  const deck = lists?.deck ?? null;
  const inWindow = status.display === null && displays !== null;

  return (
    <div className="live" data-windowed={inWindow ? '' : undefined}>
      <Status
        output={status}
        show={show}
        effects={effects}
        onHelp={() => setHelp(true)}
        onTap={() => actFx({ kind: 'tap' })}
        onLeave={leaveLive}
        onError={fail("Couldn't use that audio input.")}
        titles={{ audio: titleOf('audio'), beat: titleOf('beat'), output: titleOf('output'), help: titleOf('help'), settings: titleOf('settings'), leave: titleOf('leave') }}
      />
      <div className="live-banner">
        <SilenceBanner />
      </div>
      <section className="live-stage">
        <div className="live-deck">
          {/* A polite status: VoiceOver says the new preset (and its star, rating and HOLD) when it changes, not on every frame. */}
          <div className="live-now" title={current ?? titleOf('now')} role="status" aria-atomic="true">
            {current ? <b>{nameOf(current)}</b> : <b className="live-none">Nothing playing — press R for a random preset, or play a playlist.</b>}
            {star && (
              <span className="live-star" title="A favourite (L takes the star off)" role="img" aria-label="favourite">
                ★
              </span>
            )}
            {rating !== null && (
              <span className="live-rating" title={`Rated ${rating} of 5 (press ${rating} again to take it off)`} role="img" aria-label={`rated ${rating} of 5`}>
                {starsText(rating)}
              </span>
            )}
            {held && (
              <span className="live-held" title={`${Say('hold')}: steps, ${say('auto-advance')} and Link's changes wait until you let go (H)`}>
                HOLD
              </span>
            )}
          </div>
          <div className="live-next" title={`${titleOf('next')}. ${whereText(up, deck)}`}>
            <span className="live-sr">Next: </span>
            {says.kind === 'held' ? (
              <span className="live-none">held — nothing changes until you let go of HOLD (H)</span>
            ) : says.kind === 'item' || says.kind === 'filter' ? (
              <span data-missing={says.item.missing ? '' : undefined} title={says.item.missing ? `Not in the library any more: ${says.item.path}` : says.item.path}>
                {says.item.name}
                {says.item.missing && <em> — missing from the library, it won't open</em>}
              </span>
            ) : says.kind === 'empty' ? (
              <span className="live-none">{says.up.playlist.name} is empty — add presets in the library.</span>
            ) : (
              <span className="live-none">the next preset in the library</span>
            )}
            {says.kind !== 'held' && <span className="live-sr">{whereSr(up, deck)}</span>}
            {says.kind !== 'held' && deck && <NextWhen auto={deck.auto} seconds={deck.seconds} />}
          </div>
        </div>
        <NoticeBanner className="live-problem" notice={error} onDismiss={dismiss} />
        <div className="live-preview-cell">
          <Preview className="live-preview" />
          {inWindow && displays.length > 0 && (
            <div className="live-fullscreen" title={titleOf('fullscreen')}>
              {displays.map((d) => (
                <Button key={d.id} className="live-fullscreen-go" onPress={() => show(d.id)} label={`Go full screen on ${d.name}`} title={titleOf('fullscreen')}>
                  Go full screen on {d.name}
                </Button>
              ))}
              {displays.length === 1 && <p className="live-fullscreen-note">One display: the picture will cover this window. Esc comes back.</p>}
            </div>
          )}
        </div>
        <div className="wdg live-pads" role="group" aria-label="Live controls">
          <div className="live-pads-row" data-row="presets" role="group" aria-label="Presets">
            <Pad id="previous" onPress={() => act({ kind: 'previous' })}>
              ◀ Previous
            </Pad>
            <Pad id="random" onPress={() => act({ kind: 'random' })}>
              Random
            </Pad>
            <Pad id="step" onPress={() => act({ kind: 'next' })}>
              Next ▶
            </Pad>
          </div>
          <div className="live-pads-row" data-row="effects" role="group" aria-label="Effects">
            <Pad id="hold" on={held} onPress={() => actFx({ kind: 'hold', on: null })}>
              Hold
            </Pad>
            <HoldPad id="strobe" kind="strobe" on={effects?.strobe === true} send={actFx}>
              Strobe
            </HoldPad>
            <Pad id="blackout" on={effects?.blackout === true} onPress={() => actFx({ kind: 'blackout', on: null })}>
              Blackout
            </Pad>
            <HoldPad id="freeze" kind="freeze" on={effects?.freeze === true} send={actFx}>
              Freeze
            </HoldPad>
          </div>
        </div>
        <div className="wdg live-intensity">
          <Slider
            param={INTENSITY}
            value={intensityOf(effects?.sensitivity ?? 1)}
            onChange={(v) => {
              setEffects((e) => (e ? { ...e, sensitivity: 0.5 * 4 ** v } : e));
              sendIntensity(v).catch(fail("Couldn't change the intensity."));
            }}
            display={`${Math.round(intensityOf(effects?.sensitivity ?? 1) * 100)}%`}
            orientation="horizontal"
            layout="inside"
            length="auto"
            name="Intensity"
            label="Intensity"
            title={titleOf('intensity')}
          />
          <Button className="live-more" onPress={openEffects} title={titleOf('more')}>
            More effects…
          </Button>
        </div>
      </section>
      <aside className="live-side">{lists && <Crate lists={lists} data={data} act={act} onLists={setLists} onError={setError} current={current} />}</aside>
      <HelpOverlay open={help} onClose={() => setHelp(false)} />
    </div>
  );
}
