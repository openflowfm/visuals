import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { LibraryChange, LibraryRow } from '../../api.ts';
import type { Prepared } from '../../librarySearch.ts';
import { TagEditor } from '../../TagEditor.tsx';
import { Icon } from '../icons.tsx';
import { AddAction, BackAction, CloseAction, EditAction, holdingAll, NeverAction, PlayAction, StarAction } from './actions.tsx';
import { Field } from './Field.tsx';
import { characterOf, colourNames, fieldSays, listed, type Character, type Hue, type InspectorProps } from './model.ts';
import { TuneCard } from './Tune.tsx';
import './inspector-content.css';

export type { InspectorProps } from './model.ts';

/** What a value that doesn't apply shows: nothing playing, the source, or not measured. */
export const DASH = '–';
/** What a measure shows over several picked that don't agree. */
export const MIXED = 'Mixed';
/** How long the Never toast stays, in ms. */
export const TOAST_FOR = 6000;
/** How many playlists show before "+n more"; a tail of one shows whole rather than as "+1 more". */
const LISTS_SHOWN = 3;

/** Which of the five states the inspector is in: the one skeleton reads the same in each. */
type State = 'playing' | 'picked' | 'several' | 'none' | 'source';

/**
 * The inspector ("Scope"): what is selected, as Finder's and Photos'
 * inspectors show it. One skeleton in every state (the preset playing, one
 * picked, several picked, nothing playing, the source), only its content
 * changing, so nothing jumps:
 *
 * - the header (`insp-top`): back (one picked) at the left; the actions on
 *   what it is about as one borderless glyph group (Play for one picked, the
 *   only tinted one; star, add, edit in lab builds; never play apart and
 *   quieter), disabled rather than removed when there is nothing to act on;
 *   then ✕ (laid over). Turning never play on is undone from a toast under
 *   the header (`insp-toast`), never a confirm;
 * - who it is (`insp-id`): the name large, the authors, the style as a quiet
 *   subtitle; "n selected" and their styles; "Nothing playing yet" and how to
 *   start; or the source the Home passes (a playlist's head) in its place;
 * - its character (`insp-char`): speed, brightness, intensity and colours as
 *   caption-then-value rows of words, then my tags; dashes where nothing
 *   applies, "Mixed" where several disagree;
 * - the map (`insp-map`, Field.tsx): the library by the same words, the
 *   subject lit, or every pick ringed, or none;
 * - its own speed and sensitivity (`insp-tune-slot`, Tune.tsx's TuneCard);
 * - the playlists holding it (`insp-lists`), a long tail behind "+n more".
 *
 * It is about the preset playing, or one picked (a dot in the field, or a
 * tile the Home passes in) until "back". Nothing here plays a preset but
 * Play. Mount it in HomeLayout's `inspector` slot (its panel is
 * InspectorPanel); its own state is the toast, the playlists' tail and the
 * field's pointer and keyboard cursor.
 */
export function Inspector(props: InspectorProps) {
  const { subject: p, playing, chosen, source, error, playlists, library, mine, onSet, onAddTo, onPlay, onEdit, onBack, onPick, onClose } = props;
  const many = chosen && chosen.length > 1 ? chosen : null;
  const state: State = many ? 'several' : p ? (p.row.key !== playing ? 'picked' : 'playing') : source ? 'source' : 'none';
  // What the actions, the tags, the tune and the playlists act on: none for the source or nothing.
  const on: readonly Prepared[] = many ?? (p ? [p] : []);
  const keys = on.map((x) => x.row.key);
  const c = !many && p ? characterOf(p) : null;

  const [toast, setToast] = useState<Toast | null>(null);
  const dismiss = () => setToast(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_FOR);
    return () => clearTimeout(t);
  }, [toast]);
  useEscape(onClose, toast ? dismiss : undefined);

  // Never play goes on at once, and the toast keeps what to put back: only those that weren't already never played.
  const onNever = (ks: string[], change: LibraryChange) => {
    onSet(ks, change);
    if (change.hidden) setToast({ restore: on.filter((x) => !x.hidden).map((x) => x.row.key), n: ks.length });
    else setToast(null);
  };

  const measured = library.reduce((n, r) => (r.look ? n + 1 : n), 0);
  // A dot picked: the one playing goes back to it unless it is the one shown; any other is shown.
  const pick = (row: LibraryRow) => (row.key !== playing ? onPick(row) : state !== 'playing' ? onBack() : undefined);
  const description = c
    ? fieldSays(c, measured, library.length)
    : many
      ? `${many.length.toLocaleString('en-US')} picked, each ringed among the library by speed and brightness`
      : `${fieldSays(null, measured, library.length)}. Pick one to see it here`;

  return (
    <div className="insp" data-state={state}>
      <div className="insp-top">
        {state === 'picked' && <BackAction className="insp-back" onBack={onBack} />}
        <div className="insp-keys" role="group" aria-label={many ? 'on these presets' : 'on this preset'}>
          {state === 'picked' && <PlayAction className="insp-key insp-key-play" onPlay={onPlay} children="" />}
          <StarAction className="insp-key" chosen={on} onSet={onSet} children="" />
          <AddAction className="insp-key" chosen={on} playlists={playlists} onAddTo={onAddTo} children="" />
          <EditAction className="insp-key" onEdit={onEdit} disabled={!c} children="" />
          <NeverAction className="insp-key insp-key-never" chosen={on} onSet={onNever} onWord="Never" children="" />
        </div>
        <CloseAction className="insp-close" onClose={onClose} />
      </div>

      {toast && (
        <div className="insp-toast-slot">
          <div
            className="insp-toast"
            role="status"
            onKeyDown={(ev) => {
              if (ev.key !== 'Escape') return;
              ev.preventDefault();
              dismiss();
            }}
          >
            <span>{toast.n > 1 ? 'Won’t play them on their own' : 'Won’t play it on its own'}</span>
            <button
              type="button"
              className="insp-toast-undo"
              onClick={() => {
                if (toast.restore.length) onSet(toast.restore, { hidden: false });
                dismiss();
              }}
            >
              Undo
            </button>
          </div>
        </div>
      )}

      <div className="insp-id">{state === 'source' ? source : <Identity c={c} many={many} />}</div>

      <CharacterRows c={c} many={many} on={on} onSet={onSet} />

      <div className="insp-map">
        <Field
          library={library}
          mine={mine}
          subject={c ? p!.row.key : null}
          playing={playing}
          intensity={c?.intensity.at ?? null}
          hue={c?.hues[0]?.css ?? 'var(--fg)'}
          description={description}
          marked={many ? keys : undefined}
          onPick={pick}
        />
      </div>

      <div className="insp-tune-slot">
        <TuneCard key={keys.join('\n')} subjects={on} onSet={onSet} />
      </div>

      <Playlists key={keys.join('\n')} names={on.length ? holdingAll(on, playlists) : []} none={!on.length} />

      {error && (
        <p className="insp-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** The Never toast: how many it turned on for, and the keys to turn back off on Undo. */
interface Toast {
  restore: string[];
  n: number;
}

/**
 * Escape dismisses the toast while one shows, else calls `onClose` — unless
 * something inside took it first (a popover, the tag box, a rename) or it was
 * typed in a text box.
 */
function useEscape(onClose: InspectorProps['onClose'], dismiss: (() => void) | undefined) {
  const close = useRef(onClose);
  close.current = onClose;
  const toast = useRef(dismiss);
  toast.current = dismiss;
  const on = !!onClose || !!dismiss;
  useEffect(() => {
    if (!on) return;
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || ev.defaultPrevented) return;
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const act = toast.current ?? close.current;
      if (!act) return;
      ev.preventDefault();
      act();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [on]);
}

/** Who it is: the name and authors with the style under them; "n selected" and their styles; or nothing playing and how to start. */
function Identity({ c, many }: { c: Character | null; many: readonly Prepared[] | null }) {
  if (many) {
    const styles = stylesSaid(many);
    return (
      <>
        <h2 className="insp-name">{`${many.length.toLocaleString('en-US')} selected`}</h2>
        <p className="insp-style">{styles || DASH}</p>
      </>
    );
  }
  if (!c)
    return (
      <>
        <h2 className="insp-name">Nothing playing yet</h2>
        <p className="insp-prompt">Pick a dot on the map, or play a preset, to see it here.</p>
      </>
    );
  return (
    <>
      <h2 className="insp-name" title={c.name}>
        {c.name}
      </h2>
      {c.by && <p className="insp-by">{c.by}</p>}
      {c.style && <p className="insp-style">{c.subStyle ? `${c.style}, ${c.subStyle}` : c.style}</p>}
    </>
  );
}

/** One row of the character: its caption, then its value. */
function Row({ caption, children, className }: { caption: string; children: ReactNode; className?: string }) {
  return (
    <div className={className ? `insp-row ${className}` : 'insp-row'}>
      <dt>{caption}</dt>
      <dd data-none={children === DASH ? '' : undefined}>{children}</dd>
    </div>
  );
}

/** One word over several: the word they share, a dash when none has one, else Mixed. */
export function agreed(words: readonly (string | null)[]): string {
  const said = new Set(words);
  if (said.size === 1) return words[0] ?? DASH;
  return said.size === 0 ? DASH : MIXED;
}

/** Colours over several: each colour once, the first hue seen for it as its swatch, in the order met. */
function huesOver(cs: readonly Character[]): Hue[] {
  const seen = new Map<string, Hue>();
  for (const c of cs) for (const h of c.hues) if (!seen.has(h.colour)) seen.set(h.colour, h);
  return [...seen.values()];
}

/** The character: speed, brightness, intensity and colours as caption-then-value rows, then my tags. */
function CharacterRows({ c, many, on, onSet }: { c: Character | null; many: readonly Prepared[] | null; on: readonly Prepared[]; onSet: InspectorProps['onSet'] }) {
  const cs = many ? many.map(characterOf) : c ? [c] : [];
  const word = (m: 'speed' | 'brightness' | 'intensity') => (cs.length ? agreed(cs.map((x) => x[m].word)) : DASH);
  const hues = huesOver(cs);
  const grey = !hues.length && cs.some((x) => x.grey);
  const unmeasured = cs.length > 0 && cs.every((x) => x.unmeasured);
  const names = many ? hues.map((h) => h.colour) : c ? colourNames(c) : [];
  return (
    <div className="insp-char" role="group" aria-label={many ? 'about these presets' : 'about this preset'}>
      <p className="insp-cap" aria-hidden="true">
        Character
      </p>
      <dl className="insp-rows">
        <Row caption="Speed">{word('speed')}</Row>
        <Row caption="Brightness">{word('brightness')}</Row>
        <Row caption="Intensity">{word('intensity')}</Row>
        <Row caption="Colours" className="insp-row-hues">
          {hues.length || grey ? (
            <>
              <span className="insp-swatches" aria-hidden="true">
                {hues.length ? hues.map((h) => <span key={h.colour} className="insp-swatch" style={{ background: h.css }} />) : <span className="insp-swatch" data-grey="" />}
              </span>
              <span>{names.length ? listed(names) : 'grey'}</span>
            </>
          ) : unmeasured ? (
            <span className="insp-quiet">Not drawn yet</span>
          ) : (
            DASH
          )}
        </Row>
        <Row caption="Tags" className="insp-row-tags">
          {on.length ? <TagEditor key={on.map((x) => x.row.key).join('\n')} chosen={[...on]} onSet={onSet} remove={<Icon name="close" size={10} />} /> : DASH}
        </Row>
      </dl>
    </div>
  );
}

/** "Hypnotic and Geometric", "Hypnotic, Geometric and 3 other styles". */
export function stylesSaid(chosen: readonly Prepared[]): string {
  const styles = [...new Set(chosen.map((p) => p.style).filter((s) => !!s))];
  if (styles.length <= 3) return listed(styles);
  const rest = styles.length - 2;
  return `${styles.slice(0, 2).join(', ')} and ${rest} other styles`;
}

/** The playlists holding it, as quiet lines; a long tail behind "+n more". Null names: not read yet. */
function Playlists({ names, none }: { names: string[] | null; none: boolean }) {
  const [all, setAll] = useState(false);
  const caption = useId();
  const tail = names && names.length > LISTS_SHOWN + 1 ? names.length - LISTS_SHOWN : 0;
  const shown = names && tail && !all ? names.slice(0, LISTS_SHOWN) : names;
  return (
    <div className="insp-lists" role="group" aria-labelledby={caption}>
      <p className="insp-cap" id={caption}>
        In playlists
      </p>
      {none ? (
        <p className="insp-lists-none">{DASH}</p>
      ) : !shown ? (
        <p className="insp-lists-none">…</p>
      ) : !shown.length ? (
        <p className="insp-lists-none">None yet</p>
      ) : (
        <ul className="insp-lists-names">
          {shown.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {tail > 0 && (
        <button type="button" className="insp-more" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? 'Fewer' : `+${tail.toLocaleString('en-US')} more`}
        </button>
      )}
    </div>
  );
}
