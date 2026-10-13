import { useEffect, useRef, type ReactNode } from 'react';
import { Group } from '@satoramoto/zen';
import { Text } from '@satoramoto/zen';
import { Numbers } from '../Numbers/Numbers';
import { SourcePicker } from '../SourcePicker/SourcePicker';
import { FrameRate } from '../Views/Views';
import { Icon, LOOP_HEAD, LOOP_RING, strokeFor } from '../Icon/Icon';
import type { Forms } from '@satoramoto/zen';
import './TransportBar.css';

/** The bar's one form (docs/assembly.md): ten controls across at least, growing; `--vs-transport-h` (`--space-6` and `--space-4`, 48px) high. */
export const TRANSPORT_FORMS: Forms<'bar'> = [{ id: 'bar', min: { w: { control: 10 }, h: { space: [6, 4] } }, ideal: { w: { control: 10 }, h: { space: [6, 4] } }, grow: { w: true } }];

/**
 * **Job.** The transport: floating over the foot of the home's preview (`layout="overlay"`, in
 * Hero's `controls`, shown on hover or focus), or docked along live mode's foot (`bar`). ◀ the auto-change ring ▶ R on the left; in
 * the middle the preset playing and where it plays from (`now`); the audio input on the right, and
 * before it a warning only while the picture draws slowly (`FrameRate slowOnly`). Opt-ins for the
 * overlay (all off by default, as Live has it): `audio={false}` leaves the input out entirely for a
 * host that mounts `TransportAudio` elsewhere; `diceByStar` moves the dice beside the star;
 * `centreKeys` puts ◀ ring ▶ dead centre along the foot. Home uses all three. Live's Stage adds
 * two more (also off by default): `footStar` brings the dice and star (with `diceByStar`) down to
 * the foot's right end, on the keys' line; `lead` puts its own control (the Effects button) at the
 * foot's left end. `TransportAudio`'s `slow={false}` leaves its slow-drawing warning out, for a host
 * that says it elsewhere (the Stage's header).
 *
 * **Changed.** Presets are endless (decision 86): no playhead, no time on it, no countdown, no
 * track. Where play/pause was, the auto-change key: a loop ring (`Icon` `loop`) that fills
 * clockwise with `elapsed / length` while the deck moves on by itself, full at the change, then
 * empty again at once (it never runs backwards). Held, the ring is empty and dimmed; with no length
 * (stays until moved on, Link's bars) it is the plain glyph; with nothing playing, quiet. A click
 * or H holds or lets go (`onPlayPause`); it is a toggle named "move on by itself", pressed while
 * the deck does, its tooltip saying what is happening, how long until the next change when known,
 * and what a click does (`loopTitle`). The keys are a library `Group` (unlabelled: the bar names
 * them); sizes and tones read the contract; the side padding is the main column's
 * `--mat-plate-inset`. The audio input is the library port of `SourcePicker`, quiet type at the
 * bar's end. The bar is a toolbar `Group` ("transport controls", inside the "transport" region),
 * so every control in it takes its quiet look by context.
 *
 * **Tuning knobs** (TransportBar.css):
 * - `--vs-transport-h` (48px): the bar's height, the keys' 36px and a little room above and below.
 * - `--vs-transport-tick` (1s): how long the ring eases between the position's ticks (none under
 *   reduced motion).
 *
 * **Kept.** Props (`position` now only feeds the ring and its tooltip; `moves` only the tooltip),
 * `clock`, the step keys and their titles, the "transport" region; the middle never running under
 * its neighbours. No preview, so no hole: the bar paints nothing, sitting over the hero's spread
 * shadow, which paints the main column.
 */
export interface TransportBarProps {
  /** Whether the deck is moving on by itself (the ring pressed and filling) or holding (the ring empty and dimmed). */
  playing: boolean;
  onPlayPause(): void;
  /** Step: -1 previous, 1 next, 0 random. */
  onStep(by: -1 | 0 | 1): void;
  /** Words added to the step buttons' tooltips, e.g. " in the playlist" ('' when none). */
  stepIn: string;
  /**
   * Seconds on the preset playing and its length before the deck moves on (the
   * deck's `seconds`); a null length when it stays until moved on (held, on
   * Link's bars, moving on by itself off): the ring has nothing to fill.
   * Null when nothing plays.
   */
  position: { elapsed: number; length?: number | null } | null;
  onAudioError(e: unknown): void;
  /** The audio input's last failure, shown on the input as a caution glyph (its message in the title); null or left out: none. */
  audioTrouble?: { message: string; detail: string | null } | null;
  /** The preset playing: its name, and where it plays from as `playsFrom` says it ("from Warm-up · 3 of 10"); null or left out: nothing playing. One line, the name brighter, ellipsised before the controls or the audio input give way. */
  now?: { name: string; from?: string } | null;
  /** The overlay only: the playing preset's star, at the picture's top right; pressed while starred. Left out: none. */
  star?: { on: boolean; onToggle(): void } | null;
  /** Whether the deck moves on by itself when not held (a playlist's timing, or Link's bars): with no length, the ring's tooltip says it moves on by itself rather than that it stays. Left out: it stays. */
  moves?: boolean;
  /**
   * `bar` (default): the 48px bar along a column's foot (live mode's dock). `overlay`: floating
   * over the preview's foot (Home, Hero's `controls`): no height or side padding of its own, and
   * in a narrow picture the preset's name takes its own line above the keys and the audio input.
   */
  layout?: 'bar' | 'overlay';
  /** False: no audio input side (no slow-drawing warning, no `SourcePicker`), not even mounted, for a host that shows it elsewhere (Home's header, `TransportAudio`). Default true. */
  audio?: boolean;
  /** The overlay only: the dice leaves the keys and sits immediately left of the star, in its corner (Home). Default false. */
  diceByStar?: boolean;
  /** The overlay only: the keys (◀ ring ▶) sit dead centre along the foot, the audio input (if any) still on the right (Home). Default false. */
  centreKeys?: boolean;
  /** The overlay with `diceByStar` only: the dice and star sit at the foot's right end, on the keys' line, not at the top right (Live's Stage). Default false. */
  footStar?: boolean;
  /** The overlay with `centreKeys` only: a control at the foot's left end, on the keys' line (Live's Effects button). Left out: none. */
  lead?: ReactNode;
}

/**
 * The audio input side: the slow-drawing warning, then the input. The bar's right end, or a host's own place for it (Home's header) with the bar's `audio={false}`.
 * `folded`: the source Select moves into the mixer's popover, so only the mixer icon and the meter show (Home). Default false (the bar keeps its Select).
 */
export function TransportAudio({ onAudioError, audioTrouble = null, folded = false, slow = true }: Pick<TransportBarProps, 'onAudioError' | 'audioTrouble'> & { folded?: boolean; slow?: boolean }) {
  return (
    <Text as="div" className="vs-transport-right">
      {slow && <FrameRate slowOnly />}
      <SourcePicker onError={onAudioError} channels="none" width={180} trouble={audioTrouble} folded={folded} />
    </Text>
  );
}

/** Seconds as m:ss. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** How far round the ring is: `elapsed / length`, 0–1; 0 when held, with no length, or with nothing playing. */
export function loopFill(playing: boolean, position: TransportBarProps['position']): number {
  if (!playing || !position || position.length === null || position.length === undefined) return 0;
  if (position.length <= 0) return 1;
  return Math.min(1, Math.max(0, position.elapsed / position.length));
}

/**
 * The ring's tooltip: what is happening, then what a click (or H) does. "Moves on in 0:18 · click
 * or H to stay on this preset" while it counts to a change; "Staying on this preset · click or H
 * to move on by itself" while held.
 */
export function loopTitle(playing: boolean, position: TransportBarProps['position'], moves: boolean): string {
  if (!playing) return 'Staying on this preset · click or H to move on by itself';
  const stay = 'click or H to stay on this preset';
  if (position && position.length !== null && position.length !== undefined) {
    const left = position.length - position.elapsed;
    return `${left > 0 ? `Moves on in ${clock(Math.ceil(left))}` : 'Moving on'} · ${stay}`;
  }
  return `${moves || !position ? 'Moves on by itself' : 'Stays until moved on'} · ${stay}`;
}

/** The ring's glyph: the loop, its unfilled ring quiet under a fill that runs clockwise along it to the arrowhead. */
function LoopRing({ fill, timed, size }: { fill: number; timed: boolean; size: number }) {
  // Back to empty at a change: no easing, so it never runs backwards round the ring.
  const last = useRef(fill);
  const back = fill < last.current;
  useEffect(() => {
    last.current = fill;
  }, [fill]);
  return (
    <svg
      className="vs-icon vs-transport-loop"
      data-icon="loop"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeFor(size)}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      {timed ? (
        <>
          <path className="vs-transport-loop-track" d={LOOP_RING} />
          <path
            className="vs-transport-loop-fill"
            d={LOOP_RING}
            pathLength={1}
            strokeDasharray="1 1"
            data-back={back ? '' : undefined}
            // An empty fill draws no dot at the start (a round cap on a zero-length dash would).
            style={{ strokeDashoffset: 1 - fill, opacity: fill > 0 ? undefined : 0 }}
          />
          <path className="vs-transport-loop-head" d={LOOP_HEAD} data-lit={fill >= 1 ? '' : undefined} />
        </>
      ) : (
        <path d={LOOP_RING + LOOP_HEAD} />
      )}
    </svg>
  );
}

/** The bar. */
export function TransportBar({
  playing,
  onPlayPause,
  onStep,
  stepIn,
  position,
  onAudioError,
  audioTrouble = null,
  now,
  moves = false,
  layout = 'bar',
  star = null,
  audio = true,
  diceByStar = false,
  centreKeys = false,
  footStar = false,
  lead = null,
}: TransportBarProps) {
  const top = layout === 'overlay' && diceByStar;
  const foot = top && footStar;
  const leading = layout === 'overlay' && lead != null;
  const dice = (
    <Text as="button" weight="strong" type="button" className="vs-transport-key vs-transport-random" aria-label="random preset" title={`Random preset${stepIn} (R)`} onClick={() => onStep(0)}>
      <Icon name="dice" />
    </Text>
  );
  const starKey = layout === 'overlay' && star && (
    <button type="button" className="vs-transport-key vs-transport-star" aria-label="star" aria-pressed={star.on} title={star.on ? 'Unstar this preset' : 'Star this preset'} onClick={star.onToggle}>
      <Icon name="star" />
    </button>
  );
  const timed = playing && position !== null && position.length !== null && position.length !== undefined;
  const fill = loopFill(playing, position);
  const state = position === null ? 'off' : !playing ? 'held' : timed ? 'timed' : 'endless';
  return (
    <div
      className="vs-transport"
      role="region"
      aria-label="transport"
      data-layout={layout}
      data-centre-keys={layout === 'overlay' && centreKeys ? '' : undefined}
      data-foot-star={foot ? '' : undefined}
    >
      {/* A toolbar: every control in it takes its quiet look (the source picker is text and a caret, not a field). */}
      <Group name="transport controls" label={false} toolbar className="vs-transport-bar">
        {leading && <div className="vs-transport-lead">{lead}</div>}
        <Group name="keys" label={false} className="vs-transport-keys">
          <Text as="button" weight="strong" type="button" className="vs-transport-key vs-transport-prev" aria-label="previous preset" title={`Previous preset${stepIn} (←)`} onClick={() => onStep(-1)}>
            <Icon name="previous" />
          </Text>
          <Text
            as="button"
            weight="strong"
            type="button"
            className="vs-transport-key vs-transport-auto"
            aria-label="move on by itself"
            aria-pressed={playing}
            aria-keyshortcuts="H"
            title={loopTitle(playing, position, moves)}
            data-state={state}
            data-fill={fill.toFixed(3)}
            onClick={onPlayPause}
          >
            <LoopRing fill={fill} timed={timed} size={18} />
          </Text>
          <Text as="button" weight="strong" type="button" className="vs-transport-key" aria-label="next preset" title={`Next preset${stepIn} (→)`} onClick={() => onStep(1)}>
            <Icon name="next" />
          </Text>
          {!top && dice}
        </Group>
        <div className="vs-transport-mid">
          {now && (
            <Text as="p" className="vs-transport-now" title={now.from ? `${now.name} ${now.from}` : now.name}>
              <Text weight="strong" className="vs-transport-name">
                {now.name}
              </Text>
              {now.from && (
                <Text className="vs-transport-from">
                  <Numbers text={now.from} />
                </Text>
              )}
            </Text>
          )}
        </div>
        {audio && <TransportAudio onAudioError={onAudioError} audioTrouble={audioTrouble} />}
        {top ? (
          <div className="vs-transport-top">
            {dice}
            {starKey}
          </div>
        ) : (
          starKey
        )}
      </Group>
    </div>
  );
}
TransportBar.forms = TRANSPORT_FORMS;
