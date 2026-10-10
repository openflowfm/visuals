import type { LibraryRow } from '../../api.ts';
import { TagEditor } from '../../TagEditor.tsx';
import { Icon } from '../icons.tsx';
import { AddAction, BackAction, EditAction, holding, NeverAction, PlayAction, StarAction } from './actions.tsx';
import { Field } from './Field.tsx';
import { characterOf, colourNames, fieldSays, listed, type InspectorProps } from './model.ts';
import './inspector-content.css';

export type { InspectorProps } from './model.ts';

/**
 * The inspector ("Scope"): the preset placed among the library, as an
 * instrument's XY display would: the field first, then the name large, its
 * authors, its measures read out as one line of words, its colours as dots,
 * its actions as a row of keys, my tags and the playlists holding it. It is
 * about the preset playing, or one picked (a dot in the field, or a tile the
 * Home passes in) until "back". With nothing playing the field still draws
 * the library, and it says so; no action shows. Mount it in HomeLayout's
 * `inspector` slot (its panel is InspectorPanel); it holds no state of its own
 * beyond the field's pointer and keyboard cursor.
 */
export function Inspector(props: InspectorProps) {
  const { subject: p, playing, from, playlists, library, onSet, onAddTo, onPick, onBack, onPlay, onEdit } = props;
  const picked = p !== null && p.row.key !== playing;
  const c = p ? characterOf(p) : null;
  const readout = c ? [c.speed.word, c.brightness.word, c.intensity.word].filter((w): w is string => !!w) : [];
  const colours = c ? colourNames(c) : [];
  const inLists = p ? holding(p, playlists) : null;
  const measured = library.reduce((n, r) => (r.look ? n + 1 : n), 0);
  const pick = (row: LibraryRow) => (row.key === playing ? onBack() : onPick(row));
  return (
    <div className="insp" data-none={p ? undefined : ''}>
      {picked && (
        <div className="insp-top">
          <BackAction className="insp-back" onBack={onBack} />
        </div>
      )}
      <Field
        library={library}
        subject={p?.row.key ?? null}
        playing={playing}
        intensity={c?.intensity.at ?? null}
        hue={c?.hues[0]?.css ?? 'var(--fg)'}
        description={fieldSays(c, measured)}
        onPick={pick}
      />
      {!p || !c ? (
        <div className="insp-none">
          <p className="insp-none-title">Nothing playing yet</p>
          <p className="insp-quiet">Each dot is a preset, by how fast it moves and how bright it is. Pick one to see it here, or play one and it lights up.</p>
        </div>
      ) : (
        <>
          <div className="insp-head">
            <p className="insp-kicker">
              {picked ? 'Picked' : 'Now playing'}
              {c.style && (
                <>
                  <span className="insp-sep" aria-hidden="true" />
                  {c.subStyle ? `${c.style}, ${c.subStyle}` : c.style}
                </>
              )}
            </p>
            <h2 className="insp-name" title={c.name}>
              {c.name}
            </h2>
            {c.by && <p className="insp-by">{c.by}</p>}
            {!picked && from && <p className="insp-from">{from}</p>}
          </div>

          <div className="insp-read">
            {c.unmeasured ? (
              <p className="insp-quiet">Not drawn yet</p>
            ) : (
              <p className="insp-words">
                {readout.map((w, i) => (
                  <span key={w + i}>
                    {i > 0 && <span className="insp-sep" aria-hidden="true" />}
                    {w}
                  </span>
                ))}
              </p>
            )}
            {(c.hues.length > 0 || c.grey) && (
              <p className="insp-hues">
                <span className="insp-swatches" aria-hidden="true">
                  {c.hues.length ? c.hues.map((h, i) => <span key={i} className="insp-swatch" style={{ background: h.css }} />) : <span className="insp-swatch" data-grey="" />}
                </span>
                <span>{colours.length ? listed(colours) : 'grey'}</span>
              </p>
            )}
          </div>

          <div className="insp-keys">
            {picked && (
              <PlayAction className="insp-key" onPlay={onPlay}>
                <span aria-hidden="true">Play</span>
              </PlayAction>
            )}
            <StarAction className="insp-key" p={p} onSet={onSet}>
              <span aria-hidden="true">{p.star ? 'Starred' : 'Star'}</span>
            </StarAction>
            <AddAction className="insp-key" p={p} playlists={playlists} onAddTo={onAddTo}>
              <span aria-hidden="true">Add</span>
            </AddAction>
            <NeverAction className="insp-key" p={p} onSet={onSet}>
              <span aria-hidden="true">Never</span>
            </NeverAction>
            <EditAction className="insp-key" onEdit={onEdit}>
              <span aria-hidden="true">Edit</span>
            </EditAction>
          </div>

          <div className="insp-mine">
            <TagEditor className="insp-tags" chosen={[p]} onSet={onSet} remove={<Icon name="close" size={10} />} />
            {inLists && <p className="insp-quiet insp-in">{inLists.length ? `In ${listed(inLists)}` : 'In no playlist yet'}</p>}
          </div>
        </>
      )}
    </div>
  );
}
