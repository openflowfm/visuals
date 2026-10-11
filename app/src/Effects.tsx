import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { ButtonFace } from '@openflow/widgets/controls/ButtonFace.tsx';
import { Segmented } from '@openflow/widgets/controls/Segmented.tsx';
import { Slider } from '@openflow/widgets/controls/Slider.tsx';
import type { Param } from '@openflow/widgets/param/param.ts';
import { formatMultiplier, multiplierToPosition, POSITION_MAX, POSITION_MIN, positionToMultiplier, range } from './controls.ts';
import * as fx from './fx.ts';
import { useNotice, useTauriEvent } from './hooks.ts';
import type { Notice } from './shell.ts';
import { say, Say } from './words.ts';
import './effects.css';

// Sensitivity is a multiplier on a log taper: the slider holds the position
// (log2, −2..2, 0 at 1×) and `positionToMultiplier` turns it back.
const BRIGHTNESS = range('brightness', 0, 2, 1);
const SENSITIVITY = range('sensitivity', POSITION_MIN, POSITION_MAX, 0);
const FADE = range('blackout fade', 0, 10, 0);

const RATES = [0.25, 0.5, 1, 2, 4];
export const RATE_NAMES = ['¼', '½', '1', '2', '4'];
/** The strobe rates' accessible names, by position: the glyphs read aloud as nothing useful. */
export const RATE_LABELS = [say('strobe rate 1/4'), say('strobe rate 1/2'), say('strobe rate 1'), say('strobe rate 2'), say('strobe rate 4')];
/** The mirror modes in the order the pickers list them, and what they say. */
export const MIRRORS: fx.Mirror[] = ['off', 'x', 'y', 'quad'];
export const MIRROR_NAMES = ['off', 'X', 'Y', '4-way'];
/** The mirror modes' accessible names, by position, each starting with what the item shows. */
export const MIRROR_LABELS = [say('mirror mode off'), say('mirror mode x'), say('mirror mode y'), say('mirror mode quad')];
/** Where in `list` the value nearest `value` is. */
export const nearest = (list: number[], value: number) => list.reduce((best, v, at) => (Math.abs(v - value) < Math.abs(list[best] - value) ? at : best), 0);

/** One fine step of brightness (0–2, 1 as drawn), `by` steps up (+) or down (−). */
export const BRIGHTNESS_STEP = 0.02;
export const stepBrightness = (value: number, by: number) => Math.min(2, Math.max(0, Math.round((value + by * BRIGHTNESS_STEP) * 100) / 100));
/** One fine step of sensitivity (¼× to 4×): a twelfth of a doubling, `by` steps up or down. */
export const stepSensitivity = (value: number, by: number) => {
  const position = Math.round(Math.log2(Math.max(value, 1e-6)) * 12 + by) / 12;
  return Math.min(4, Math.max(0.25, 2 ** position));
};

/** A hit's accessible name: its caps label as a word VoiceOver reads (not spells), and its key. "Strobe (S)". */
export const hitLabel = (label: string, keyName: string): string => `${label.charAt(0).toUpperCase()}${label.slice(1).toLowerCase()} (${keyName})`;

/**
 * One of the hits (More effects' Punch). A held one is on while the pointer is
 * down and off when it comes up or leaves; Shift-click latches it instead.
 * Blackout toggles. From the keyboard (focus, then Enter or space) every one toggles.
 */
export function Hit({ kind, on, hold, label, keyName, send }: { kind: fx.Hit; on: boolean; hold: boolean; label: string; keyName: string; send(action: fx.FxAction): void }) {
  const pressed = useRef(false);
  const release = () => {
    if (!pressed.current) return;
    pressed.current = false;
    send(fx.hitAction(kind, false));
  };
  const how = hold ? `hold ${keyName}, or press and hold here; Shift latches it` : `${keyName} or click toggles it`;
  return (
    <ButtonFace
      className="fx-hit"
      data-kind={kind}
      aria-pressed={on}
      aria-label={hitLabel(label, keyName)}
      title={`${label}: ${how}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        if (!hold || e.shiftKey) {
          send(fx.hitAction(kind, null));
          return;
        }
        pressed.current = true;
        send(fx.hitAction(kind, true));
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) send(fx.hitAction(kind, null));
      }}
    >
      {label}
      <small aria-hidden="true">{keyName}</small>
    </ButtonFace>
  );
}

/** The live effects as a sheet reads and changes them: their state, kept current by the `fx` event, and how to change them. */
export interface FxControl {
  /** Null until it has been read. */
  state: fx.Fx | null;
  /** A failure to read or change them, if any. */
  notice: Notice | null;
  dismiss(): void;
  send(action: fx.FxAction): void;
  /** Send `action`, showing `patch` at once rather than when the app answers, so a drag doesn't lag. */
  set(action: fx.FxAction, patch: Partial<fx.Fx>): void;
}

/** The live effects for a sheet of its own, apart from Live's: read once, then followed. */
export function useFx(): FxControl {
  const [state, setState] = useState<fx.Fx | null>(null);
  const { notice, fail, dismiss } = useNotice();
  useEffect(() => {
    fx.state().then(setState, fail("Couldn't read the effects."));
  }, [fail]);
  useTauriEvent(fx.onFx, setState);
  const send = useCallback((action: fx.FxAction) => void fx.act(action).catch(fail("Couldn't change that effect.")), [fail]);
  const set = useCallback(
    (action: fx.FxAction, patch: Partial<fx.Fx>) => {
      setState((s) => s && { ...s, ...patch });
      send(action);
    },
    [send],
  );
  return { state, notice, dismiss, send, set };
}

/** A horizontal slider with its value inside, as the effects draw them. */
const slide = (param: Param, value: number, onChange: (v: number) => void, display: string, title: string) => (
  <Slider param={param} value={value} onChange={onChange} display={display} orientation="horizontal" layout="inside" title={`${title} (double-click resets)`} />
);

/** A setting's row, as every row in ⚙ Settings is drawn (settings.css): its name first, then its control. */
function Row({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <span className="settings-row-name">{name}</span>
      <span className="settings-row-control">{children}</span>
    </div>
  );
}

/** A slider with a step down and a step up either side of it, for the fine adjustments a drag can't make on a touch screen. */
function Fine({ name, slider, down, up }: { name: string; slider: React.ReactNode; down(): void; up(): void }) {
  return (
    <Row name={name}>
      <Button onPress={down} label={`${name} down a step`} title="A step down">
        −
      </Button>
      {slider}
      <Button onPress={up} label={`${name} up a step`} title="A step up">
        +
      </Button>
    </Row>
  );
}

/**
 * The effects' settings, for ⚙'s Effects section: how the strobe flashes (how
 * often and to what colour), how long the fade to black takes, and brightness and
 * sensitivity in fine steps. The hits themselves stay in live mode.
 */
export function EffectSettings({ state, set }: Pick<FxControl, 'set'> & { state: fx.Fx }) {
  const brightness = (v: number) => set({ kind: 'brightness', value: v }, { brightness: v });
  const sensitivity = (v: number) => set({ kind: 'sensitivity', value: v }, { sensitivity: v });
  return (
    <div className="wdg settings-rows">
      <Row name={Say('strobe rate')}>
        <Segmented
          name={say('strobe rate')}
          items={RATE_NAMES}
          itemLabels={RATE_LABELS}
          index={nearest(RATES, state.strobe_rate)}
          onChange={(i) => set({ kind: 'strobe_rate', rate: RATES[i] }, { strobe_rate: RATES[i] })}
          title="How many times the strobe flashes each beat"
        />
      </Row>
      <Row name={Say('strobe style')}>
        <Segmented
          name={say('strobe style')}
          items={['white', 'black']}
          index={state.strobe_style === 'black' ? 1 : 0}
          onChange={(i) => {
            const style: fx.StrobeStyle = i === 1 ? 'black' : 'white';
            set({ kind: 'strobe_style', style }, { strobe_style: style });
          }}
          title="Flash to white, or to black"
        />
      </Row>
      <Row name={Say('blackout fade')}>
        {slide(
          FADE,
          state.blackout_fade,
          (v) => set({ kind: 'blackout_fade', seconds: v }, { blackout_fade: v }),
          `${state.blackout_fade.toFixed(1)} s`,
          'How long blackout takes to fade in and out; 0 is at once',
        )}
      </Row>
      <Fine
        name="Brightness"
        slider={slide(BRIGHTNESS, state.brightness, brightness, state.brightness.toFixed(2), 'Brightness; 1 is as drawn')}
        down={() => brightness(stepBrightness(state.brightness, -1))}
        up={() => brightness(stepBrightness(state.brightness, 1))}
      />
      <Fine
        name={Say('sensitivity')}
        slider={slide(
          SENSITIVITY,
          multiplierToPosition(state.sensitivity),
          (p) => sensitivity(positionToMultiplier(p)),
          formatMultiplier(state.sensitivity),
          `${Say('sensitivity')}: how loud the presets hear the audio, ¼× to 4×`,
        )}
        down={() => sensitivity(stepSensitivity(state.sensitivity, -1))}
        up={() => sensitivity(stepSensitivity(state.sensitivity, 1))}
      />
    </div>
  );
}
