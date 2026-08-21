import { useState } from 'react';
import type { Scheme, SetGrid, Show } from '../../protocol.ts';
import '../../../widgets/src/tokens.css';
import { Button } from '../../../widgets/src/controls/Button.tsx';
import { Segmented } from '../../../widgets/src/controls/Segmented.tsx';
import { Designer } from './Designer.tsx';
import { SetView } from './SetView.tsx';
import type { Clock } from '../state/useShow.ts';
import './console.css';

/**
 * One app, two views, and it used to be three.
 *
 * **Design** is the product: a canvas, a library of looks, and a browser of
 * every node there is. **Set** is the small remainder — the wheel that turns
 * through what you built, and the handful of songs that want to say otherwise.
 *
 * What went was coverage and bind, and both went for the same reason. Coverage
 * drew every song against every track and asked which cell nobody had decided
 * about; bind held a four-level address and asked how far a fix should reach.
 * Both were navigation for a cascade, and the cascade existed to answer how two
 * pictures combine. A graph answers that, so there are no cells to be missing
 * and no scope to choose — what a track draws is something you wire.
 *
 * Deleting them rather than leaving them was the whole point. Keeping them would
 * have meant keeping the cascade alive underneath, which is exactly the
 * complexity the collapse was for.
 */
export interface ConsoleProps {
  show: Show;
  showRef: { readonly current: Show };
  scheme: Scheme;
  grid: SetGrid | null;
  save(next: Scheme): void;
  clock: Clock;
  onClose(): void;
}

const VIEWS = ['design', 'set'] as const;
export type View = (typeof VIEWS)[number];

export function Console({ show, scheme, grid, save, clock, onClose }: ConsoleProps) {
  const [view, setView] = useState<View>('design');
  const [look, setLook] = useState<string | null>(null);

  return (
    <div className="console wdg">
      <header>
        <Segmented
          items={VIEWS as unknown as string[]}
          index={VIEWS.indexOf(view)}
          onChange={(i) => setView(VIEWS[i])}
          label="View"
          className="views"
        />
        <span className="context">{contextOf(view, show, scheme, look)}</span>
        <Button tone="quiet" label="Close console" onPress={onClose}>
          ×
        </Button>
      </header>

      {view === 'design' && (
        <Designer
          show={show}
          scheme={scheme}
          save={save}
          clock={clock}
          look={look}
          setLook={setLook}
        />
      )}

      {view === 'set' && <SetView show={show} scheme={scheme} grid={grid} save={save} />}
    </div>
  );
}

/**
 * The line on the right of the tab bar, which says where you are.
 *
 * Different per view on purpose: inside a look the useful fact is what it is
 * made of, and at set scale it is what the wheel is doing. One universal status
 * line would be wrong in one of the two places.
 */
function contextOf(view: View, show: Show, scheme: Scheme, look: string | null): string {
  if (view === 'set') {
    const songs = show.songs.length;
    const pinned = Object.keys(scheme.songs).length;
    return `${songs} song${songs === 1 ? '' : 's'} · ${pinned} overridden${
      show.connected ? '' : ' · no bridge'
    }`;
  }
  const made = Object.keys(scheme.looks).length;
  const def = look ? scheme.looks[look] : null;
  if (!def) return `${made} look${made === 1 ? '' : 's'}`;
  const nodes = def.circuit.nodes.length;
  return `${def.name} · ${nodes} node${nodes === 1 ? '' : 's'} · ${made} in the library`;
}
