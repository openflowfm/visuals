import { useEffect, useRef } from 'react';
import { Group } from '@satoramoto/zen';
import { Text } from '@satoramoto/zen';
import type { LibraryRow } from '../model/api';
import { Say } from '../model/words';
import type { Prepared } from '../model/librarySearch';
import { characterOf, colourNames, listed, type InspectorProps } from '../model/inspector-model';
import { TagEditor } from '../TagEditor/TagEditor';
import { Icon } from '../Icon/Icon';
import { LibraryMap } from '../Field/LibraryMap';
import { TuneCard } from '../Tune/Tune';
import { AddAction, BackAction, CloseAction, EditAction, holding, NeverAction, PlayAction, StarAction } from './actions';
import './Inspector.css';

export type { InspectorProps } from '../model/inspector-model';

/**
 * **Job.** The inspector ("Scope"): the right-hand region's two parts. On top, the details of
 * what is selected, as Finder's and Photos' inspectors show it; at the bottom, pinned, the
 * library map (`LibraryMap`: the whole library by speed and brightness, the preset playing lit),
 * which never depends on what the details are about. The details' header row holds the panel's
 * controls and the actions on what it is about, as glyphs: back (for one picked) at the left;
 * Play (for one picked), star, add, never play and edit at the right, then ✕. Under it every
 * state reads in one order: what it is (the name large, its authors), then its facts (style, its
 * measures read out as one line of words, its colours as dots, my tags), then its own speed and
 * how much it reacts ("for this preset", Tune) and the playlists holding it. It is about the
 * preset playing, or one picked (a tile the Home passes in) until "back". For several picked
 * together (`chosen`), "n selected", their styles and tags, their pictures, and the actions over
 * all of them in the header (a tune is one preset's, so none shows for several). With no preset,
 * the source the Home passes (`source`, a playlist's head); with neither, it says nothing plays.
 * A dot in the map plays that preset (`onPick`), so the details follow it as they follow any
 * change of what plays; the dot playing goes back to it (`onBack`) while the details are about
 * something else. The details scroll when the region is short; the map keeps its 4:3 at the
 * region's width. Mount it in HomeLayout's `inspector` slot (its panel, the right-hand `Region`,
 * is InspectorPanel); it holds no state of its own beyond the field's pointer and keyboard cursor.
 *
 * **Changed.** Its sections are `Group`s (the actions, the facts, the tune), named as the
 * original's groups were, with no visible label but the tune's heading. It paints nothing: the
 * panel's layer is behind it. Colours are the contract's ink steps and the raised caption
 * (visuals.css), spacing the scale's where the source's steps match. The several-picked count
 * sits on the black key at 60% rather than a literal black. The map is no longer one of the
 * details (between the facts and the tune, given up for several picked's pictures or a source's
 * card): it is its own section under them, always there, lighting the preset playing rather than
 * the one shown. A dot plays rather than shows (the Home's `onPick`).
 *
 * **Kept.** Its props, the details' order, every name, role, title and word, Escape closing it
 * unless something inside took the key first or it was typed in a text box.
 */
export function Inspector(props: InspectorProps) {
  const { subject: p, playing, playingPreset, chosen, source, error, playlists, library, mine, onSet, onAddTo, onPick, onPlay, onEdit, onBack, onClose } = props;
  const many = chosen && chosen.length > 1 ? chosen : null;
  const picked = !many && p !== null && p.row.key !== playing;
  // What the actions act on: several picked, or the one shown (none for the source or nothing).
  const on = many ?? (p ? [p] : null);
  // The details are about the preset playing: one shown that plays, not several, not a source.
  const aboutPlaying = !many && p !== null && p.row.key === playing;
  // The map lights the preset playing: the Home's, else the one shown when it is the one playing.
  const lit = playingPreset !== undefined ? playingPreset : aboutPlaying ? p : null;
  // A dot plays (the Home's `onPick`); the dot playing brings the details back to it, and does nothing while they show it.
  const pick = (row: LibraryRow) => (row.key !== playing ? onPick(row) : aboutPlaying ? undefined : onBack());
  useEscape(onClose);
  return (
    <div className="vs-inspector" data-none={many || p || source ? undefined : ''}>
      <div className="vs-inspector-details">
        {(picked || onClose || on) && (
          <div className="vs-inspector-top">
            {picked && (
              <BackAction className="vs-inspector-back" onBack={onBack}>
                <Text role="caption" className="vs-inspector-back-label" aria-hidden="true">
                  {Say('stage')}
                </Text>
              </BackAction>
            )}
            {on && (
              <Group name={many ? 'on these presets' : 'on this preset'} label={false} className="vs-inspector-keys">
                {picked && <PlayAction className="vs-inspector-key" onPlay={onPlay} children="" />}
                <StarAction className="vs-inspector-key" chosen={on} onSet={onSet} children="" />
                <AddAction className="vs-inspector-key" chosen={on} playlists={playlists} onAddTo={onAddTo} children="" />
                <NeverAction className="vs-inspector-key" chosen={on} onSet={onSet} children="" />
                {!many && <EditAction className="vs-inspector-key" onEdit={onEdit} children="" />}
              </Group>
            )}
            <CloseAction className="vs-inspector-close" onClose={onClose} />
          </div>
        )}
        {many ? <Selected {...props} chosen={many} /> : !p && source ? <div className="vs-inspector-source">{source}</div> : <Scope {...props} />}
        {error && (
          <Text as="p" role="caption" className="vs-inspector-error" ariaRole="alert">
            {error}
          </Text>
        )}
      </div>
      <LibraryMap library={library} mine={mine} playing={lit} onPick={pick} />
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

/** One preset (or none): its name, its facts and tags, then its tune and playlists (its actions are in the header). With none, the words saying so. */
function Scope({ subject: p, playlists, onSet }: InspectorProps) {
  const c = p ? characterOf(p) : null;
  const readout = c ? [c.speed.word, c.brightness.word, c.intensity.word].filter((w): w is string => !!w) : [];
  const colours = c ? colourNames(c) : [];
  const inLists = p ? holding(p, playlists) : null;
  if (!p || !c)
    return (
      <div className="vs-inspector-head vs-inspector-none">
        <Text as="p" role="heading" className="vs-inspector-none-title">
          Nothing playing yet
        </Text>
        <Text as="p" role="caption" className="vs-inspector-quiet">
          Play a preset and its name, its look and its tune show here.
        </Text>
      </div>
    );
  return (
    <>
      <div className="vs-inspector-head">
        <Text as="h2" role="display" weight="strong" className="vs-inspector-name" title={c.name}>
          {c.name}
        </Text>
        {c.by && <p className="vs-inspector-by">{c.by}</p>}
      </div>

      <Group name="about this preset" label={false} direction="column" gap={0} className="vs-inspector-meta">
        {c.style && (
          <Text as="p" role="caption" className="vs-inspector-style">
            {c.subStyle ? `${c.style}, ${c.subStyle}` : c.style}
          </Text>
        )}
        <div className="vs-inspector-read">
          {c.unmeasured ? (
            <Text as="p" role="caption" className="vs-inspector-quiet">
              Not drawn yet
            </Text>
          ) : (
            <Text as="p" className="vs-inspector-words">
              {readout.map((w, i) => (
                <span key={w + i}>
                  {i > 0 && <span className="vs-inspector-sep" aria-hidden="true" />}
                  {w}
                </span>
              ))}
            </Text>
          )}
          {(c.hues.length > 0 || c.grey) && (
            <Text as="p" role="caption" className="vs-inspector-hues">
              <span className="vs-inspector-swatches" aria-hidden="true">
                {c.hues.length ? c.hues.map((h, i) => <span key={i} className="vs-inspector-swatch" style={{ background: h.css }} />) : <span className="vs-inspector-swatch" data-grey="" />}
              </span>
              <span>{colours.length ? listed(colours) : 'grey'}</span>
            </Text>
          )}
        </div>
        <div className="vs-inspector-mine">
          <TagEditor key={p.row.key} chosen={[p]} onSet={onSet} remove={<Icon name="close" size={10} />} />
        </div>
      </Group>

      <TuneCard key={p.row.key} subject={p} onSet={onSet} />

      {inLists && (
        <Text as="p" role="caption" className="vs-inspector-quiet vs-inspector-in">
          {inLists.length ? `In ${listed(inLists)}` : 'In no playlist yet'}
        </Text>
      )}
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

/** Several presets picked together: how many, their styles and tags over all of them, and their pictures under those (star, add and never play over all of them are in the header). */
function Selected({ chosen, onSet }: InspectorProps & { chosen: Prepared[] }) {
  const n = chosen.length;
  const more = n - PICTURES;
  const styles = stylesSaid(chosen);
  return (
    <>
      <div className="vs-inspector-head">
        <Text as="h2" role="display" weight="strong" className="vs-inspector-name">{`${n.toLocaleString('en-US')} selected`}</Text>
      </div>
      <Group name="about these presets" label={false} direction="column" gap={0} className="vs-inspector-meta">
        {styles && (
          <Text as="p" role="caption" className="vs-inspector-style">
            {styles}
          </Text>
        )}
        <div className="vs-inspector-mine">
          <TagEditor key={chosen.map((p) => p.row.key).join('\n')} chosen={chosen} onSet={onSet} remove={<Icon name="close" size={10} />} />
        </div>
      </Group>
      <div className="vs-inspector-pictures" aria-hidden="true">
        {chosen.slice(0, PICTURES).map((p) => (
          <div key={p.row.key}>{p.row.thumbnail && <img src={p.row.thumbnail} alt="" decoding="async" draggable={false} />}</div>
        ))}
        {more > 0 && (
          <Text role="caption" weight="strong" tabular className="vs-inspector-pictures-more">
            +{more.toLocaleString('en-US')}
          </Text>
        )}
      </div>
    </>
  );
}
