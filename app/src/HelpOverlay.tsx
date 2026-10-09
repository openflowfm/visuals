import { Button } from '@openflow/widgets/controls/Button.tsx';
import { useEffect, useRef, type ReactElement } from 'react';
import { Say, say } from './words.ts';

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
  | 'reset';

/** Where a control is: the status bar, what's playing, the control grid, the crate, or only on a key. */
export type Where = 'status' | 'playing' | 'controls' | 'crate' | 'keys';

/** A live control: what it's called, its keys (empty when none), and what it does. */
export interface Control {
  id: ControlId;
  name: string;
  keys: string;
  does: string;
  where: Where;
}

/**
 * The one list of live mode's controls. Live takes its tooltips and labels from
 * it and the ? overlay shows it, so the overlay names every control.
 */
export const CONTROLS: readonly Control[] = [
  { id: 'audio', where: 'status', name: 'Audio', keys: '', does: `What it's listening to, and how loud. Click to pick what to ${say('audio input')}` },
  { id: 'beat', where: 'status', name: 'Beat', keys: '', does: `The tempo, and how many others are in time over Link. Click to ${say('Ableton Link')}` },
  { id: 'output', where: 'status', name: 'Output', keys: '', does: 'Where the picture shows. Click to pick a display' },
  { id: 'fps', where: 'status', name: 'Frames per second', keys: '', does: 'Only shown when the picture runs slow, under 50' },
  { id: 'help', where: 'status', name: 'Help', keys: '?', does: 'This list of every live control' },
  { id: 'settings', where: 'status', name: 'Settings', keys: '', does: 'How the app looks, listens and draws' },
  { id: 'leave', where: 'status', name: 'Leave live', keys: 'Esc or ⌘⇧L', does: 'Back to your playlists and the library' },
  { id: 'now', where: 'playing', name: 'Now', keys: '', does: "What's playing" },
  { id: 'next', where: 'playing', name: 'Next', keys: '', does: 'What comes next, and when, for example in 8 beats' },
  { id: 'fullscreen', where: 'playing', name: 'Go full screen on…', keys: '', does: 'Puts the picture full screen on that display. Shows when it is on one display' },
  { id: 'previous', where: 'controls', name: 'Previous', keys: '← ↑', does: 'Back to the preset before' },
  { id: 'random', where: 'controls', name: 'Random', keys: 'R', does: 'A preset picked at random' },
  { id: 'step', where: 'controls', name: 'Next', keys: '→ ↓', does: 'On to the next preset' },
  { id: 'hold', where: 'controls', name: 'Hold', keys: 'H', does: `${Say('hold')}: don't ${say('auto-advance')}` },
  { id: 'strobe', where: 'controls', name: 'Strobe', keys: 'hold S, ⇧S latches', does: 'Flashes on the beat while held; or press and hold the button' },
  { id: 'blackout', where: 'controls', name: 'Blackout', keys: 'B', does: 'Turns the picture to black, and back' },
  { id: 'freeze', where: 'controls', name: 'Freeze', keys: 'hold Z, ⇧Z latches', does: 'Stops the picture while held; or press and hold the button' },
  { id: 'tempo', where: 'controls', name: 'Tap / Link tempo', keys: 'T', does: 'Tap the tempo in time. Follows Link when others are in time' },
  { id: 'intensity', where: 'controls', name: 'Intensity', keys: '', does: `${Say('sensitivity')}: brightness and strobe level together, never to white` },
  { id: 'more', where: 'controls', name: 'More effects…', keys: '', does: 'The rest: speed, colour, mirror, trails…' },
  { id: 'playlists', where: 'crate', name: 'Playlists', keys: '', does: 'Tap one to play it' },
  { id: 'moods', where: 'crate', name: 'Moods', keys: '', does: `${Say('user tags')}: tap one to play it, a second to add it` },
  { id: 'upnext', where: 'crate', name: 'Up next', keys: 'Alt+↑/↓', does: 'What plays next. Drag to reorder' },
  { id: 'rate', where: 'keys', name: 'Rate', keys: '1–5', does: 'Rates the preset from 1 to 5' },
  { id: 'favourite', where: 'keys', name: 'Favourite', keys: 'F', does: 'Stars the preset as a favourite, or takes the star off' },
  { id: 'punch', where: 'keys', name: 'Punch', keys: 'hold P, ⇧P latches', does: 'A burst of brightness while held' },
  { id: 'invert', where: 'keys', name: 'Invert', keys: 'I', does: "Turns the picture's colours inside out, and back" },
  { id: 'mirror', where: 'keys', name: 'Mirror', keys: 'M', does: 'Mirrors the picture: across, down, four ways, off' },
  { id: 'reset', where: 'keys', name: 'Reset effects', keys: '0', does: 'Turns every effect off' },
];

/** The headings the overlay groups the controls under, in order. */
export const GROUPS: readonly { where: Where; heading: string }[] = [
  { where: 'status', heading: 'Along the top' },
  { where: 'playing', heading: "What's playing" },
  { where: 'controls', heading: 'Controls' },
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
 * The ? overlay: every live control, grouped by where it is. Esc or ? closes
 * it (before live mode's own keys see them), as do ✕ and a click outside.
 */
export function HelpOverlay({ open, onClose }: { open: boolean; onClose(): void }): ReactElement | null {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const keydown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== '?') return;
      e.preventDefault();
      e.stopPropagation();
      close.current();
    };
    window.addEventListener('keydown', keydown, { capture: true });
    return () => window.removeEventListener('keydown', keydown, { capture: true });
  }, [open]);
  if (!open) return null;
  return (
    <div
      className="live-help"
      role="dialog"
      aria-modal="true"
      aria-label="Live controls"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="live-help-panel" ref={panel} tabIndex={-1}>
        <div className="live-help-head">
          <h2>Live controls</h2>
          <Button tone="quiet" label="Close live controls" title="Close (Esc or ?)" onPress={onClose}>
            ✕
          </Button>
        </div>
        {GROUPS.map((g) => (
          <section className="live-help-group" key={g.where}>
            <h3>{g.heading}</h3>
            <dl>
              {CONTROLS.filter((c) => c.where === g.where).map((c) => (
                <div className="live-help-row" key={c.id}>
                  <dt>{c.name}</dt>
                  <dd className="live-help-keys">{c.keys ? <kbd>{c.keys}</kbd> : null}</dd>
                  <dd>{c.does}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}
