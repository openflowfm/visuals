import { useEffect, useRef } from 'react';
import type { LibraryRow } from '../../api.ts';
import type { Prepared } from '../../librarySearch.ts';
import { TagEditor } from '../../TagEditor.tsx';
import { Icon } from '../icons.tsx';
import { AddAction, BackAction, CloseAction, EditAction, holding, NeverAction, PlayAction, StarAction } from './actions.tsx';
import { Field } from './Field.tsx';
import { characterOf, colourNames, fieldSays, listed, type InspectorProps } from './model.ts';
import { TuneCard } from './Tune.tsx';
import './inspector-content.css';

export type { InspectorProps } from './model.ts';

/**
 * The inspector ("Scope"): what is selected, as Finder's and Photos'
 * inspectors show it. Every state reads in one order: what it is (the name
 * large, its authors, whether it plays or is picked), then its facts (style,
 * its measures read out as one line of words, its colours as dots, my tags),
 * then the map (the field: the preset placed among the library, as an
 * instrument's XY display would), then its actions as a row of keys, its own
 * speed and how much it reacts ("for this preset", Tune.tsx) and the playlists
 * holding it. It is about the preset playing, or one picked (a dot in the
 * field, or a tile the Home passes in) until "back". For several picked
 * together (`chosen`), "n selected", their styles and tags, their pictures in
 * the map's place, and the actions over all of them (a tune is one preset's,
 * so none shows for several). With no
 * preset, the source the Home passes (`source`, a playlist's head); with
 * neither, the field still draws the library, and it says so. Mount it in
 * HomeLayout's `inspector` slot (its panel is InspectorPanel); it holds no
 * state of its own beyond the field's pointer and keyboard cursor.
 */
export function Inspector(props: InspectorProps) {
  const { subject: p, playing, chosen, source, error, onBack, onClose } = props;
  const many = chosen && chosen.length > 1 ? chosen : null;
  const picked = !many && p !== null && p.row.key !== playing;
  useEscape(onClose);
  return (
    <div className="insp" data-none={many || p || source ? undefined : ''}>
      {(picked || onClose) && (
        <div className="insp-top">
          {picked && <BackAction className="insp-back" onBack={onBack} />}
          <CloseAction className="insp-close" onClose={onClose} />
        </div>
      )}
      {many ? <Selected {...props} chosen={many} /> : !p && source ? <div className="insp-source">{source}</div> : <Scope {...props} picked={picked} />}
      {error && (
        <p className="insp-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Escape calls `onClose`, unless something inside took it first (a popover, the tag box, a rename) or it was typed in a text box. */
function useEscape(onClose: InspectorProps['onClose']) {
  const close = useRef(onClose);
  close.current = onClose;
  const on = !!onClose;
  useEffect(() => {
    if (!on) return;
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || ev.defaultPrevented) return;
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      ev.preventDefault();
      close.current?.();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [on]);
}

/** One preset (or none): its name, its facts and tags, the field, then its actions, tune and playlists. With none, the words saying so above the field. */
function Scope({ subject: p, playing, from, playlists, library, mine, onSet, onAddTo, onPick, onBack, onPlay, onEdit, picked }: InspectorProps & { picked: boolean }) {
  const c = p ? characterOf(p) : null;
  const readout = c ? [c.speed.word, c.brightness.word, c.intensity.word].filter((w): w is string => !!w) : [];
  const colours = c ? colourNames(c) : [];
  const inLists = p ? holding(p, playlists) : null;
  const measured = library.reduce((n, r) => (r.look ? n + 1 : n), 0);
  // The dot playing goes back to it, unless it is already shown.
  const pick = (row: LibraryRow) => (row.key !== playing ? onPick(row) : picked ? onBack() : undefined);
  const field = (
    <Field
      library={library}
      mine={mine}
      subject={p?.row.key ?? null}
      playing={playing}
      intensity={c?.intensity.at ?? null}
      hue={c?.hues[0]?.css ?? 'var(--fg)'}
      description={fieldSays(c, measured, library.length)}
      onPick={pick}
    />
  );
  if (!p || !c)
    return (
      <>
        <div className="insp-head insp-none">
          <p className="insp-none-title">Nothing playing yet</p>
          <p className="insp-quiet">Each dot is a preset, by how fast it moves and how bright it is. Pick one to see it here, or play one and it lights up.</p>
        </div>
        {field}
      </>
    );
  return (
    <>
      <div className="insp-head">
        <h2 className="insp-name" title={c.name}>
          {c.name}
        </h2>
        {c.by && <p className="insp-by">{c.by}</p>}
        <p className="insp-from">
          <span>{picked ? 'Picked' : 'Now playing'}</span>
          {!picked && from && (
            <>
              <span className="insp-sep" aria-hidden="true" />
              <span>{from}</span>
            </>
          )}
        </p>
      </div>

      <div className="insp-meta" role="group" aria-label="about this preset">
        {c.style && <p className="insp-style">{c.subStyle ? `${c.style}, ${c.subStyle}` : c.style}</p>}
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
        <div className="insp-mine">
          <TagEditor key={p.row.key} chosen={[p]} onSet={onSet} remove={<Icon name="close" size={10} />} />
        </div>
      </div>

      {field}

      <div className="insp-keys">
        {picked && (
          <PlayAction className="insp-key" onPlay={onPlay}>
            <span aria-hidden="true">Play</span>
          </PlayAction>
        )}
        <StarAction className="insp-key" chosen={[p]} onSet={onSet} />
        <AddAction className="insp-key" chosen={[p]} playlists={playlists} onAddTo={onAddTo}>
          <span aria-hidden="true">Add</span>
        </AddAction>
        <NeverAction className="insp-key" chosen={[p]} onSet={onSet}>
          <span aria-hidden="true">Never</span>
        </NeverAction>
        <EditAction className="insp-key" onEdit={onEdit}>
          <span aria-hidden="true">Edit</span>
        </EditAction>
      </div>

      <TuneCard key={p.row.key} subject={p} onSet={onSet} />

      {inLists && <p className="insp-quiet insp-in">{inLists.length ? `In ${listed(inLists)}` : 'In no playlist yet'}</p>}
    </>
  );
}

/** How many pictures the selection shows. */
const PICTURES = 6;

/** "Hypnotic and Geometric", "Hypnotic, Geometric and 3 other styles". */
export function stylesSaid(chosen: readonly Prepared[]): string {
  const styles = [...new Set(chosen.map((p) => p.style).filter((s) => !!s))];
  if (styles.length <= 3) return listed(styles);
  const rest = styles.length - 2;
  return `${styles.slice(0, 2).join(', ')} and ${rest} other styles`;
}

/** Several presets picked together: how many, their styles and tags over all of them, their pictures, then star, add and never play over all of them. */
function Selected({ chosen, playlists, onSet, onAddTo }: InspectorProps & { chosen: Prepared[] }) {
  const n = chosen.length;
  const more = n - PICTURES;
  const styles = stylesSaid(chosen);
  return (
    <>
      <div className="insp-head">
        <h2 className="insp-name">{`${n.toLocaleString('en-US')} selected`}</h2>
      </div>
      <div className="insp-meta" role="group" aria-label="about these presets">
        {styles && <p className="insp-style">{styles}</p>}
        <div className="insp-mine">
          <TagEditor key={chosen.map((p) => p.row.key).join('\n')} chosen={chosen} onSet={onSet} remove={<Icon name="close" size={10} />} />
        </div>
      </div>
      <div className="insp-pictures" aria-hidden="true">
        {chosen.slice(0, PICTURES).map((p) => (
          <div key={p.row.key}>{p.row.thumbnail && <img src={p.row.thumbnail} alt="" decoding="async" draggable={false} />}</div>
        ))}
        {more > 0 && <span className="insp-pictures-more">+{more.toLocaleString('en-US')}</span>}
      </div>
      <div className="insp-keys" data-many="">
        <StarAction className="insp-key" chosen={chosen} onSet={onSet} />
        <AddAction className="insp-key" chosen={chosen} playlists={playlists} onAddTo={onAddTo}>
          <span aria-hidden="true">Add</span>
        </AddAction>
        <NeverAction className="insp-key" chosen={chosen} onSet={onSet}>
          <span aria-hidden="true">Never</span>
        </NeverAction>
      </div>
    </>
  );
}
