import { Crate } from '../Crate.tsx';
import { Mark } from '../views.tsx';
import type { StageCrateProps } from './stage-model.ts';
import './stage-crate.css';

/**
 * The Stage's crate down the left (see `StageCrateProps`): what goes in Home's
 * inset sidebar panel — the mark under the window buttons' band, then the
 * crate itself (`Crate`: playlists, moods and up next, each folding under its
 * heading), whose sections scroll inside the panel.
 *
 * The panel is the shell's (`StageLayout`): the `nav` named for the crate with
 * the id `STAGE_CRATE_ID`, its band, its opaque paint, where it sits, and the
 * laid-over crate's Esc, press outside and focus. This draws only what is in
 * it; put away (`mode` 'hidden') it draws nothing.
 */
export function StageCrate({ live, mode }: StageCrateProps) {
  if (mode === 'hidden') return null;
  return (
    <div className="scr-content" data-mode={mode}>
      <div className="scr-mark">
        <Mark />
      </div>
      {live.lists ? (
        <Crate lists={live.lists} data={live.data} act={live.act} onLists={live.setLists} onError={live.fail("Couldn't read or change what's up next.")} current={live.current} />
      ) : (
        <p className="scr-note">Reading the playlists…</p>
      )}
    </div>
  );
}
