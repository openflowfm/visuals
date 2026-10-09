import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { ButtonFace } from '@openflow/widgets/controls/ButtonFace.tsx';
import { NumberField } from '@openflow/widgets/controls/NumberField.tsx';
import { Segmented } from '@openflow/widgets/controls/Segmented.tsx';
import { Slider } from '@openflow/widgets/controls/Slider.tsx';
import { Toggle } from '@openflow/widgets/controls/Toggle.tsx';
import type { Param } from '@openflow/widgets/param/param.ts';
import { formatMultiplier, multiplierToPosition, POSITION_MAX, POSITION_MIN, positionToMultiplier, range } from './controls.ts';
import * as fx from './fx.ts';
import { useNotice, useTauriEvent } from './hooks.ts';
import type { Notice } from './shell.ts';
import { say, Say } from './words.ts';
import './effects.css';

// Speed and sensitivity are multipliers on a log taper: the slider holds the
// position (log2, −2..2, 0 at 1×) and `taper` turns it back into the multiplier.
const SPEED = range('speed', POSITION_MIN, POSITION_MAX, 0);
const TRANSITION = range('transition', 0, 10, 2);
const BRIGHTNESS = range('brightness', 0, 2, 1);
const HUE = range('hue', 0, 1, 0);
const TRAILS = range('trails', 0, 1, 0);
const SENSITIVITY = range('sensitivity', POSITION_MIN, POSITION_MAX, 0);
const INTENSITY = range('strobe level', 0, 1, 1);
const FADE = range('blackout fade', 0, 10, 0);
const BPM: Param = { kind: 'int', min: 40, max: 240, defaultValue: 120, steps: 201, name: 'bpm' };

const RATES = [0.25, 0.5, 1, 2, 4];
const RATE_NAMES = ['¼', '½', '1', '2', '4'];
/** The mirror modes in the order the pickers list them, and what they say. */
export const MIRRORS: fx.Mirror[] = ['off', 'x', 'y', 'quad'];
export const MIRROR_NAMES = ['off', 'X', 'Y', '4-way'];
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
 * One of the big hits. A held one is on while the pointer is down and off when it
 * comes up or leaves; Shift-click latches it instead. Blackout toggles. From the
 * keyboard (focus, then Enter or space) every one toggles.
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

/**
 * The live effects: the hits, then tempo, then the picture's switches and its
 * amounts. Every change goes out through `act`, as a controller's would; what is
 * shown is the state the app sends back (set here ahead of it, so a drag doesn't lag).
 */
export function Effects({ state, onState, send }: { state: fx.Fx; onState: React.Dispatch<React.SetStateAction<fx.Fx | null>>; send(action: fx.FxAction): void }) {
  const set = (action: fx.FxAction, patch: Partial<fx.Fx>) => {
    onState((s) => s && { ...s, ...patch });
    send(action);
  };
  const slider = (param: Param, value: number, onChange: (v: number) => void, display: string, title: string) => (
    <Slider param={param} value={value} onChange={onChange} display={display} orientation="horizontal" layout="inside" title={`${title} (double-click resets)`} />
  );
  const taper = (param: Param, multiplier: number, onChange: (m: number) => void, title: string) =>
    slider(param, multiplierToPosition(multiplier), (p) => onChange(positionToMultiplier(p)), formatMultiplier(multiplier), title);

  return (
    // `wdg` on the group: the bare hit faces read the widgets' variables from it.
    <section className="wdg fx" aria-label="effects">
      <div className="fx-head">
        <h2>Effects</h2>
        <span className="vf-fill" />
        <Button onPress={() => send({ kind: 'fx_reset' })} title="Every effect back to normal; tempo and sensitivity stay (0)">
          reset effects
        </Button>
      </div>
      <div className="fx-hits">
        <Hit kind="strobe" on={state.strobe} hold label="STROBE" keyName="S" send={send} />
        <Hit kind="punch" on={state.punch} hold label="PUNCH" keyName="P" send={send} />
        <Hit kind="freeze" on={state.freeze} hold label="FREEZE" keyName="F" send={send} />
        <Hit kind="blackout" on={state.blackout} hold={false} label="BLACKOUT" keyName="B" send={send} />
      </div>
      <div className="fx-row">
        {state.linked ? (
          <span className="fx-tempo" title="The tempo is the Link session's while it has peers; taps don't change it">
            LINK <b>{Math.round(state.bpm)}</b>
          </span>
        ) : (
          <>
            <ButtonFace className="fx-tempo" aria-label={`Tap tempo, now ${Math.round(state.bpm)} bpm (T)`} title="Tap the tempo (T)" onClick={() => send({ kind: 'tap' })}>
              TAP <b>{Math.round(state.bpm)}</b>
            </ButtonFace>
            <NumberField
              param={BPM}
              value={Math.round(state.bpm)}
              onChange={(v) => set({ kind: 'bpm', bpm: Math.round(v) }, { bpm: Math.round(v) })}
              name="bpm"
              label="Tempo in BPM"
              title="Type or drag a tempo"
            />
          </>
        )}
        <Segmented
          name="beats from"
          items={['tempo', 'audio']}
          index={state.sync === 'audio' ? 1 : 0}
          onChange={(i) => {
            const source: fx.Sync = i === 1 ? 'audio' : 'tempo';
            set({ kind: 'sync', source }, { sync: source });
          }}
          title="What strobe and punch-on-beat follow: the tempo, or beats heard in the bass"
        />
        <Segmented
          name="strobe per beat"
          items={RATE_NAMES}
          index={nearest(RATES, state.strobe_rate)}
          onChange={(i) => set({ kind: 'strobe_rate', rate: RATES[i] }, { strobe_rate: RATES[i] })}
          title="Strobe flashes per beat"
        />
        <Segmented
          name="strobe"
          items={['white', 'black']}
          index={state.strobe_style === 'black' ? 1 : 0}
          onChange={(i) => {
            const style: fx.StrobeStyle = i === 1 ? 'black' : 'white';
            set({ kind: 'strobe_style', style }, { strobe_style: style });
          }}
          title="Flash to white, or to black"
        />
        <Segmented
          name="mirror"
          items={MIRROR_NAMES}
          index={Math.max(0, MIRRORS.indexOf(state.mirror))}
          onChange={(i) => set({ kind: 'mirror', mode: MIRRORS[i] }, { mirror: MIRRORS[i] })}
          title="Mirror the picture (M steps through)"
        />
        <Toggle on={state.invert} onChange={(on) => set({ kind: 'invert', on }, { invert: on })} layout="inside" name="invert" label="invert" title="Invert the colours (I)">
          {state.invert ? 'on' : 'off'}
        </Toggle>
        <Toggle
          on={state.punch_on_beat}
          onChange={(on) => set({ kind: 'punch_on_beat', on }, { punch_on_beat: on })}
          layout="inside"
          name="punch on beat"
          label="punch on beat"
          title="Punch on every beat"
        >
          {state.punch_on_beat ? 'on' : 'off'}
        </Toggle>
      </div>
      <div className="fx-grid">
        {taper(SPEED, state.speed, (v) => set({ kind: 'speed', speed: v }, { speed: v }), 'How fast the preset runs, ¼× to 4×')}
        {slider(TRANSITION, state.transition, (v) => set({ kind: 'transition', seconds: v }, { transition: v }), `${state.transition.toFixed(1)} s`, 'The blend into the next preset; 0 is a hard cut')}
        {slider(BRIGHTNESS, state.brightness, (v) => set({ kind: 'brightness', value: v }, { brightness: v }), state.brightness.toFixed(2), 'Brightness; 1 is as drawn')}
        {slider(HUE, state.hue, (v) => set({ kind: 'hue', value: v }, { hue: v }), `${Math.round(state.hue * 360)}°`, 'Turn the colours round the wheel')}
        {slider(TRAILS, state.trails, (v) => set({ kind: 'trails', value: v }, { trails: v }), state.trails.toFixed(2), 'Trails: how much of the last frames stays')}
        {taper(SENSITIVITY, state.sensitivity, (v) => set({ kind: 'sensitivity', value: v }, { sensitivity: v }), 'How loud the presets hear the audio, ¼× to 4×')}
        {slider(
          INTENSITY,
          state.strobe_intensity,
          (v) => set({ kind: 'strobe_intensity', value: v }, { strobe_intensity: v }),
          `${Math.round(state.strobe_intensity * 100)}%`,
          'How hard the strobe flashes',
        )}
        {slider(FADE, state.blackout_fade, (v) => set({ kind: 'blackout_fade', seconds: v }, { blackout_fade: v }), `${state.blackout_fade.toFixed(1)} s`, 'How long blackout takes to fade')}
      </div>
    </section>
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

/** A setting's row: its name, then its control. */
function Row({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="fx-setting">
      <span className="fx-setting-name">{name}</span>
      <span className="fx-setting-control">{children}</span>
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
    <div className="wdg fx-settings">
      <Row name={Say('strobe rate')}>
        <Segmented
          name={say('strobe rate')}
          items={RATE_NAMES}
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
