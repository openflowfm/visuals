import { ActionButton } from '@satoramoto/zen';
import type { Param } from '@satoramoto/zen';
import { Segmented } from '@satoramoto/zen';
import { Toggle } from '@satoramoto/zen';
import { Hit, HUE, hueText, MIRROR_LABELS, MIRROR_NAMES, MIRRORS, slide, SPEED, TRAILS, useFx, type FxControl } from '../Effects/Effects';
import { Text } from '@satoramoto/zen';
import { formatMultiplier, multiplierToPosition, positionToMultiplier } from '../model/controls';
import type * as fx from '../model/fx';
import { Sheet } from '../Settings/Settings';
import { NoticeBanner } from '../Views/Views';
import { Say } from '../model/words';
import './MoreEffects.css';

/** What a sheet's effect controls take: the effects' state and how to change them. */
export type FxProps = Pick<FxControl, 'set'> & { state: fx.Fx };

/** One of the effect amounts (Speed, Colour, Trails), as every host draws it: the slider's parameter, its position and reading, what moving it sends, its tooltip. */
export interface FxSlide {
  id: 'speed' | 'hue' | 'trails';
  /** The row's name: "Speed", "Colour", "Trails". */
  name: string;
  param: Param;
  /** The slider's position (Speed's is on the log taper). */
  value: number;
  onChange(v: number): void;
  display: string;
  title: string;
}

/** Speed, Colour and Trails: one list, so the drawer and the Stage's effects panel send the same actions with the same names and tooltips. */
export function fxSlides({ state, set }: FxProps): FxSlide[] {
  return [
    {
      id: 'speed',
      name: 'Speed',
      param: SPEED,
      value: multiplierToPosition(state.speed),
      onChange: (p) => {
        const v = positionToMultiplier(p);
        set({ kind: 'speed', speed: v }, { speed: v });
      },
      display: formatMultiplier(state.speed),
      title: 'How fast the preset runs, ¼× to 4×',
    },
    { id: 'hue', name: 'Colour', param: HUE, value: state.hue, onChange: (v) => set({ kind: 'hue', value: v }, { hue: v }), display: hueText(state.hue), title: 'Turn the colours round the wheel' },
    {
      id: 'trails',
      name: 'Trails',
      param: TRAILS,
      value: state.trails,
      onChange: (v) => set({ kind: 'trails', value: v }, { trails: v }),
      display: state.trails.toFixed(2),
      title: 'Trails: how much of the last frames stays',
    },
  ];
}

/** Mirror: the core `Segmented`, its four modes (M steps through). */
export function MirrorSwitch({ state, set }: FxProps) {
  return (
    <Segmented
      label="mirror"
      items={MIRROR_NAMES}
      itemLabels={MIRROR_LABELS}
      index={Math.max(0, MIRRORS.indexOf(state.mirror))}
      onChange={(i) => set({ kind: 'mirror', mode: MIRRORS[i] }, { mirror: MIRRORS[i] })}
      title="Mirror the picture side to side, top to bottom, or both (M steps through)"
    />
  );
}

/** Invert: the core `Toggle`, its state read at its end (I). */
export function InvertSwitch({ state, set }: FxProps) {
  return (
    <Toggle on={state.invert} onChange={(on) => set({ kind: 'invert', on }, { invert: on })} layout="inside" label="invert" title="Flip the colours (I)">
      {state.invert ? 'on' : 'off'}
    </Toggle>
  );
}

/** Reset's tooltip: what goes back to normal and what stays (0). */
export const RESET_TITLE = 'Every effect back to normal; tempo and sensitivity stay (0)';

/**
 * **Job.** The drawer's controls: Speed, Colour and Trails (double-click resets each), Mirror,
 * Invert, a held Punch, and everything back to normal. Each goes out as a live action, as a
 * controller's would (M, I, P, 0).
 *
 * **Changed.** Rows are type: a name, then its control, on space alone. Mirror is the core
 * `Segmented` (the visuals tabs material: words, the chosen one underlined in the accent); Invert
 * the core `Toggle` read at its row's end; Reset a quiet `ActionButton`. The controls themselves
 * (`fxSlides`, `MirrorSwitch`, `InvertSwitch`, `RESET_TITLE`) are exported, so the Stage's effects
 * panel (EffectsPanel) draws the same ones.
 *
 * **Kept.** The grid (sliders across the top, the switches down the left, Punch beside them,
 * Reset under both; one column when narrow), every name, label, tooltip and action.
 *
 * **Tuning knobs.** `--vs-more-fx-punch`: the column Punch takes beside the switches
 * (`calc(var(--space-5) * 7)`, the original's 168px).
 */
export function MoreFx({ state, set, send }: Pick<FxControl, 'set' | 'send'> & { state: fx.Fx }) {
  return (
    <div className="vs-more-fx-body">
      {fxSlides({ state, set }).map((s) => (
        <Text as="div" weight="strong" className={`vs-more-fx-row vs-more-fx-${s.id}`} key={s.id}>
          <span>{s.name}</span>
          {slide(s.param, s.value, s.onChange, s.display, s.title)}
        </Text>
      ))}
      <Text as="div" weight="strong" className="vs-more-fx-row vs-more-fx-mirror">
        <span>Mirror</span>
        <MirrorSwitch state={state} set={set} />
      </Text>
      <Text as="div" weight="strong" className="vs-more-fx-row vs-more-fx-invert">
        <span>Invert</span>
        <InvertSwitch state={state} set={set} />
      </Text>
      <div className="vs-more-fx-hits">
        <Hit kind="punch" on={state.punch} hold label="Punch" keyName="P" send={send} />
      </div>
      <ActionButton tone="quiet" onPress={() => send({ kind: 'fx_reset' })} className="vs-more-fx-reset" title={RESET_TITLE}>
        Reset: {Say('fx reset').toLowerCase()}
      </ActionButton>
    </div>
  );
}

/** The drawer's body: the effects once they've been read. */
function Body() {
  const { state, set, send, notice, dismiss } = useFx();
  return (
    <>
      {state ? <MoreFx state={state} set={set} send={send} /> : !notice && <p role="status">Reading the effects…</p>}
      <NoticeBanner notice={notice} onDismiss={dismiss} />
    </>
  );
}

/**
 * **Job.** The More effects drawer (#98), one tap from live: opened with `openSheet('effects')`
 * from Views, mounted by the app. It leaves the show uncovered and the live controls usable behind
 * it, so it is a dialog but not a modal one: Tab keeps to it, while a click behind it still works.
 *
 * **Changed.** Drawn by Settings' `Sheet` on the core `Sheet` (`side="bottom"`, `modal={false}`):
 * an `overlay` layer along the bottom, centred, no scrim. It sits over the native preview, so it
 * is `Opaque` (the layer's solid, no blur), not glass. Live's Stage no longer opens it: its
 * effects are the Stage's own panel (EffectsPanel), on these same controls.
 *
 * **Kept.** `open`/`onClose`, the name "More effects", Esc and the close button ("Close more
 * effects"), the focus handling, and the loading line.
 */
export function MoreEffects({ open, onClose }: { open: boolean; onClose(): void }) {
  if (!open) return null;
  return (
    <Sheet title="More effects" className="vs-more-fx" side="bottom" onClose={onClose}>
      <Body />
    </Sheet>
  );
}
