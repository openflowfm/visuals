import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { Layer, Opaque } from '@satoramoto/zen';
import { ActionButtonFace as ButtonFace } from '@satoramoto/zen';
import { isTopTrap, useFocusTrap } from '@satoramoto/zen';
import { Text } from '@satoramoto/zen';
import { Icon } from '../Icon/Icon';
import { Say, say } from '../model/words';
import './HelpOverlay.css';

/** Every control live mode has, on screen or on a key. */
export type ControlId =
  | 'audio'
  | 'beat'
  | 'output'
  | 'fps'
  | 'help'
  | 'settings'
  | 'leave'
  | 'now'
  | 'next'
  | 'fullscreen'
  | 'previous'
  | 'random'
  | 'step' /* next preset */
  | 'hold'
  | 'strobe'
  | 'blackout'
  | 'freeze'
  | 'tempo'
  | 'intensity'
  | 'effects' /* the Stage's effects panel (it replaced More effects…) */
  | 'map' /* the Stage's library map, at the right */
  | 'rate'
  | 'favourite'
  | 'punch'
  | 'invert'
  | 'mirror'
  | 'reset'
  | 'panels'; /* the Stage's \: pin the controls shown */

/** Where a control is: the status bar, what's playing, the control grid, the dock's transport bar, or only on a key. */
export type Where = 'status' | 'playing' | 'controls' | 'dock' | 'keys';

/** A live control: what it's called, its keys (empty when none), and what it does. */
export interface Control {
  id: ControlId;
  name: string;
  keys: string;
  does: string;
  where: Where;
  /** Only in the Stage layout: the ? overlay lists it only when it is told the Stage is showing (`stage`). */
  stage?: true;
}

/**
 * The one list of live mode's controls. Live takes its tooltips and labels from
 * it and the ? overlay shows it, so the overlay names every control.
 */
export const CONTROLS: readonly Control[] = [
  { id: 'audio', where: 'dock', name: 'Audio', keys: '', does: `What it's listening to, with its left and right levels beside it. Click to pick what to ${say('audio input')}` },
  { id: 'beat', where: 'status', name: 'Beat', keys: '', does: `The tempo, flashing on each beat. Click to tap the tempo or ${say('Ableton Link')}` },
  { id: 'output', where: 'status', name: 'Output', keys: '', does: 'Where the picture shows: this window until you pick a display. Click to pick one' },
  { id: 'fps', where: 'status', name: 'Frames per second', keys: '', does: 'Only shown when the picture runs slow, under 50' },
  {
    id: 'map',
    where: 'status',
    stage: true,
    name: 'Library map',
    keys: 'G',
    does: "Opens the map at the right, and closes it: the set's presets (or the library) as dots, laid out by the axes you pick. Click a dot to play it; the dashed trail is what played this session",
  },
  { id: 'help', where: 'status', name: 'Help', keys: '?', does: 'This list of every live control' },
  { id: 'settings', where: 'status', name: 'Settings', keys: '', does: 'How the app looks, listens and draws' },
  { id: 'leave', where: 'status', name: '✕ Leave live', keys: '⌘⇧L, hold Esc', does: 'Back to your playlists and the library: the ✕ in the header or ⌘⇧L at once, or hold Esc for 3 seconds' },
  { id: 'now', where: 'playing', name: 'Now', keys: '', does: "What's playing" },
  { id: 'next', where: 'playing', name: 'Next', keys: '', does: 'What comes next, and when, for example in 8 beats' },
  {
    id: 'fullscreen',
    where: 'playing',
    name: 'Go full screen on…',
    keys: '',
    does: "Puts the picture full screen on that display. In the Output light's panel while it plays in this window, as it does when you go live",
  },
  { id: 'previous', where: 'controls', name: 'Previous', keys: '← ↑', does: 'Back to the preset before' },
  { id: 'random', where: 'controls', name: 'Random', keys: 'R', does: 'A preset picked at random' },
  { id: 'step', where: 'controls', name: 'Next', keys: '→ ↓', does: 'On to the next preset' },
  { id: 'hold', where: 'controls', name: 'Hold', keys: 'H', does: `${Say('hold')}: don't ${say('auto-advance')}` },
  { id: 'strobe', where: 'controls', name: 'Strobe', keys: 'hold S, ⇧S latches', does: 'Flashes on the beat while held; or press and hold the button' },
  { id: 'blackout', where: 'controls', name: 'Blackout', keys: 'B', does: 'Turns the picture to black, and back' },
  { id: 'freeze', where: 'controls', name: 'Freeze', keys: 'hold F, ⇧F latches', does: 'Stops the picture while held; or press and hold the button' },
  { id: 'tempo', where: 'status', name: 'Tap tempo', keys: 'T', does: 'Tap the tempo in time, in the Beat panel or on T. Follows Link when others are in time' },
  { id: 'intensity', where: 'controls', name: 'Intensity', keys: '', does: `${Say('sensitivity')}: brightness and strobe level together, never to white` },
  {
    id: 'effects',
    where: 'controls',
    stage: true,
    name: 'Effects',
    keys: 'E',
    does: 'Opens the effects panel at the left, and closes it: the held effects, intensity, speed, colour, trails, mirror, invert',
  },
  { id: 'rate', where: 'keys', name: 'Rate', keys: '1–5', does: 'Rates the preset from 1 to 5' },
  { id: 'favourite', where: 'keys', name: 'Favourite', keys: 'L', does: 'Stars the preset as a favourite, or takes the star off' },
  { id: 'punch', where: 'keys', name: 'Punch', keys: 'hold P, ⇧P latches', does: 'A burst of brightness while held' },
  { id: 'invert', where: 'keys', name: 'Invert', keys: 'I', does: "Turns the picture's colours inside out, and back" },
  { id: 'mirror', where: 'keys', name: 'Mirror', keys: 'M', does: 'Mirrors the picture: across, down, four ways, off' },
  { id: 'reset', where: 'keys', name: 'Reset effects', keys: '0', does: 'Turns every effect off' },
  { id: 'panels', where: 'keys', stage: true, name: 'Pin the controls shown', keys: '\\', does: "\\ shows Live's controls until pressed again" },
];

/** The headings the overlay groups the controls under, in order. */
export const GROUPS: readonly { where: Where; heading: string }[] = [
  { where: 'status', heading: 'Along the top' },
  { where: 'playing', heading: "What's playing" },
  { where: 'controls', heading: 'Controls' },
  { where: 'dock', heading: 'Along the bottom' },
  { where: 'keys', heading: 'Keys only' },
];

const BY_ID = new Map(CONTROLS.map((c) => [c.id, c]));

/** The control `id`. */
export function control(id: ControlId): Control {
  const c = BY_ID.get(id);
  if (!c) throw new Error(`no live control ${id}`);
  return c;
}

/** A control's tooltip: "Name: does (keys)", or without the keys when it has none. */
export function titleOf(id: ControlId): string {
  const c = control(id);
  return c.keys ? `${c.name}: ${c.does} (${c.keys})` : `${c.name}: ${c.does}`;
}

/**
 * The one key a pad shows under its name: a single letter or arrow, the first its
 * keys name ("hold S, ⇧S latches" is S, "← ↑" is ←); empty when it has none. The
 * rest of the keys are in the pad's tooltip and the ? overlay.
 */
export function padKey(id: ControlId): string {
  const first = control(id)
    .keys.replace(/^hold\s+/, '')
    .split(/[\s,]+/)[0];
  return first ?? '';
}

/** A control on the home's ? overlay: what it's called, its keys (empty when none), and what it does. */
export interface HomeControl {
  name: string;
  keys: string;
  does: string;
}

/** What one ? overlay lists: its title (the dialog's name), the id of that title, and its controls under their headings. */
export interface HelpList {
  title: string;
  id: string;
  groups: readonly { heading: string; rows: readonly HomeControl[] }[];
}

/** Live mode's list: every live control, grouped by where it is; the Stage's own only while `stage`. */
export function liveHelp(stage: boolean): HelpList {
  return {
    title: 'Live controls',
    id: 'live-help-title',
    groups: GROUPS.map((g) => ({ heading: g.heading, rows: CONTROLS.filter((c) => c.where === g.where && (stage || !c.stage)) })),
  };
}

/**
 * The home's controls, for its ? overlay: the header, the grid, the transport
 * bar and the keys, as Home.tsx answers them. A playlist moves on by itself and
 * Hold stops it, said here in so many words for a newcomer.
 */
export const HOME_HELP: HelpList = {
  title: 'Home controls',
  id: 'home-help-title',
  groups: [
    {
      heading: 'Along the top',
      rows: [
        { name: Say('source list'), keys: '⌃⌘S', does: 'Shows or hides the library and your playlists down the left' },
        { name: 'Home and Live', keys: '', does: 'Live plays the picture on a display, with the effects and the beat' },
        { name: 'Search', keys: '⌘F', does: 'Searches the library; from a playlist it opens the library first' },
        { name: 'Help', keys: '?', does: 'This list of what the home answers' },
        { name: Say('inspector'), keys: '⌘I', does: 'Shows or hides the panel down the right: the preset playing, or the ones picked' },
        { name: 'Settings', keys: '⌘,', does: 'How the app looks, listens and draws' },
      ],
    },
    {
      heading: 'The presets',
      rows: [
        { name: 'Play', keys: 'Click or Enter', does: 'Plays the preset; in a playlist, the playlist plays on from there' },
        { name: 'See it', keys: '⌘-click', does: `Shows the preset in the ${say('inspector')} without playing it; ⇧-click picks a run of them` },
        { name: 'Back', keys: 'Esc', does: 'Back to the preset playing; first puts away a panel laid over the grid' },
        { name: 'Add to a playlist', keys: '', does: `Drag a preset onto a playlist in the ${say('source list')}` },
        { name: 'Reorder a playlist', keys: '⌥← ⌥→', does: 'Moves the preset picked in a playlist, or drag it' },
      ],
    },
    {
      heading: 'Along the bottom',
      rows: [
        { name: 'Previous', keys: '←', does: 'Back to the preset before' },
        { name: 'Next', keys: '→', does: 'On to the next preset' },
        { name: 'Random', keys: 'R', does: 'A preset picked at random' },
        { name: 'Hold', keys: 'H', does: 'Click the ring, or press H, to stay on this preset: a playlist stops moving on by itself until you press it again' },
        { name: 'The ring', keys: '', does: 'Fills round to the next preset while a playlist moves on by itself; empty and dim while it stays' },
        { name: 'Audio', keys: '', does: `What it's listening to. Click to pick what to ${say('audio input')}` },
      ],
    },
  ],
};

/**
 * **Job.** The ? overlay: every control `list` names (live's by default), grouped. A modal
 * dialog: focus moves into it and stays there, and goes back to what opened it (the ? button)
 * when it closes. Esc or ? closes it (before live mode's or the home's own keys see them), as do
 * ✕ and a click outside.
 *
 * **Changed.** The panel is a `Layer` at `top` (it opens over live's sheets and the dock, the
 * topmost thing on the screen) inside an `Opaque` scope, so over the native preview it draws the
 * layer's solid and never blurs. The scrim is the black key colour, part see-through. Keycaps are
 * the theme's `key` material; headings and descriptions the contract's `--text-3` caption. ✕ is
 * the core `ButtonFace` (quiet). The focus trap is the core Modal's (`components/core/Modal/focusTrap`),
 * so this overlay and every Modal or Sheet share one stack of traps and only the topmost hears Esc.
 * It does not use `Modal` itself: Modal has no room in its head for the "? or Esc closes" hint and
 * names its ✕ "Close", where this names it after the list.
 *
 * Live's list names the Stage's Effects panel and its key, E, where More effects… was.
 *
 * **Kept.** Every export (`ControlId`, `Where`, `Control`, `CONTROLS`, `GROUPS`, `control`,
 * `titleOf`, `padKey`, `HomeControl`, `HelpList`, `liveHelp`, `HOME_HELP`, `HelpOverlay`), all
 * copy, the dialog's name (`aria-labelledby` its heading), the ✕'s name and title, the keys, the
 * columns wide and one column narrow.
 *
 * **Tuning knobs.** `--vs-help-z`: the stacking order, over a Modal's or Sheet's (100);
 * `--vs-help-scrim`: the scrim, the always-dark key colour part see-through; `--vs-help-width`:
 * the panel's widest (`calc(var(--space-4) * 55)`, help.css's 880px).
 */
export function HelpOverlay({
  open,
  onClose,
  stage = false,
  list,
}: {
  open: boolean;
  onClose(): void;
  /** Live shows the Stage: list its own controls too. */
  stage?: boolean;
  /** What to list: live's controls when left out (`HOME_HELP` for the home). */
  list?: HelpList;
}): ReactElement | null {
  return open ? <HelpDialog onClose={onClose} list={list ?? liveHelp(stage)} /> : null;
}

/** A key as a small keycap: strong tabular readout figures at the smallest size (its face in HelpOverlay.css). */
function Kbd({ children }: { children: ReactNode }) {
  return (
    <Text as="kbd" weight="strong" tabular>
      {children}
    </Text>
  );
}

/** The overlay while it is open: mounted only then, so the focus trap takes focus on open and gives it back on close. */
function HelpDialog({ onClose, list }: { onClose(): void; list: HelpList }) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useFocusTrap(panel);
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if ((e.key !== 'Escape' && e.key !== '?') || !isTopTrap(panel.current)) return;
      e.preventDefault();
      e.stopPropagation();
      close.current();
    };
    window.addEventListener('keydown', keydown, { capture: true });
    return () => window.removeEventListener('keydown', keydown, { capture: true });
  }, []);
  return (
    <Opaque className="vs-help">
      <div
        className="vs-help-scrim"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="vs-help-dialog" ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={list.id}>
          <Layer level="top" as={Text} className="vs-help-panel">
            <div className="vs-help-head">
              <Text as="h2" role="display" leading="normal" id={list.id}>
                {list.title}
              </Text>
              <Text role="caption" leading="normal" className="vs-help-hint" aria-hidden="true">
                <Kbd>?</Kbd> or <Kbd>Esc</Kbd> closes
              </Text>
              <ButtonFace tone="quiet" size="medium" className="vs-help-close" aria-label={`Close ${list.title.toLowerCase()}`} title="Close (Esc or ?)" onClick={onClose}>
                <Icon name="close" />
              </ButtonFace>
            </div>
            <div className="vs-help-groups">
              {list.groups.map((g) => (
                <section className="vs-help-group" key={g.heading}>
                  <Text as="h3" weight="strong" leading="normal">
                    {g.heading}
                  </Text>
                  <dl>
                    {g.rows.map((c) => (
                      <div className="vs-help-row" key={c.name}>
                        <Text as="dt" weight="strong" leading="normal">
                          {c.name}
                        </Text>
                        <dd className="vs-help-keys">{c.keys ? <Kbd>{c.keys}</Kbd> : null}</dd>
                        <Text as="dd" role="caption" className="vs-help-does">
                          {c.does}
                        </Text>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          </Layer>
        </div>
      </div>
    </Opaque>
  );
}
