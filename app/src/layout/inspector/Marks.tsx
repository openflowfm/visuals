import type { CSSProperties } from 'react';
import { Numbers } from '../../HomeBar.tsx';
import { AddAction, BackAction, EditAction, holding, NeverAction, PlayAction, StarAction, TagsAction } from './actions.tsx';
import { characterOf, colourNames, type Character, type InspectorProps, type Measure } from './model.ts';
import './marks.css';

/**
 * Option A, Marks: the preset's character drawn rather than tabled. Its name
 * set large under the picture; its colours a strip of the hues themselves;
 * brightness, speed and intensity each a hairline scale with one dot where the
 * preset sits, its word beside it. The dimension's name is there for a screen
 * reader and on hover, not printed: the words (dark, slow, calm) say it.
 */
export function InspectorMarks(props: InspectorProps) {
  const { subject: p, picked, picture, from, playlists, onSet, onAddTo, onBack, onPlay, onEdit } = props;
  if (!p) {
    return (
      <div className="insp-a" data-none="">
        <div className="insp-a-none">
          <span className="insp-a-none-mark" aria-hidden="true" />
          <p className="insp-a-none-title">Nothing playing yet</p>
          <p className="insp-a-none-line">Play a preset, or pick one in a section, and its character shows here.</p>
        </div>
      </div>
    );
  }
  const c = characterOf(p);
  const kind = c.subStyle ? `${c.style} · ${c.subStyle}` : c.style;
  const lists = holding(p, playlists);
  return (
    <div className="insp-a">
      {picked && (
        <div className="insp-a-top">
          <BackAction className="insp-a-back" onBack={onBack} />
        </div>
      )}
      <div className="insp-a-pic">{picture ? <img src={picture} alt={`preview of ${c.name}`} draggable={false} /> : <span className="insp-a-pic-none">Not drawn yet</span>}</div>

      <div className="insp-a-head">
        <p className="insp-a-kind">{kind}</p>
        <h2 className="insp-a-name" title={c.name}>
          {c.name}
        </h2>
        {c.by && <p className="insp-a-by">{c.by}</p>}
        {from && (
          <p className="insp-a-from">
            <Numbers text={from} />
          </p>
        )}
        {picked && onPlay && <PlayAction className="insp-a-act insp-a-play" onPlay={onPlay} />}
      </div>

      {c.unmeasured ? <p className="insp-a-unmeasured">Its colours and pace show once the index has drawn it.</p> : <Marks c={c} />}

      <div className="insp-a-actions">
        <StarAction className="insp-a-act" p={p} onSet={onSet} />
        <AddAction className="insp-a-act insp-a-add" p={p} playlists={playlists} onAddTo={onAddTo} />
        <NeverAction className="insp-a-act" p={p} onSet={onSet}>
          <span className="insp-a-never-glyph" aria-hidden="true" />
          <span aria-hidden="true">Never play</span>
        </NeverAction>
        <EditAction className="insp-a-act" onEdit={onEdit} />
      </div>

      <TagsAction className="insp-a-tags" p={p} onSet={onSet} />
      {lists && lists.length > 0 && (
        <p className="insp-a-in">
          In <span className="insp-a-in-names">{lists.join(', ')}</span>
        </p>
      )}
    </div>
  );
}

/** The colours as a strip and the three measures as scales; whatever wasn't measured is left out. */
function Marks({ c }: { c: Character }) {
  const names = colourNames(c);
  const measures: [string, Measure][] = [
    ['brightness', c.brightness],
    ['speed', c.speed],
    ['intensity', c.intensity],
  ];
  const shown = measures.filter(([, m]) => m.word && m.at !== null);
  return (
    <div className="insp-a-marks">
      {(c.hues.length > 0 || c.grey) && (
        <div className="insp-a-hues">
          <div className="insp-a-strip" role="img" aria-label={c.grey ? 'colours: grey' : `colours: ${names.join(', ')}`} data-grey={c.grey ? '' : undefined}>
            {c.hues.map((h, i) => (
              <span key={i} style={{ background: h.css }} title={h.colour} />
            ))}
          </div>
          <p className="insp-a-hue-words">{c.grey ? 'grey, no colour of its own' : names.join(' · ')}</p>
        </div>
      )}
      {shown.length > 0 && (
        <ul className="insp-a-scales">
          {shown.map(([dimension, m]) => (
            <Scale key={dimension} dimension={dimension} m={m} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** One measure: its word, then a hairline from least to most with a dot where the preset sits. */
function Scale({ dimension, m }: { dimension: string; m: Measure }) {
  const at = `${Math.round((m.at ?? 0) * 100)}%`;
  return (
    <li className="insp-a-scale" title={`${dimension}: ${m.word}`}>
      <span className="insp-a-sr">{dimension}: </span>
      <span className="insp-a-word">{m.word}</span>
      <span className="insp-a-track" aria-hidden="true" style={{ '--at': at } as CSSProperties}>
        <span className="insp-a-dot" />
      </span>
    </li>
  );
}
