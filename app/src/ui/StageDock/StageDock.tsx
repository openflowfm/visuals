import { useEffect, useState } from 'react';
import { ActionButtonFace as ButtonFace } from '@satoramoto/zen';
import { useForm, type Forms, type Length } from '@satoramoto/zen';
import { Text } from '@satoramoto/zen';
import { EFFECTS_PANEL_ID } from '../EffectsPanel/EffectsPanel';
import { titleOf } from '../HelpOverlay/HelpOverlay';
import { Icon } from '../Icon/Icon';
import { movesByItself, playsFrom, presetLength } from '../model/home';
import type { LiveState } from '../model/live-model';
import { nameOf, notice } from '../model/shell';
import type { StageDockProps } from '../model/stage-model';
import { TransportBar, type TransportBarProps } from '../TransportBar/TransportBar';
import './StageDock.css';

export type StageDockForm = 'full' | 'stacked';

/** The controls over the picture under the header: the preset's two lines at the top, the one row at the foot (150px at the least). */
const H_ONE: Length = { control: 5 };
/** The preset's name wrapped once (another 30px). */
const H_TWO: Length = { control: 6 };

/** what the controls over the picture need (no outer insets: StageLayout adds those) */
export const STAGE_DOCK_FORMS: Forms<StageDockForm> = [
  // full: Effects with its word on the row's left, ◀ ring ▶ dead centre, the dice and star at the right, clear of one another — 996px (a 1060px window less the 32px either side)
  { id: 'full', min: { w: { unit: 249 }, h: H_ONE }, ideal: { w: { unit: 249 }, h: H_ONE }, grow: { w: true, h: true } },
  // stacked: Effects its glyph alone, so the row keeps to one line in a narrow window
  { id: 'stacked', min: { w: { control: 10 }, h: H_TWO }, ideal: { w: { control: 10 }, h: H_TWO }, grow: { w: true, h: true } },
];

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
 * Home's floating transport driving the deck: the auto-change ring is HOLD (H; its tooltip says
 * whether and when it moves on), ◀ ▶ step, the dice random, the preset playing and where from at
 * the picture's top left; the dice and star at the foot's right end (`footStar`), ◀ ring ▶ dead
 * centre, no audio input (it is in the header, as Home's).
 */
function useTransport(live: LiveState): TransportBarProps {
  const deck = live.deck;
  const position = useElapsed(live.current, live.since, deck ? presetLength({ ...deck, hold: live.held }) : null);
  const name = live.current ? nameOf(live.current) : null;
  return {
    layout: 'overlay',
    audio: false,
    diceByStar: true,
    centreKeys: true,
    footStar: true,
    playing: !live.held,
    onPlayPause: () => live.actFx({ kind: 'hold', on: null }),
    onStep: (by) => live.act({ kind: by === -1 ? 'previous' : by === 1 ? 'next' : 'random' }),
    stepIn: deck?.playlist ? ' in the playlist' : '',
    position,
    moves: deck ? movesByItself(deck) : false,
    onAudioError: (e) => live.setError(notice("Couldn't use that audio input.", e)),
    now: name ? { name, from: deck && live.lists ? playsFrom(deck, live.lists.playlists) : undefined } : null,
    star: live.current && live.key ? { on: live.star, onToggle: live.favourite } : null,
  };
}

/** The props the Stage's controls take: live, and the effects panel's toggle. */
export type StageDockOwnProps = StageDockProps & {
  form?: StageDockForm;
  /** Whether the effects panel is open: the Effects button pressed, the preset's name clear of the panel. */
  effectsOpen?: boolean;
  /** The Effects button (as E): open the effects panel, or close it. Left out: no Effects button. */
  onEffects?: () => void;
};

/**
 * **Job.** Live's controls over the picture (see `StageDockProps`), under the header: Home's
 * floating transport (`TransportBar layout="overlay"`) with the preset and where it plays from at
 * the top left and, at the foot, one row on one line: Effects (the spark and its word, E) on the
 * left, ◀ the auto-change ring ▶ dead centre, the dice and star on the right. Effects opens the
 * Stage's effects panel (`EffectsPanel`, which the shell docks at the left) and is pressed while it
 * shows; the preset's name then moves right, clear of it. The shell places this and fades it in
 * with the header (StageLayout); this paints nothing.
 *
 * **Changed.** Design C: the effects' row (Strobe, Blackout, Freeze, Intensity, More effects…) is
 * gone from the foot; the effects are all in the panel. The dice and star sit at the foot's right
 * end, not the picture's top right. The forms are `full` (Effects with its word) and `stacked` (a
 * narrow window: Effects its glyph alone), from the room the shell gives it (`STAGE_DOCK_FORMS`),
 * or the `form` prop. `EffectKey` and the corner toasts (`StageNotices`) are gone: the notices are
 * quiet words in the header (StageHead).
 *
 * **Kept.** The props, the transport's keys, names and tooltips, HOLD as the ring.
 *
 * **Tuning knobs** (StageDock.css): `--vs-stagedock-clear`, how far the preset's name moves right
 * while the effects panel shows (368px: the panel's 340 and its 20px inset, less the dock's own
 * 32px, plus 8 so the name stays on the 40px margin's line beside it).
 */
export function StageDock({ live, form, effectsOpen = false, onEffects }: StageDockOwnProps) {
  const f = useForm(STAGE_DOCK_FORMS, form);
  const transport = useTransport(live);
  const effects = onEffects && (
    <ButtonFace
      tone="quiet"
      className="vs-stagedock-effects"
      aria-label="Effects"
      aria-expanded={effectsOpen}
      aria-controls={effectsOpen ? EFFECTS_PANEL_ID : undefined}
      aria-keyshortcuts="E"
      title={titleOf('effects')}
      onClick={onEffects}
    >
      <Icon name="effects" />
      <Text size="label" weight="strong" leading="tight" className="vs-stagedock-effects-word" aria-hidden="true">
        Effects
      </Text>
      <Text as="small" role="numeral" weight="body" className="vs-stagedock-effects-key" aria-hidden="true">
        E
      </Text>
    </ButtonFace>
  );
  return (
    <div className="vs-stagedock" data-form={f} data-panel={effectsOpen ? '' : undefined}>
      <TransportBar {...transport} lead={effects} />
    </div>
  );
}
StageDock.forms = STAGE_DOCK_FORMS;
