import { useEffect, type KeyboardEvent } from 'react';
import { ActionButton, ActionButtonFace as ButtonFace } from '@satoramoto/zen';
import type { Param } from '@satoramoto/zen';
import { Slider } from '@satoramoto/zen';
import { Surface } from '@satoramoto/zen';
import { Text } from '@satoramoto/zen';
import { Hit, useFx } from '../Effects/Effects';
import { titleOf } from '../HelpOverlay/HelpOverlay';
import { Icon } from '../Icon/Icon';
import { range } from '../model/controls';
import type { LiveState } from '../model/live-model';
import { fxSlides, InvertSwitch, MirrorSwitch, RESET_TITLE } from '../MoreEffects/MoreEffects';
import { NoticeBanner } from '../Views/Views';
import './EffectsPanel.css';

/** The panel's id: the Effects button names it in `aria-controls`. */
export const EFFECTS_PANEL_ID = 'stage-effects';

/** What the panel is called, to a screen reader and on its head. */
export const EFFECTS_LABEL = 'Effects';

/** Intensity's range: 0–1, a double-click back to the middle (1× sensitivity), as the Stage's slider had it. */
const INTENSITY = range('intensity', 0, 1, 0.5);

/** The held effects, as pads: S, B, F, P (Blackout toggles; the others hold, Shift latches). */
const PADS = [
  { kind: 'strobe', label: 'Strobe', keyName: 'S', hold: true },
  { kind: 'blackout', label: 'Blackout', keyName: 'B', hold: false },
  { kind: 'freeze', label: 'Freeze', keyName: 'F', hold: true },
  { kind: 'punch', label: 'Punch', keyName: 'P', hold: true },
] as const;

/** The keys a slider or a switch answers itself: kept from live's keys (←/→ would step the preset too). */
const OWN_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
function keepOwnKeys(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  if (OWN_KEYS.has(e.key) && t.closest?.('[role="slider"], [role="radio"], [role="radiogroup"]')) e.stopPropagation();
}

/** One amount as a slider row: its name leading, its reading trailing, the groove under them (the core `Slider`'s `row`). */
function Amount({ name, param, value, onChange, display, title }: { name: string; param: Param; value: number; onChange(v: number): void; display: string; title: string }) {
  return (
    <Slider
      param={param}
      value={value}
      onChange={onChange}
      display={display}
      layout="row"
      length="auto"
      fill
      origin="min"
      name={name}
      label={param.name}
      title={`${title} (double-click resets)`}
      className="vs-effects-panel-amount"
    />
  );
}

/**
 * **Job.** Live's effects panel (design C): docked at the Stage's left under the header, the
 * picture still showing beside it, in the material of Home's side panels (a `raised` Surface, its
 * light from the picture's left). In order: the held effects as four pads ("Hold · ⇧ to latch":
 * Strobe S, Blackout B, Freeze F, Punch P), the amounts as slider rows (Intensity, Speed, Colour,
 * Trails), Mirror and Invert, and "Back to normal" (0) at its foot. ✕ (or E, or Esc) closes it.
 * Not a dialog: live's keys keep working while it is open (only a slider's or a switch's own
 * arrows stay theirs).
 *
 * **Changed.** New: it replaces the bottom More effects drawer and the Stage's effects row. Its
 * controls are the drawer's (`fxSlides`, `MirrorSwitch`, `InvertSwitch`, Effects' `Hit`), its
 * state the drawer's own `useFx` (read once, then followed), Intensity live's.
 *
 * **Kept.** Every effect's name, key, tooltip and action, as the drawer and the effects row had them.
 *
 * **Tuning knobs** (EffectsPanel.css): `--vs-effects-panel-pad`, the pads' height (56px).
 */
export function EffectsPanel({ live, onClose, focusOnOpen = false }: { live: LiveState; onClose(): void; focusOnOpen?: boolean }) {
  const { state, set, send, notice, dismiss } = useFx();
  // Opened by the Effects button: focus moves to its first pad (E leaves focus on the picture).
  useEffect(() => {
    if (!focusOnOpen) return;
    const panel = document.getElementById(EFFECTS_PANEL_ID);
    (panel?.querySelector<HTMLElement>('.vs-effects-panel-hold button') ?? panel?.querySelector<HTMLElement>('button'))?.focus();
    // On mount only: a later prop change never moves focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pct = Math.round(live.intensity * 100);
  return (
    <Surface as="aside" layer="raised" ambient="left" className="vs-effects-panel" id={EFFECTS_PANEL_ID} aria-label={EFFECTS_LABEL} onKeyDown={keepOwnKeys}>
      <Text as="div" className="vs-effects-panel-head">
        <Text as="h2" weight="strong" leading="tight" className="vs-effects-panel-title">
          {EFFECTS_LABEL}
        </Text>
        <ButtonFace tone="quiet" className="vs-effects-panel-close" aria-label="Close effects" aria-keyshortcuts="E" title="Close effects (E)" onClick={onClose}>
          <Icon name="close" size={14} />
        </ButtonFace>
      </Text>
      <section className="vs-effects-panel-hold" aria-label="Hold">
        <Text role="caption" leading="normal" className="vs-effects-panel-caption">
          Hold · ⇧ to latch
        </Text>
        <div className="vs-effects-panel-pads">
          {PADS.map((p) => (
            <Hit key={p.kind} kind={p.kind} on={state?.[p.kind] === true} hold={p.hold} label={p.label} keyName={p.keyName} send={send} />
          ))}
        </div>
      </section>
      <section className="vs-effects-panel-amounts" aria-label="Amounts">
        <Amount name="Intensity" param={INTENSITY} value={live.intensity} onChange={live.setIntensity} display={`${pct}%`} title={titleOf('intensity')} />
        {state && fxSlides({ state, set }).map((s) => <Amount key={s.id} name={s.name} param={s.param} value={s.value} onChange={s.onChange} display={s.display} title={s.title} />)}
      </section>
      {state ? (
        <section className="vs-effects-panel-switches" aria-label="Switches">
          <Text as="div" className="vs-effects-panel-row">
            <span>Mirror</span>
            <MirrorSwitch state={state} set={set} />
          </Text>
          <Text as="div" className="vs-effects-panel-row">
            <span>Invert</span>
            <InvertSwitch state={state} set={set} />
          </Text>
        </section>
      ) : (
        !notice && (
          <Text as="p" role="caption" className="vs-effects-panel-caption" ariaRole="status">
            Reading the effects…
          </Text>
        )
      )}
      <NoticeBanner notice={notice} onDismiss={dismiss} />
      <span className="vs-effects-panel-fill" />
      <ActionButton tone="quiet" onPress={() => send({ kind: 'fx_reset' })} className="vs-effects-panel-reset" title={RESET_TITLE}>
        Back to normal
        <Text as="small" role="numeral" weight="body" className="vs-effects-panel-key" aria-hidden="true">
          0
        </Text>
      </ActionButton>
    </Surface>
  );
}
