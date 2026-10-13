import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActionButton } from '@satoramoto/zen';
import { Segmented } from '@satoramoto/zen';
import { Select } from '@satoramoto/zen';
import { Text } from '@satoramoto/zen';
import * as fx from '../model/fx';
import { useNotice, useTauriEvent } from '../model/hooks';
import * as output from '../model/output';
import { Say } from '../model/words';
import { NoticeBanner } from '../Views/Views';
import './OutputPanel.css';

// A port of visual[flow]'s `app/src/OutputPanel.tsx`: the same exports (`fitLine`,
// `OutputSettings`, `leave`, `OutputPanel`), behaviour and words.

const displayName = (d: output.Display) => `${d.index + 1}. ${d.name} (${d.width}×${d.height})${d.main ? ' · menu bar' : ''}`;

/**
 * How the output fills its display, in a line: the whole picture with black bars
 * where the shapes differ, or, on a display turned on its side, filling it.
 */
export function fitLine(status: output.Status): string {
  const shown = status.display;
  if (!shown) return 'The whole picture, with black bars where the display is a different shape; a display turned on its side is filled.';
  if (shown.height > shown.width) return `Fills ${shown.name}, drawn tall to match it.`;
  const size = status.size;
  if (!size || (size[0] === shown.width && size[1] === shown.height)) return `Fills ${shown.name}.`;
  const bars = size[0] < shown.width ? 'at the sides' : 'above and below';
  return `The whole picture, ${size[0]}×${size[1]} on ${shown.name}, with black bars ${bars}.`;
}

const RESOLUTIONS: { label: string; size: output.Render['resolution'] }[] = [
  { label: 'Match display', size: 'display' },
  { label: '720p', size: [1280, 720] },
  { label: '1080p', size: [1920, 1080] },
  { label: '1440p', size: [2560, 1440] },
  { label: '4K', size: [3840, 2160] },
];
const SCALES = [0.5, 0.75, 1, 1.5, 2];
const RATES: (number | null)[] = [30, 60, null];

/** The pixels the output draws: the resolution (or the display's, else 1920×1080) times the scale. */
export function renderLine(r: output.Render, display: output.Display | null): string {
  const [w, h] = r.resolution === 'display' ? (display ? [display.width, display.height] : [1920, 1080]) : r.resolution;
  return `${Math.round(w * r.scale)} × ${Math.round(h * r.scale)} at ${Math.round(r.scale * 100)}%`;
}

/**
 * How the output is drawn: resolution, render scale and frame-rate cap. Read once and set
 * through `output.setRender`; a failed call (not in the native app yet) keeps the choice quietly.
 */
function RenderSettings({ display }: { display: output.Display | null }) {
  const [r, setR] = useState<output.Render>(output.RENDER_DEFAULT);
  useEffect(() => {
    output.render().then(setR, () => {});
  }, []);
  const change = (next: output.Render) => {
    setR(next);
    output.setRender(next).then(setR, () => {});
  };
  const res = RESOLUTIONS.findIndex((x) => JSON.stringify(x.size) === JSON.stringify(r.resolution));
  return (
    <div className="vs-output-render">
      <Select
        className="vs-output-display"
        items={RESOLUTIONS.map((x) => x.label)}
        index={Math.max(0, res)}
        onChange={(i) => change({ ...r, resolution: RESOLUTIONS[i].size })}
        label="Resolution"
        title="The size the output draws at, before the render scale"
      />
      <Segmented
        items={SCALES.map((s) => `${s * 100}%`)}
        index={Math.max(0, SCALES.indexOf(r.scale))}
        onChange={(i) => change({ ...r, scale: SCALES[i] })}
        label="Render scale"
        name="Scale"
        title="Draw below the resolution for speed, or above it for smoother edges"
      />
      <Segmented
        items={RATES.map((f) => (f === null ? 'Display' : `${f}`))}
        index={Math.max(0, RATES.indexOf(r.fps))}
        onChange={(i) => change({ ...r, fps: RATES[i] })}
        label="Frame rate cap"
        name="Frame rate"
        title="The most frames a second the output draws; Display follows its refresh"
      />
      <Note ariaRole="status">{renderLine(r, display)}</Note>
    </div>
  );
}

/** A note: a caption paragraph (OutputPanel.css sets its leading). */
function Note({ ariaRole, className, children }: { ariaRole?: 'status'; className?: string; children: ReactNode }) {
  return (
    <Text as="p" role="caption" ariaRole={ariaRole} className={className ? `vs-output-note ${className}` : 'vs-output-note'}>
      {children}
    </Text>
  );
}

/** How the picture fits, its lead in the strong weight. */
function FitNote({ status }: { status: output.Status }) {
  return (
    <Note className="vs-output-fit">
      <Text as="b" role="caption" weight="strong" className="vs-output-fit-lead">
        {Say('output fit')}:
      </Text>{' '}
      {fitLine(status)}
    </Note>
  );
}

/**
 * **Job.** The output in ⚙ Settings: which display it fills and how the picture fits it. While it
 * is showing (live mode), picking a display moves it there and is remembered; otherwise the list
 * says what is connected, and live mode opens the output on the display picked last.
 *
 * **Changed.** The display picker is the core `Select`; the lines are captions in `--text-3`, the
 * fit's lead in the controls' ink, a column on the scale's gap (no rules, decision 68).
 *
 * **Kept.** The reads (`output.status`, `onStatus`, `displays` again on focus), the move and its
 * failure notice, every word.
 */
export function OutputSettings() {
  const [status, setStatus] = useState<output.Status>({ display: null, size: null });
  const [displays, setDisplays] = useState<output.Display[]>([]);
  const { notice, dismiss, fail } = useNotice();

  useEffect(() => {
    output.status().then(setStatus, () => {});
  }, []);
  useTauriEvent(output.onStatus, setStatus);
  const refreshDisplays = useCallback(() => output.displays().then(setDisplays, () => {}), []);
  useEffect(() => {
    refreshDisplays();
    window.addEventListener('focus', refreshDisplays);
    return () => window.removeEventListener('focus', refreshDisplays);
  }, [refreshDisplays, status.display?.id]);

  const shown = status.display;
  const pick = displays.findIndex((d) => d.id === shown?.id);
  return (
    <Text as="div" className="vs-output-settings">
      {displays.length > 0 ? (
        <Select
          className="vs-output-display"
          items={displays.map(displayName)}
          index={Math.max(0, pick)}
          onChange={(i) => output.open(displays[i].id).then(setStatus, fail("Couldn't show the output on that display."))}
          label="Display"
          title={shown ? 'The display the output fills; remembered for next time' : 'Go live to pick where the output goes'}
          disabled={!shown}
          width={260}
        />
      ) : (
        <Note>No displays found.</Note>
      )}
      <Note ariaRole="status">{shown ? `Showing on ${shown.name}.` : 'Not showing: live mode opens it on the display picked last.'}</Note>
      <FitNote status={status} />
      <NoticeBanner notice={notice} onDismiss={dismiss} />
    </Text>
  );
}

/**
 * Leaving live mode: the effects go back first, so the editor is never left
 * inverted or frozen, and then the output closes.
 */
export function leave() {
  fx.act({ kind: 'fx_reset' }).catch(() => {});
  output.close().catch(() => {});
}

/**
 * **Job.** Where the live output goes: whether it is showing, the display it fills, how the
 * picture fits it, and a warning when it covers the display with the menu bar. `status` and
 * `show` are Live's, which plays in the window until a display is picked here or in "Go full
 * screen on…".
 *
 * **Changed.** No panel of its own: it sits in the Stage's popover (a float `Layer`), so it paints
 * nothing and draws no lines. The heading is a sentence-case caption; "Showing on …" is the
 * signal's green (`--vs-playing`), the only colour that means it is live; the warning is a
 * caution tint (`--warning`) with no border. Show is the core `ActionButton`, the picker the core
 * `Select`.
 *
 * **Kept.** The display list read again on focus, the chosen display (the one showing, else the
 * first without the menu bar), the one-display warning, every word and tooltip.
 *
 * **Added.** The render settings under the display: resolution (core `Select`), render scale and
 * frame-rate cap (core `Segmented`), and the pixel size they make.
 */
export function OutputPanel({ status, show }: { status: output.Status; show: (id: number | null) => void }) {
  const [displays, setDisplays] = useState<output.Display[]>([]);
  const shown = status.display;

  const refreshDisplays = useCallback(() => output.displays().then(setDisplays, () => {}), []);
  useEffect(() => {
    refreshDisplays();
    // A display plugged in or out shows up in the list next time it is looked at.
    window.addEventListener('focus', refreshDisplays);
    return () => window.removeEventListener('focus', refreshDisplays);
  }, [refreshDisplays, shown?.id]);

  const chosen = shown?.id ?? displays.find((d) => !d.main)?.id ?? displays[0]?.id ?? null;
  const pick = displays.findIndex((d) => d.id === chosen);
  // Only the display with the menu bar: the output covers this window too.
  const alone = displays.length === 1 && displays[0].main;

  return (
    <Text as="div" className="vs-output">
      <Text as="h2" weight="strong" case="none" className="vs-output-head">
        Output
      </Text>
      {shown ? (
        <p className="vs-output-status" data-on="" title={status.size ? `The picture is ${status.size[0]}×${status.size[1]} on the display` : undefined}>
          Showing on {shown.name}
        </p>
      ) : (
        <div className="vs-output-status">
          <span>Not showing</span>
          <ActionButton onPress={() => show(chosen)} title="Open the output full screen on the display picked below">
            Show
          </ActionButton>
        </div>
      )}
      {displays.length > 0 ? (
        <Select
          className="vs-output-display"
          items={displays.map(displayName)}
          index={Math.max(0, pick)}
          onChange={(i) => show(displays[i].id)}
          label="Display"
          title="The display the output fills; remembered for next time"
        />
      ) : (
        <Note>No displays found.</Note>
      )}
      <RenderSettings display={shown ?? displays.find((d) => d.id === chosen) ?? null} />
      <FitNote status={status} />
      {alone ? (
        <Text as="p" role="caption" ariaRole="note" className="vs-output-warn">
          Only one display is connected, so the output covers this one — the menu bar and this window too. Connect a projector or a second display and pick it here; Esc or ⌘⇧L closes the output.
        </Text>
      ) : (
        shown?.main && (
          <Text as="p" role="caption" ariaRole="note" className="vs-output-warn">
            The output is covering the display with the menu bar. Pick another display above.
          </Text>
        )
      )}
    </Text>
  );
}
