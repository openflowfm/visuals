import { Button } from '@openflow/widgets/controls/Button.tsx';
import { Segmented } from '@openflow/widgets/controls/Segmented.tsx';
import { Toggle } from '@openflow/widgets/controls/Toggle.tsx';
import { Hit, HUE, hueText, MIRROR_LABELS, MIRROR_NAMES, MIRRORS, slide, SPEED, taperSlide, TRAILS, useFx, type FxControl } from './Effects.tsx';
import type * as fx from './fx.ts';
import { Sheet } from './Settings.tsx';
import { NoticeBanner } from './views.tsx';
import { Say } from './words.ts';

/**
 * The drawer's controls: Speed, Colour and Trails (double-click resets each),
 * Mirror, Invert, a held Punch, and everything back to normal. Each goes out as
 * a live action, as a controller's would (M, I, P, 0).
 */
export function MoreFx({ state, set, send }: Pick<FxControl, 'set' | 'send'> & { state: fx.Fx }) {
  return (
    <div className="wdg fx more-fx-body">
      <div className="more-fx-row more-fx-speed">
        <span>Speed</span>
        {taperSlide(SPEED, state.speed, (v) => set({ kind: 'speed', speed: v }, { speed: v }), 'How fast the preset runs, ¼× to 4×')}
      </div>
      <div className="more-fx-row more-fx-hue">
        <span>Colour</span>
        {slide(HUE, state.hue, (v) => set({ kind: 'hue', value: v }, { hue: v }), hueText(state.hue), 'Turn the colours round the wheel')}
      </div>
      <div className="more-fx-row more-fx-trails">
        <span>Trails</span>
        {slide(TRAILS, state.trails, (v) => set({ kind: 'trails', value: v }, { trails: v }), state.trails.toFixed(2), 'Trails: how much of the last frames stays')}
      </div>
      <div className="more-fx-row more-fx-mirror">
        <span>Mirror</span>
        <Segmented
          name="mirror"
          items={MIRROR_NAMES}
          itemLabels={MIRROR_LABELS}
          index={Math.max(0, MIRRORS.indexOf(state.mirror))}
          onChange={(i) => set({ kind: 'mirror', mode: MIRRORS[i] }, { mirror: MIRRORS[i] })}
          title="Mirror the picture side to side, top to bottom, or both (M steps through)"
        />
      </div>
      <div className="more-fx-row more-fx-invert">
        <span>Invert</span>
        <Toggle on={state.invert} onChange={(on) => set({ kind: 'invert', on }, { invert: on })} layout="inside" name="invert" label="invert" title="Flip the colours (I)">
          {state.invert ? 'on' : 'off'}
        </Toggle>
      </div>
      <div className="fx-hits">
        <Hit kind="punch" on={state.punch} hold label="Punch" keyName="P" send={send} />
      </div>
      <Button tone="quiet" onPress={() => send({ kind: 'fx_reset' })} className="more-fx-reset" title="Every effect back to normal; tempo and sensitivity stay (0)">
        Reset: {Say('fx reset').toLowerCase()}
      </Button>
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
 * The More effects drawer (#98), one tap from live: opened with
 * `openSheet('effects')` from `views.tsx`, mounted by `App`. It leaves the
 * show uncovered and the live controls usable behind it, so it is a dialog
 * but not a modal one: Tab keeps to it, while a click behind it still works.
 */
export function MoreEffects({ open, onClose }: { open: boolean; onClose(): void }) {
  if (!open) return null;
  return (
    <Sheet title="More effects" className="more-fx" onClose={onClose}>
      <Body />
    </Sheet>
  );
}
