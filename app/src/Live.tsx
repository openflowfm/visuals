import { useCallback, useRef, useState } from 'react';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { ButtonFace } from '@openflow/widgets/controls/ButtonFace.tsx';
import { Slider } from '@openflow/widgets/controls/Slider.tsx';
import { range } from './controls.ts';
import { Crate } from './Crate.tsx';
import * as fx from './fx.ts';
import { HelpOverlay, padKey, titleOf, type ControlId } from './HelpOverlay.tsx';
import { useLiveKeys } from './liveKeys.ts';
import * as output from './output.ts';
import { useTauriEvent } from './hooks.ts';
import { nameOf } from './shell.ts';
import { SilenceBanner } from './Onboarding.tsx';
import { Status } from './Status.tsx';
import { HOME, NoticeBanner, Preview, type View } from './views.tsx';
import { say, Say } from './words.ts';
import { nextWhenText, openEffects, padLabel, starsText, whereSr, whereText } from './live/live-model.ts';
import { useLinkFrame, useLive } from './live/useLive.ts';
import './live.css';

// Live mode's reckonings moved to live/live-model.ts (the Stage contract); they are still here for what imported them from Live.
export { intensityOf, keyOf, openEffects, padLabel, playsWindowed, ratingOf, sendIntensity, starred, starsText, whenText, whereSr, whereText, type IntensityAction } from './live/live-model.ts';

const INTENSITY = range('intensity', 0, 1, 0.5);

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
function NextWhen({ deck }: { deck: Parameters<typeof nextWhenText>[1] }) {
  const when = nextWhenText(useLinkFrame(), deck, Date.now());
  return when ? <em className="live-when">{when}</em> : null;
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
 * The state and the actions are `useLive`'s.
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
  const live = useLive({ start, windowed });
  const { current, effects, status, displays, held, star, rating, says, up, deck, act, actFx, show } = live;
  const [help, setHelp] = useState(false);

  const leaveLive = useCallback(() => onMode(HOME, current), [onMode, current]);

  useLiveKeys({ editor: leaveLive, act, fx: actFx, rate: live.rate, favourite: live.favourite, help: () => setHelp((h) => !h) });
  useTauriEvent(output.onEscape, leaveLive);

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
        onError={live.fail("Couldn't use that audio input.")}
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
            {says.kind !== 'held' && deck && <NextWhen deck={deck} />}
          </div>
        </div>
        <NoticeBanner className="live-problem" notice={live.error} onDismiss={live.dismiss} />
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
            value={live.intensity}
            onChange={live.setIntensity}
            display={`${Math.round(live.intensity * 100)}%`}
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
      <aside className="live-side">{live.lists && <Crate lists={live.lists} data={live.data} act={act} onLists={live.setLists} onError={live.setError} current={current} />}</aside>
      <HelpOverlay open={help} onClose={() => setHelp(false)} />
    </div>
  );
}
