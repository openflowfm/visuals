import { useState } from 'react';
import type { Scheme, Show } from '../../protocol.ts';
import '../../../widgets/src/tokens.css';
import { Effects } from './Effects.tsx';
import { Layers } from './Layers.tsx';
import { Sections } from './Sections.tsx';
import { Songs } from './Songs.tsx';
import type { Clock } from '../state/useShow.ts';
import './editor.css';

/**
 * The scheme, as controls.
 *
 * Built from `widgets/`, which is the first use of that module outside a device
 * chain and the point of having it. A knob that knew what an archetype was could
 * not have been written before archetypes existed; one that takes a `Param` and
 * a number was ready. The single adapter is [`param.ts`](./param.ts), the same
 * shape `ui/` has in `lib/liveParam.ts`.
 *
 * **Everything here edits the same file you could edit by hand.** The server
 * writes `scheme.json` on every save, so a show tuned in the browser is one you
 * can read, diff and commit afterwards — the editor is a way of writing the
 * record, not a second place the truth lives.
 *
 * ## Four panes, and they are the cascade
 *
 * `song → archetype → track → clip` is the order specificity runs in, and the
 * tabs are that order: songs own colour and drive, sections own energy and
 * character, layers own what a track does with content and carry the clip
 * exceptions, and effects are the vocabulary the other three point at. Nothing
 * here is a settings screen; each pane is one level of the resolver.
 *
 * The vocabulary is the **set's** throughout. Roles, songs, tracks and the
 * playing clip all arrive on the show, so nothing asks anyone to type a name —
 * which is what the pattern list this replaced could never stop you doing, and
 * a rule matched against a name that does not exist is invisible until the night
 * it was written for.
 */
export interface EditorProps {
  show: Show;
  scheme: Scheme;
  save(next: Scheme): void;
  /** The show's clock, so the effect bench runs in time with the room. */
  clock: Clock;
  onClose(): void;
}

const TABS = ['sections', 'songs', 'layers', 'effects'] as const;
type Tab = (typeof TABS)[number];

export function Editor({ show, scheme, save, clock, onClose }: EditorProps) {
  const [tab, setTab] = useState<Tab>('sections');
  // Held here rather than in the sections pane, so pinning a chorus and then
  // going to look at a layer does not quietly let go of it.
  const [pinned, setPinned] = useState<string | null>(null);

  const patch = (next: Partial<Scheme>) => save({ ...scheme, ...next });

  return (
    <div className="editor wdg" data-wide={tab === 'effects' ? '' : undefined}>
      <header>
        <h2>scheme</h2>
        <nav>
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              data-on={name === tab ? '' : undefined}
              onClick={() => setTab(name)}
            >
              {name}
            </button>
          ))}
        </nav>
        <button type="button" className="close" onClick={onClose} aria-label="Close editor">
          ×
        </button>
      </header>

      <div className="scroll">
        {tab === 'sections' && (
          <Sections
            show={show}
            scheme={scheme}
            patch={patch}
            pinned={pinned}
            setPinned={setPinned}
          />
        )}
        {tab === 'songs' && <Songs show={show} scheme={scheme} patch={patch} />}
        {tab === 'layers' && <Layers show={show} scheme={scheme} patch={patch} />}
        {tab === 'effects' && (
          <Effects show={show} scheme={scheme} patch={patch} save={save} clock={clock} />
        )}
      </div>

      <footer>
        <span className="path">scheme.json</span>
        {show.schemeError && <span className="bad">{show.schemeError}</span>}
      </footer>
    </div>
  );
}
