import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useParamGesture } from '@openflow/widgets/gesture/useParamGesture.ts';
import { range } from '../controls.ts';
import * as fx from '../fx.ts';
import { padKey, titleOf, type ControlId } from '../HelpOverlay.tsx';
import { playsFrom, presetLength } from '../home.ts';
import { Icon, type IconName } from '../layout/icons.tsx';
import { TransportBar, type TransportBarProps } from '../layout/TransportBar.tsx';
import { SilenceBanner } from '../Onboarding.tsx';
import { nameOf, notice } from '../shell.ts';
import { NoticeBanner } from '../views.tsx';
import { say, Say } from '../words.ts';
import { nextName, nextWhenText, openEffects, padLabel, saysWhere, starsText, whereSr, whereText, type LiveState } from './live-model.ts';
import type { StageDockProps } from './stage-model.ts';
import { useLinkFrame } from './useLive.ts';
import './stage-dock.css';

/** Intensity's range: 0–1, a double-click back to the middle (1× sensitivity), as Live's slider had it. */
const INTENSITY = range('intensity', 0, 1, 0.5);

/** Seconds on the preset playing, ticking each second while one plays, from when it opened (`since`, ms; a re-open of the same preset restarts it); null while nothing plays. */
function useElapsed(current: string | null, since: number, length: number | null): TransportBarProps['position'] {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!current) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [current, since]);
  return current ? { elapsed: Math.max(0, (now - since) / 1000), length } : null;
}

/**
 * Home's transport bar driving the deck: pause is HOLD (the preset stays, as
 * the H key and today's Hold pad have it), ◀ ▶ step, R random, the preset
 * playing and where from, the time on it, the audio input.
 */
function useTransport(live: LiveState): TransportBarProps {
  const deck = live.deck;
  const position = useElapsed(live.current, live.since, deck ? presetLength({ ...deck, hold: live.held }) : null);
  const name = live.current ? nameOf(live.current) : null;
  return {
    playing: !live.held,
    onPlayPause: () => live.actFx({ kind: 'hold', on: null }),
    onStep: (by) => live.act({ kind: by === -1 ? 'previous' : by === 1 ? 'next' : 'random' }),
    stepIn: deck?.playlist ? ' in the playlist' : '',
    position,
    onAudioError: (e) => live.setError(notice("Couldn't use that audio input.", e)),
    now: name ? { name, from: deck && live.lists ? playsFrom(deck, live.lists.playlists) : undefined } : null,
  };
}

/** When the next preset comes: its own leaf, as Link's frames come ten times a second. */
function NextWhen({ deck }: { deck: LiveState['deck'] }) {
  const when = nextWhenText(useLinkFrame(), deck, Date.now());
  // Set apart from the name by a dot (and a comma for screen readers), and named in its tooltip: "every 30 s" is when it changes.
  return when ? (
    <em className="sd-when" title={`When the next preset comes: ${when}`}>
      <span className="sd-sr">, changes </span>
      {when}
    </em>
  ) : null;
}

/** The deck's Next line, with HOLD, the favourite's star and the rating before it: what the transport's now line doesn't say. */
function NextLine({ live }: { live: LiveState }) {
  const next = nextName(live.says);
  const says = live.says;
  const item = says.kind === 'item' || says.kind === 'filter' ? says.item : null;
  return (
    <div className="sd-next">
      {live.held && (
        <span className="sd-held" title={`${Say('hold')}: this preset stays — ${say('auto-advance')} and Link's changes wait until you let go (H)`}>
          Hold
        </span>
      )}
      {live.star && (
        <span className="sd-star" title="A favourite (L takes the star off)" role="img" aria-label="favourite">
          <Icon name="star" size={12} />
        </span>
      )}
      {live.rating !== null && (
        <span className="sd-rating" title={`Rated ${live.rating} of 5 (press ${live.rating} again to take it off)`} role="img" aria-label={`rated ${live.rating} of 5`}>
          {starsText(live.rating)}
        </span>
      )}
      <p className="sd-next-line" title={`${titleOf('next')}. ${whereText(live.up, live.deck)}`}>
        <span className="sd-next-label">Next</span>
        <span className="sd-sr">: </span>
        {item ? (
          <span className="sd-next-name" data-missing={item.missing ? '' : undefined} title={item.missing ? `Not in the library any more: ${item.path}` : item.path}>
            {item.missing ? <s>{item.name}</s> : item.name}
            {item.missing && <span className="sd-sr"> — missing from the library, it won't open</span>}
          </span>
        ) : (
          <span className="sd-quiet">{next.text}</span>
        )}
        {saysWhere(says, live.up, live.deck) && <span className="sd-sr">{whereSr(live.up, live.deck)}</span>}
        {says.kind !== 'held' && live.deck && <NextWhen deck={live.deck} />}
      </p>
    </div>
  );
}

/**
 * One effect key: a glyph, its name and its key letter, as one button (the
 * name and letter quiet, its accessible name the help list's with its keys).
 * `on` makes it a toggle (`aria-pressed`). With `hold` it is a held effect: on
 * while the pointer is down, off when it comes up or leaves; Shift-click
 * latches; from the keyboard (Enter or Space) it toggles.
 */
export function EffectKey({
  id,
  glyph,
  name,
  on,
  onPress,
  hold,
}: {
  id: ControlId;
  glyph: IconName;
  name: string;
  on: boolean;
  onPress?(): void;
  hold?: { kind: fx.Hit; send(action: fx.FxAction): void };
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
      className="sd-key"
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
              e.stopPropagation();
              if (!e.repeat) hold.send(fx.hitAction(hold.kind, null));
            }
          : undefined
      }
    >
      <Icon name={glyph} />
      <span className="sd-key-name">{name}</span>
      {key && (
        <small className="sd-key-letter" aria-hidden="true">
          {key}
        </small>
      )}
    </button>
  );
}

/**
 * Intensity: one fader (sensitivity, brightness and strobe level together),
 * the transport's thin track. The widgets' gesture, as Live's slider had it:
 * grab and drag (a modifier for fine), arrows, Page Up/Down, Home and End
 * (the arrows aren't also a preset step), a double-click back to the middle.
 */
function IntensityFader({ live }: { live: LiveState }) {
  const pct = Math.round(live.intensity * 100);
  const gesture = useParamGesture({
    param: INTENSITY,
    value: live.intensity,
    onChange: live.setIntensity,
    axis: 'horizontal',
    anchor: 'pointer',
    travel: 'element',
    label: 'Intensity',
    display: `${pct}%`,
  });
  return (
    <div className="sd-fader" title={titleOf('intensity')} style={{ '--sd-fill': `${gesture.fraction * 100}%` } as CSSProperties}>
      <span className="sd-fader-name" aria-hidden="true">
        Intensity
      </span>
      <div className="sd-fader-track" {...gesture.props}>
        <span className="sd-fader-thumb" aria-hidden="true" />
      </div>
      <span className="sd-fader-value" aria-hidden="true">
        {pct}%
      </span>
    </div>
  );
}

/** A group in the dock's row. */
function Group({ label, children, className }: { label: string; children: ReactNode; className: string }) {
  return (
    <div className={className} role="group" aria-label={label}>
      {children}
    </div>
  );
}

/**
 * The Stage's dock along the bottom (see `StageDockProps`): an opaque inset
 * panel holding Home's transport bar (pause is HOLD, ◀ ▶ step, R random, the
 * time on the preset, the audio input, a warning only while the picture draws
 * slowly) and a row under it: the Next line (with HOLD, the star and the
 * rating), the effect keys (strobe and freeze held, blackout a toggle),
 * Intensity and More effects…. The notice, and the silence banner when the
 * music stops, show over them. The shell places it and paints its panel (a
 * section labelled "Live controls"); the dock is its contents.
 */
export function StageDock({ live }: StageDockProps) {
  const transport = useTransport(live);
  const e = live.effects;
  return (
    <div className="sd">
      <div className="sd-banners">
        <SilenceBanner />
        <NoticeBanner className="sd-notice" notice={live.error} onDismiss={live.dismiss} />
        {/* A state, not a failure (Hold keeping the preset, leaving asking for a second press): quiet, polite, no dismiss. */}
        <p className="sd-hint" role="status" hidden={!live.hint}>
          {live.hint}
        </p>
      </div>
      <TransportBar {...transport} />
      <div className="sd-row">
        <NextLine live={live} />
        <div className="sd-fx">
          <Group className="sd-keys" label="Effects">
            <EffectKey id="strobe" glyph="strobe" name="Strobe" on={e?.strobe === true} hold={{ kind: 'strobe', send: live.actFx }} />
            <EffectKey id="blackout" glyph="blackout" name="Blackout" on={e?.blackout === true} onPress={() => live.actFx({ kind: 'blackout', on: null })} />
            <EffectKey id="freeze" glyph="freeze" name="Freeze" on={e?.freeze === true} hold={{ kind: 'freeze', send: live.actFx }} />
          </Group>
          <IntensityFader live={live} />
          <button type="button" className="sd-more" onClick={openEffects} title={titleOf('more')}>
            <Icon name="effects" size={14} />
            More effects…
          </button>
        </div>
      </div>
    </div>
  );
}
