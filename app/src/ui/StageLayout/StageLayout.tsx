import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { Layer, Opaque } from '@satoramoto/zen';
import { Screen } from '@satoramoto/zen';
import { lengthSum, type Form, type Forms, type Length, type RegionSpec, type ScreenSpec, type Units } from '@satoramoto/zen';
import { Ambient, type AmbientSource } from '@satoramoto/zen';
import { Surface } from '@satoramoto/zen';
import { Text } from '@satoramoto/zen';
import { LEAVE_HOLD_MS } from '../model/liveKeys';
import type { StageLayoutProps } from '../model/stage-model';
import { Preview } from '../Views/Views';
import { useLayoutPrinciples } from '../HomeLayout/HomeLayout';
import { STAGE_DOCK_FORMS } from '../StageDock/StageDock';
import { STAGE_HEAD_FORMS } from '../StageHead/StageHead';
import './StageLayout.css';

/* ---------- the Stage's parts, declared (docs/assembly.md) ---------- */

/** The header's 16px inset from the window's right edge. */
const INSET: Units = { space: 4 };
/** The window buttons' room at the header's start, 84px: x 24, three 12px buttons 8px apart, and 8px after. */
export const LIGHTS: Units = { space: [5, 3, 3, 3, 2, 2, 2] };
/** The controls' room round them on the scrim: 32px either side (the keys' hit areas reach 8px past their glyphs, so the glyphs sit on a 40px margin), 20px over them under the header, 36px under. */
const CONTROLS_W: Length = { space: [6, 6] };
const CONTROLS_H: Length = { space: [6, 5] };

/** Forms with room added on each axis (the insets, the lights' room). */
function padded(forms: Forms, w: Length, h: Length): Forms {
  const add = (n: Form['min']) => ({ w: lengthSum(n.w, w), h: lengthSum(n.h, h) });
  return forms.map((f): Form => ({ ...f, min: add(f.min), ideal: add(f.ideal) })) as unknown as Forms;
}

/**
 * The Stage's screen: one column over the whole picture, the header's row on the window buttons'
 * line and under it the controls (`dock`: the transport filling the picture's middle, the effects'
 * row at its foot). The controls are `now`, the header `chrome`, so the header shortens its words
 * first. Every region is plateless: the shell paints only the scrim, over the picture.
 */
export function stageSpec(): ScreenSpec {
  const region = (id: string, forms: Forms, priority: RegionSpec['priority']): RegionSpec => ({ id, forms, priority, plate: false });
  const head = padded(STAGE_HEAD_FORMS, lengthSum(LIGHTS, INSET), 0);
  const dock = padded(STAGE_DOCK_FORMS, CONTROLS_W, CONTROLS_H);
  return { rows: [[{ id: 'column', rows: [[region('head', head, 'chrome')], [region('dock', dock, 'now')]] }]] };
}

/** What the controls over the picture are called to a screen reader. */
export const DOCK_LABEL = 'Live controls';

/** What the progress says while Esc is held to leave live. */
export const LEAVING_TEXT = 'Keep holding Esc to leave live';

/**
 * The shell's props: the contract's `StageLayoutProps` less the crate, the hidden panels and the
 * window's size (Live has no crate, nothing hides now, and the screen fills its box), plus the pin, the effects panel, the library map and the ambient light.
 */
export type StageProps = Pick<StageLayoutProps, 'warning' | 'inWindow' | 'leaving' | 'head' | 'dock' | 'centre' | 'children'> & {
  /** `\`: the controls stay shown, hovered or not. */
  pinned?: boolean;
  /** The effects panel (`EffectsPanel`) while it is open, docked at the left under the header, over the controls' room; null or left out: none. */
  panel?: ReactNode;
  /** The library map (`LiveMap`) while it is open, at the right under the header, as tall as it needs down to the controls' foot row; null or left out: none. */
  side?: ReactNode;
  /** The picture the panel's and popovers' surfaces take their light from (the playing preset's thumbnail). */
  ambient?: AmbientSource;
};

/**
 * Esc held toward leaving: a ring filling over `LEAVE_HOLD_MS` from the press,
 * and the line saying to keep holding, in an opaque card over the picture's
 * middle. It shows after a beat (StageLayout.css), so a short press shows nothing.
 */
function Leaving() {
  return (
    <div className="vs-stagelayout-leaving" role="status" style={{ '--vs-stagelayout-hold': `${LEAVE_HOLD_MS}ms` } as CSSProperties}>
      <Layer level="top" className="vs-stagelayout-leaving-card">
        <svg className="vs-stagelayout-ring" viewBox="0 0 40 40" aria-hidden="true">
          <circle className="vs-stagelayout-ring-track" cx="20" cy="20" r="17" />
          <circle className="vs-stagelayout-ring-fill" cx="20" cy="20" r="17" pathLength={1} />
        </svg>
        <Text as="p" weight="strong" className="vs-stagelayout-leaving-line">
          {LEAVING_TEXT}
        </Text>
      </Layer>
    </div>
  );
}

/**
 * **Job.** Live's Stage: the picture full-bleed across the main window, and over it one overlay
 * that fades in and out as Home's preview controls do: the header (`head`) on the window buttons'
 * line and the controls (`dock`, "Live controls") under it, on a scrim from the window's tint at
 * the top and the foot. The overlay shows while the window is hovered, while focus is in it or one
 * of its popovers is open (or the effects panel: its Effects button is expanded), while `pinned`
 * (`\`), and always with no hover (touch). The effects panel (`panel`) docks at the left in the
 * overlay, 20px in from the window's left and under the header, ending above the controls' foot
 * row, so the Effects button under it stays in sight. The library map (`side`) sits the same way
 * at the right: 20px in from the window's right, 64px down, 380px wide and as tall as its content,
 * never past the panel's foot line. With both open they never overlap: each is at most what the
 * other and three insets leave of the window's width. Tab goes to the panel, then the map, then
 * the header and the controls. With the warning owed the picture is dark (the preview isn't
 * mounted), the controls and both panels inert, the controls dimmed, and `centre` (the warning) centred over the window. While Esc is held to leave live
 * (`leaving`), its progress shows over everything; the output never shows it. The whole Stage is
 * an `Ambient` lit by `ambient`, so the float surfaces over it take the picture's colours.
 *
 * **Changed.** No crate and no dock bar: the inset panels are gone, the header is bare type, and
 * the controls float on the scrim (Hero's look: its scrim and fade, the same knobs). Nothing hides
 * the controls any more, so `\` pins them shown; the peek hint is gone. Design C: no corner toasts
 * ("Go full screen on…" is in the Output light's popover, the notices quiet words in the header);
 * the controls keep a 40px margin at the sides (their 32px room and the keys' own 8px) and sit
 * 36px over the foot; the effects panel and the library map are the overlay's solids, one at
 * either side (the root says `data-panel` and `data-side` while they show). The window is still an
 * assembled `Screen` (`stageSpec`, docs/assembly.md) over the picture: the header and the
 * controls take their forms from the room they are given. Everything sits in one `Opaque` scope,
 * so each layer over the picture draws its solid and no backdrop.
 *
 * **Kept.** The drag region, the warning's dark window, the Esc hold's progress, the copy.
 *
 * **Tuning knobs** (StageLayout.css), sizes the scale has no step for:
 * - `--vs-stagelayout-titlebar`: the title bar's 52px (layout.css `--lay-titlebar`).
 * - `--vs-stagelayout-lights`: the window buttons' room, 84px.
 * - `--vs-stagelayout-fade` (160ms, Hero's `--vs-hero-fade`): how long the overlay fades (none under reduced motion).
 * - `--vs-stagelayout-scrim` (85%, Hero's `--vs-hero-scrim`): how much of the window's tint the scrim starts with.
 * - `--vs-stagelayout-panel` (340px): the effects panel's width; `--vs-stagelayout-panel-inset`
 *   (20px): its inset from the window's left; `--vs-stagelayout-panel-top` (64px) and
 *   `--vs-stagelayout-panel-foot` (100px): where it starts under the header and ends over the foot row.
 * - `--vs-stagelayout-side` (380px): the library map's width; it takes the panel's inset (from the
 *   window's right), top and foot (the lowest its content may reach).
 * - `--vs-stagelayout-z-*`: the parts' stacking over the picture.
 * - `--vs-stagelayout-hold`: Esc's hold (`LEAVE_HOLD_MS`), set inline on the progress.
 * - `--vs-hole-radius`: Views' `Preview` knob, set to 0 here (the picture is square; macOS rounds the window).
 */
export function StageLayout({ pinned = false, warning = false, inWindow, leaving = false, head, dock, centre, panel, side, ambient, children }: StageProps) {
  const principles = useLayoutPrinciples();
  const spec = useMemo(() => stageSpec(), []);
  const hasPanel = panel != null && panel !== false;
  const hasSide = side != null && side !== false;
  return (
    <Ambient
      source={ambient}
      className="vs-stagelayout"
      data-view="live"
      data-pinned={pinned ? '' : undefined}
      data-warning={warning ? '' : undefined}
      data-windowed={inWindow ? '' : undefined}
      data-panel={hasPanel ? '' : undefined}
      data-side={hasSide ? '' : undefined}
    >
      <Opaque className="vs-stagelayout-opaque">
        {/* The picture: the whole window under everything, whatever shows over it. */}
        {warning ? <div className="vs-stagelayout-dark" aria-hidden="true" /> : <Preview className="vs-stagelayout-picture" />}

        {/* The one overlay: the scrim, the header and the controls, fading together. */}
        <div className="vs-stagelayout-reveal" data-pinned={pinned ? '' : undefined}>
          <Surface radius="none" className="vs-stagelayout-scrim" aria-hidden="true" />
          {/* The panels first in the tab order, the effects then the map: opened by E or G with focus on the picture, Tab reaches them next. */}
          {hasPanel && (
            <div className="vs-stagelayout-panel" inert={warning || undefined}>
              {panel}
            </div>
          )}
          {hasSide && (
            <div className="vs-stagelayout-side" inert={warning || undefined}>
              {side}
            </div>
          )}
          <Screen
            name="Stage"
            className="vs-stagelayout-screen"
            spec={spec}
            principles={principles}
            regions={{
              head: (
                <div className="vs-stagelayout-head" data-tauri-drag-region>
                  {head}
                </div>
              ),
              dock: (
                <div className="vs-stagelayout-dock" role="region" aria-label={DOCK_LABEL} inert={warning || undefined}>
                  {dock}
                </div>
              ),
            }}
          />
        </div>

        {warning && centre != null && <div className="vs-stagelayout-centre">{centre}</div>}

        {children}

        {leaving && <Leaving />}
      </Opaque>
    </Ambient>
  );
}
