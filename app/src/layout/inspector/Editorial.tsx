import { Numbers } from '../../HomeBar.tsx';
import { Icon } from '../icons.tsx';
import { AddAction, BackAction, EditAction, holding, NeverAction, PlayAction, StarAction, TagsAction } from './actions.tsx';
import { characterOf, describe, listed, swatchOf, type Character, type InspectorProps } from './model.ts';
import './editorial.css';

/**
 * Option B, Editorial: the inspector set like a magazine page. A kicker, the
 * preset's name large, a byline, and a standfirst written from its analysis
 * (`describe`); then the actions as a row of words, and short sections told
 * apart by type alone: its colours named, its measures in three words, and
 * where it sits in the user's library (their tags, the playlists holding it).
 * The quieter actions, never play and the editor, close the page.
 *
 * The picture shows as a plate only for a tile picked: for the preset playing
 * the hero above already shows it large, and a second, smaller copy beside it
 * would only repeat it.
 */
export function InspectorEditorial(props: InspectorProps) {
  const { subject: p, picked, picture, from, playlists, onSet, onAddTo, onBack, onPlay, onEdit } = props;
  if (!p) {
    return (
      <div className="insp-b" data-none="">
        <p className="insp-b-kicker">Now playing</p>
        <h2 className="insp-b-title insp-b-title-none">Nothing playing yet</h2>
        <p className="insp-b-lede">Pick a preset in the library and its story shows here: its colours, its pace, and where you keep it.</p>
      </div>
    );
  }
  const c = characterOf(p);
  const kicker = picked ? [c.style, c.subStyle].filter(Boolean).join(' · ') : 'Now playing';
  const lists = holding(p, playlists);
  return (
    <div className="insp-b">
      {picked && (
        <div className="insp-b-nav">
          <BackAction className="insp-b-back" onBack={onBack} />
        </div>
      )}
      <div className="insp-b-head">
        <p className="insp-b-kicker">{kicker}</p>
        <h2 className="insp-b-title" title={c.name} data-long={c.name.length > 56 ? 'very' : c.name.length > 30 ? '' : undefined}>
          {c.name}
        </h2>
        {c.by && <p className="insp-b-byline">by {c.by}</p>}
        {from && (
          <p className="insp-b-from">
            <Numbers text={from} />
          </p>
        )}
      </div>

      {picked && picture && (
        <figure className="insp-b-plate">
          <img src={picture} alt={`preview of ${c.name}`} draggable={false} />
        </figure>
      )}

      <p className="insp-b-lede">{describe(c)}</p>

      <div className="insp-b-actions">
        {picked && <PlayAction className="insp-b-act insp-b-act-lead" onPlay={onPlay} />}
        <StarAction className="insp-b-act" p={p} onSet={onSet} />
        <AddAction className="insp-b-act insp-b-pop" p={p} playlists={playlists} onAddTo={onAddTo} />
      </div>

      <Colours c={c} />
      <Pace c={c} />

      <div className="insp-b-sec">
        <h3 className="insp-b-kicker">In your library</h3>
        <TagsAction className="insp-b-tags" p={p} onSet={onSet} />
        {lists && <p className="insp-b-note">{lists.length ? `In ${listed(lists)}.` : 'In no playlist yet.'}</p>}
      </div>

      <div className="insp-b-foot">
        <NeverAction className="insp-b-act insp-b-quiet" p={p} onSet={onSet} />
        <EditAction className="insp-b-act insp-b-quiet" onEdit={onEdit}>
          <span aria-hidden="true">Open in the editor</span>
          <Icon name="chevron-right" size={14} />
        </EditAction>
      </div>
    </div>
  );
}

/** Its colours, named in a sentence, each with a small swatch set in the line; grey or undrawn says so. */
function Colours({ c }: { c: Character }) {
  if (c.unmeasured) return null;
  const names = [...new Map(c.hues.map((h) => [h.colour, h])).values()];
  return (
    <div className="insp-b-sec">
      <h3 className="insp-b-kicker">In colour</h3>
      {names.length ? (
        <p className="insp-b-prose insp-b-colours">
          {names.map((h, i) => (
            <span key={h.colour} className="insp-b-colour">
              <span className="insp-b-swatch" style={{ background: swatchOf(h.colour) }} aria-hidden="true" />
              {h.colour}
              {i < names.length - 2 ? ', ' : i === names.length - 2 ? ' and ' : ''}
            </span>
          ))}
        </p>
      ) : (
        <p className="insp-b-prose">Grey, without a colour of its own.</p>
      )}
    </div>
  );
}

/** At a glance: speed, brightness and intensity as three words, set large, each over a hairline with a dot where it sits. */
function Pace({ c }: { c: Character }) {
  const measures = [
    { name: 'speed', m: c.speed },
    { name: 'brightness', m: c.brightness },
    { name: 'intensity', m: c.intensity },
  ].filter((x) => x.m.word);
  if (!measures.length) return null;
  return (
    <div className="insp-b-sec">
      <h3 className="insp-b-kicker">At a glance</h3>
      <dl className="insp-b-pace">
        {measures.map(({ name, m }) => (
          <div key={name} className="insp-b-measure">
            <dt>{name}</dt>
            <dd>
              {m.word}
              {m.at !== null && (
                <span className="insp-b-scale" aria-hidden="true">
                  <span style={{ left: `${m.at * 100}%` }} />
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
