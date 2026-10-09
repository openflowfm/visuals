import { useCallback, useEffect, useState } from 'react';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { Select } from '@openflow/widgets/controls/Select.tsx';
import * as fx from './fx.ts';
import { useNotice, useTauriEvent } from './hooks.ts';
import * as output from './output.ts';
import { NoticeBanner } from './views.tsx';
import { Say } from './words.ts';

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

/**
 * The output in ⚙ Settings: which display it fills and how the picture fits it.
 * While it is showing (live mode), picking a display moves it there and is
 * remembered; otherwise the list says what is connected, and live mode opens
 * the output on the display picked last.
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
    <div className="wdg output-settings">
      {displays.length > 0 ? (
        <Select
          className="output-display"
          items={displays.map(displayName)}
          index={Math.max(0, pick)}
          onChange={(i) => output.open(displays[i].id).then(setStatus, fail("Couldn't show the output on that display."))}
          label="Display"
          title={shown ? 'The display the output fills; remembered for next time' : 'Go live to pick where the output goes'}
          disabled={!shown}
          width={260}
        />
      ) : (
        <p>No displays found.</p>
      )}
      <p className="output-state" role="status">
        {shown ? `Showing on ${shown.name}.` : 'Not showing: live mode opens it on the display picked last.'}
      </p>
      <p className="output-fit">
        <b>{Say('output fit')}:</b> {fitLine(status)}
      </p>
      <NoticeBanner notice={notice} onDismiss={dismiss} />
    </div>
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
 * Where the live output goes: whether it is showing, the display it fills, and a
 * warning when it covers the display with the menu bar. `status` and `show` are
 * Live's, which opens the output on the way in.
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
    <div className="live-output">
      <h2>Output</h2>
      {shown ? (
        <p className="live-status" data-on="" title={status.size ? `The picture is ${status.size[0]}×${status.size[1]} on the display` : undefined}>
          Showing on {shown.name}
        </p>
      ) : (
        <div className="live-status">
          <span>Not showing</span>
          <Button onPress={() => show(chosen)} title="Open the output full screen on the display picked below">
            Show
          </Button>
        </div>
      )}
      {displays.length > 0 ? (
        <Select
          className="live-display"
          items={displays.map(displayName)}
          index={Math.max(0, pick)}
          onChange={(i) => show(displays[i].id)}
          label="Display"
          title="The display the output fills; remembered for next time"
        />
      ) : (
        <p className="live-note">No displays found.</p>
      )}
      {alone ? (
        <p className="live-warn" role="note">
          Only one display is connected, so the output covers this one — the menu bar and this window too. Connect a projector or a second display and pick it here; Esc or ⌘⇧L closes the output.
        </p>
      ) : (
        shown?.main && (
          <p className="live-warn" role="note">
            The output is covering the display with the menu bar. Pick another display above.
          </p>
        )
      )}
    </div>
  );
}
