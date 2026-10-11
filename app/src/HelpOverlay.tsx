import { useEffect, useRef, type ReactElement } from 'react';
import { isTopTrap, useFocusTrap } from './focusTrap.ts';
import { Icon } from './layout/icons.tsx';
import { Say, say } from './words.ts';
import './help.css';

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
  | 'more'
  | 'playlists'
  | 'moods'
  | 'upnext'
  | 'rate'
  | 'favourite'
  | 'punch'
  | 'invert'
  | 'mirror'
  | 'reset'
  | 'crate' /* the Stage's crate toggle */
  | 'panels'; /* the Stage's \: hide or show the panels */

/** Where a control is: the status bar, what's playing, the control grid, the dock's transport bar, the crate, or only on a key. */
export type Where = 'status' | 'playing' | 'controls' | 'dock' | 'crate' | 'keys';

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
  { id: 'output', where: 'status', name: 'Output', keys: '', does: 'Where the picture shows. Click to pick a display' },
  { id: 'fps', where: 'status', name: 'Frames per second', keys: '', does: 'Only shown when the picture runs slow, under 50' },
  { id: 'help', where: 'status', name: 'Help', keys: '?', does: 'This list of every live control' },
  { id: 'settings', where: 'status', name: 'Settings', keys: '', does: 'How the app looks, listens and draws' },
  { id: 'leave', where: 'status', name: 'Leave live', keys: 'hold Esc, ⌘⇧L', does: 'Back to your playlists and the library: ✕ or ⌘⇧L at once, or hold Esc for 3 seconds' },
  { id: 'now', where: 'playing', name: 'Now', keys: '', does: "What's playing" },
  { id: 'next', where: 'playing', name: 'Next', keys: '', does: 'What comes next, and when, for example in 8 beats' },
  { id: 'fullscreen', where: 'playing', name: 'Go full screen on…', keys: '', does: 'Puts the picture full screen on that display. Shows when it is on one display' },
  { id: 'previous', where: 'controls', name: 'Previous', keys: '← ↑', does: 'Back to the preset before' },
  { id: 'random', where: 'controls', name: 'Random', keys: 'R', does: 'A preset picked at random' },
  { id: 'step', where: 'controls', name: 'Next', keys: '→ ↓', does: 'On to the next preset' },
  { id: 'hold', where: 'controls', name: 'Hold', keys: 'H', does: `${Say('hold')}: don't ${say('auto-advance')}` },
  { id: 'strobe', where: 'controls', name: 'Strobe', keys: 'hold S, ⇧S latches', does: 'Flashes on the beat while held; or press and hold the button' },
  { id: 'blackout', where: 'controls', name: 'Blackout', keys: 'B', does: 'Turns the picture to black, and back' },
  { id: 'freeze', where: 'controls', name: 'Freeze', keys: 'hold F, ⇧F latches', does: 'Stops the picture while held; or press and hold the button' },
  { id: 'tempo', where: 'status', name: 'Tap tempo', keys: 'T', does: 'Tap the tempo in time, in the Beat panel or on T. Follows Link when others are in time' },
  { id: 'intensity', where: 'controls', name: 'Intensity', keys: '', does: `${Say('sensitivity')}: brightness and strobe level together, never to white` },
  { id: 'more', where: 'controls', name: 'More effects…', keys: '', does: 'The rest: speed, colour, mirror, trails…' },
  { id: 'playlists', where: 'crate', name: 'Playlists', keys: '', does: 'Tap one to cue it; Play, Enter or a double-click plays it' },
  { id: 'moods', where: 'crate', name: 'Moods', keys: '', does: `${Say('user tags')}: tap one to play it, a second to add it` },
  { id: 'upnext', where: 'crate', name: 'Up next', keys: 'Alt+↑/↓', does: 'What plays after next. Drag a row by its ≡ (it shows on hover) to reorder' },
  { id: 'rate', where: 'keys', name: 'Rate', keys: '1–5', does: 'Rates the preset from 1 to 5' },
  { id: 'favourite', where: 'keys', name: 'Favourite', keys: 'L', does: 'Stars the preset as a favourite, or takes the star off' },
  { id: 'punch', where: 'keys', name: 'Punch', keys: 'hold P, ⇧P latches', does: 'A burst of brightness while held' },
  { id: 'invert', where: 'keys', name: 'Invert', keys: 'I', does: "Turns the picture's colours inside out, and back" },
  { id: 'mirror', where: 'keys', name: 'Mirror', keys: 'M', does: 'Mirrors the picture: across, down, four ways, off' },
  { id: 'reset', where: 'keys', name: 'Reset effects', keys: '0', does: 'Turns every effect off' },
  { id: 'crate', where: 'status', stage: true, name: Say('crate'), keys: '', does: 'Shows or puts away the panel down the left' },
  { id: 'panels', where: 'keys', stage: true, name: `Hide the ${say('panels')}`, keys: '\\', does: `Only the picture shows in this window; \\ or Esc brings the ${say('panels')} back` },
];

/** The headings the overlay groups the controls under, in order. */
export const GROUPS: readonly { where: Where; heading: string }[] = [
  { where: 'status', heading: 'Along the top' },
  { where: 'playing', heading: "What's playing" },
  { where: 'controls', heading: 'Controls' },
  { where: 'dock', heading: 'Along the bottom' },
  { where: 'crate', heading: 'Playlists and up next' },
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
        { name: 'Hold', keys: 'H', does: 'Stays on this preset: a playlist stops moving on by itself until you press it again' },
        { name: 'Time on this preset', keys: '', does: 'Counts down to the next preset while a playlist moves on by itself' },
        { name: 'Audio', keys: '', does: `What it's listening to. Click to pick what to ${say('audio input')}` },
      ],
    },
  ],
};

/**
 * The ? overlay: every control `list` names (live's by default), grouped. A
 * modal dialog: focus moves into it and stays there, and goes back to what
 * opened it (the ? button) when it closes. Esc or ? closes it (before live
 * mode's or the home's own keys see them), as do ✕ and a click outside.
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
    <div
      className="help"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="help-panel" ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={list.id}>
        <div className="help-head">
          <h2 id={list.id}>{list.title}</h2>
          <span className="help-hint" aria-hidden="true">
            <kbd>?</kbd> or <kbd>Esc</kbd> closes
          </span>
          <button type="button" className="help-close" aria-label={`Close ${list.title.toLowerCase()}`} title="Close (Esc or ?)" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="help-groups">
          {list.groups.map((g) => (
            <section className="help-group" key={g.heading}>
              <h3>{g.heading}</h3>
              <dl>
                {g.rows.map((c) => (
                  <div className="help-row" key={c.name}>
                    <dt>{c.name}</dt>
                    <dd className="help-keys">{c.keys ? <kbd>{c.keys}</kbd> : null}</dd>
                    <dd className="help-does">{c.does}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
