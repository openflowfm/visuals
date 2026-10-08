import { useCallback, useEffect, useState } from 'react';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { Select } from '@openflow/widgets/controls/Select.tsx';
import * as fx from './fx.ts';
import * as output from './output.ts';

const displayName = (d: output.Display) => `${d.index + 1}. ${d.name} (${d.width}×${d.height})${d.main ? ' · menu bar' : ''}`;

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
          Only one display is connected, so the output covers this one — the menu bar and this window too. Connect a projector or a second display and pick it here;
          ⌘⇧L closes the output.
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
