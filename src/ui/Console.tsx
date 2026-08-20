import { useMemo, useState } from 'react';
import type { Scheme, SetGrid, Show } from '../../protocol.ts';
import '../../../widgets/src/tokens.css';
import { Button } from '../../../widgets/src/controls/Button.tsx';
import { Segmented } from '../../../widgets/src/controls/Segmented.tsx';
import { Bind } from './Bind.tsx';
import { Coverage } from './Coverage.tsx';
import { Designer } from './Designer.tsx';
import { applyEdits, type Edit, type Scope } from './pending.ts';
import type { Clock } from '../state/useShow.ts';
import './console.css';

/**
 * One app, three views.
 *
 * They are not tabs over a settings screen. Each is a different **distance** to
 * stand at from the same show, and the three are the whole job:
 *
 * | view | the question | the scale |
 * |---|---|---|
 * | **coverage** | what have I not decided about | the set, all of it at once |
 * | **bind** | is this right, and how far should the fix reach | one moment |
 * | **looks** | what is this thing made of | one effect |
 *
 * The order is deliberate and is the order a night before a gig runs in: find
 * the gaps, fix them against the picture, and only then open up the thing you
 * are fixing *with*. Coverage hands an address to bind; bind hands an effect to
 * looks; nothing hands anything back, because going back is what the tabs are.
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

const VIEWS = ['design', 'coverage', 'bind'] as const;
export type View = (typeof VIEWS)[number];

/**
 * Everything an edit could be about, held whole.
 *
 * The scope selector does not *change* the aim — it chooses which part of it the
 * edit lands on. That is the insight the whole gesture rests on: "this pad, in
 * this chorus, of this song, in this clip" is one address, and fixing it at the
 * track versus at the clip is the same annoyance answered at two different
 * distances. Holding the address whole is what lets the scope be a segmented
 * control rather than four separate screens.
 */
export interface Aim {
  song: string | null;
  section: string | null;
  track: { t: number; name: string } | null;
  clip: string | null;
}

/** Which part of the address a scope lands on, or null when it has none to land on. */
export function keyFor(aim: Aim, scope: Scope): string | null {
  if (scope === 'song') return aim.song;
  if (scope === 'section') return aim.section;
  if (scope === 'track') return aim.track?.name ?? null;
  return aim.clip;
}

export function Console({ show, showRef, scheme, grid, save, clock, onClose }: ConsoleProps) {
  const [view, setView] = useState<View>('design');
  /**
   * Staged, not saved.
   *
   * Held here rather than in `Bind` so that going to look at the effect you are
   * about to apply does not throw away the change you were judging. The edit
   * survives the view; only landing it or discarding it ends it.
   */
  const [edits, setEdits] = useState<Edit[]>([]);
  const [look, setLook] = useState<string | null>(null);
  /**
   * Null means *follow the set*, which is what it should do while a set is
   * running: bind opens on whatever is on screen. Clicking a coverage cell pins
   * it, because at that point you have said which cell you mean.
   */
  const [pinned, setPinned] = useState<Aim | null>(null);

  const following: Aim = {
    song: show.song,
    section: show.role,
    track: show.layers[0] ? { t: show.layers[0].t, name: show.layers[0].name } : null,
    clip: null,
  };
  const aim = pinned ?? following;

  // The proposed scheme, rebuilt only when a staged edit moves. Two compositors
  // read this every frame and rebuilding it per frame would rebuild every
  // shader signature with it.
  const proposed = useMemo(() => applyEdits(scheme, edits), [scheme, edits]);

  const land = () => {
    save(proposed);
    setEdits([]);
  };

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
        <span className="context">{contextOf(view, show, scheme, look, edits.length)}</span>
        <Button tone="quiet" label="Close console" onPress={onClose}>
          ×
        </Button>
      </header>

      {view === 'coverage' && (
        <Coverage
          show={show}
          scheme={scheme}
          grid={grid}
          save={save}
          clock={clock}
          aim={aim}
          onAim={(next) => setPinned(next)}
          onOpen={(next) => {
            setPinned(next);
            setView('bind');
          }}
          onLook={(id) => {
            setLook(id);
            setView('design');
          }}
        />
      )}

      {view === 'bind' && (
        <Bind
          show={show}
          showRef={showRef}
          scheme={scheme}
          proposed={proposed}
          grid={grid}
          clock={clock}
          aim={aim}
          onAim={setPinned}
          edits={edits}
          setEdits={setEdits}
          onLand={land}
          onDiscard={() => setEdits([])}
          onLook={(id) => {
            setLook(id);
            setView('design');
          }}
        />
      )}

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
    </div>
  );
}

/**
 * The line on the right of the tab bar, which says where you are.
 *
 * Different per view on purpose: at set scale the useful fact is how much set
 * there is, at a moment it is which moment, and inside an effect it is how far
 * that effect reaches. One universal status line would be wrong in two of the
 * three places.
 */
function contextOf(
  view: View,
  show: Show,
  scheme: Scheme,
  look: string | null,
  pending: number,
): string {
  if (view === 'coverage') {
    const songs = show.songs.length;
    const layers = show.layers.length;
    return `${songs} song${songs === 1 ? '' : 's'} · ${layers} track${layers === 1 ? '' : 's'}${
      show.connected ? '' : ' · no bridge'
    }`;
  }
  if (view === 'bind') {
    const where = [show.song ?? 'no song', show.role ? `[${show.role}]` : null]
      .filter(Boolean)
      .join(' · ');
    const staged = pending > 0 ? ` · ${pending} pending` : '';
    return `${where} · ${show.tempo.toFixed(0)}${staged}`;
  }
  const def = look ? scheme.looks[look] : null;
  const made = Object.values(scheme.looks).filter((each) => each.circuit).length;
  if (!def) return `${Object.keys(scheme.looks).length} looks · ${made} of your own`;
  const reach = Object.values(scheme.layers).filter((l) => l.looks?.includes(look!)).length;
  const bound = reach === 0 ? 'not bound yet' : `${reach} layer${reach === 1 ? '' : 's'}`;
  return `${def.name} · ${bound}`;
}
