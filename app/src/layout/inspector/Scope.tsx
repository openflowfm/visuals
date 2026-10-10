import { useMemo } from 'react';
import type { LibraryRow } from '../../api.ts';
import { AddAction, BackAction, EditAction, holding, NeverAction, PlayAction, StarAction, TagsAction } from './actions.tsx';
import { characterOf, colourNames, listed, scaleOf, type Character, type InspectorProps } from './model.ts';
import './scope.css';

/** The field's drawing box, in its own units: 4:3, the plot inset by a margin that holds the ticks. */
const W = 240;
const H = 180;
const M = 8;
const PW = W - 2 * M;
const PH = H - 2 * M;
/** Where a 0–1 speed and brightness land in the box. */
const xOf = (at: number) => M + at * PW;
const yOf = (at: number) => M + (1 - at) * PH;

/** One preset's mark in the field. */
interface Dot {
  key: string;
  x: number;
  y: number;
  fill: string;
}

/** Every measured preset in the library as a dot: speed across, brightness up, tinted by its strongest hue. */
function dotsOf(library: readonly LibraryRow[]): Dot[] {
  const dots: Dot[] = [];
  for (const r of library) {
    if (!r.look) continue;
    const hue = r.look.hues[0];
    dots.push({
      key: r.key,
      x: xOf(scaleOf.speed(r.look.speed ?? 0)),
      y: yOf(scaleOf.brightness(r.look.brightness)),
      fill: hue === undefined ? 'var(--caption)' : `hsl(${Math.round(hue)} 70% 62%)`,
    });
  }
  return dots;
}

/** The ticks along an edge: five, the middle one longer, like a scale's markings. */
const TICKS = [0, 0.25, 0.5, 0.75, 1];

/** "Slow and dark, among 250 presets": the field's one text alternative. */
function fieldLabel(c: Character | null, count: number): string {
  const among = `among ${count} presets`;
  if (!c) return `The library: ${count} presets by speed and brightness`;
  const words = [c.speed.word, c.brightness.word].filter((w): w is string => !!w);
  if (c.unmeasured || !words.length) return `Not drawn yet, ${among}`;
  const said = listed(words);
  return `${said.charAt(0).toUpperCase()}${said.slice(1)}, ${among}`;
}

/**
 * The field: every preset in the library a faint dot by speed (slow to fast,
 * across) and brightness (dark to bright, up), the subject lit with a fine
 * cursor through it and a ring as wide as it is intense. Markings at the edges,
 * no grid or frame. One text alternative for screen readers; the rest is drawing.
 */
function Field({ dots, c }: { dots: Dot[]; c: Character | null }) {
  const lit = c && !c.unmeasured && c.speed.at !== null && c.brightness.at !== null ? { x: xOf(c.speed.at), y: yOf(c.brightness.at) } : null;
  const ring = 5 + (c?.intensity.at ?? 0) * 11;
  const hue = c?.hues[0]?.css ?? 'var(--fg)';
  return (
    <figure className="insp-c-field">
      <span className="insp-c-axis insp-c-axis-top" aria-hidden="true">
        bright
      </span>
      <svg className="insp-c-scope" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={fieldLabel(c, dots.length)}>
        <g className="insp-c-ticks">
          {TICKS.map((t) => (
            <path key={`x${t}`} d={`M${xOf(t)} ${H} v${t === 0.5 ? -5 : -3}`} />
          ))}
          {TICKS.map((t) => (
            <path key={`y${t}`} d={`M0 ${yOf(t)} h${t === 0.5 ? 5 : 3}`} />
          ))}
          <path className="insp-c-centre" d={`M${xOf(0.5) - 2.5} ${yOf(0.5)} h5 M${xOf(0.5)} ${yOf(0.5) - 2.5} v5`} />
        </g>
        <g className="insp-c-dots" data-dim={lit ? '' : undefined}>
          {dots.map((d) => (
            <circle key={d.key} cx={d.x} cy={d.y} r={1.35} fill={d.fill} />
          ))}
        </g>
        {lit && (
          <g className="insp-c-lit" style={{ color: hue }}>
            <path className="insp-c-cursor" d={`M${lit.x} ${M - 4} V${H - M + 4} M${M - 4} ${lit.y} H${W - M + 4}`} />
            <path className="insp-c-cursor-tick" d={`M${lit.x} ${H} v-6 M0 ${lit.y} h6`} />
            <circle className="insp-c-ring" cx={lit.x} cy={lit.y} r={ring} />
            <circle className="insp-c-glow" cx={lit.x} cy={lit.y} r={4.5} />
            <circle className="insp-c-point" cx={lit.x} cy={lit.y} r={2.6} />
          </g>
        )}
      </svg>
      <span className="insp-c-axis insp-c-axis-low" aria-hidden="true">
        dark
      </span>
      <span className="insp-c-axis insp-c-axis-x" aria-hidden="true">
        <span>slow</span>
        <span>fast</span>
      </span>
    </figure>
  );
}

/** A small pencil, drawn as the layout's icons are (16-unit box, 1.5 stroke), for "edit". */
function EditGlyph() {
  return (
    <svg
      className="lay-icon"
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M10.25 3.25 12.75 5.75 6 12.5 3 13 3.5 10Z M8.75 4.75 11.25 7.25" />
    </svg>
  );
}

/** A ring with a bar through it, for "never play". */
function NeverGlyph() {
  return (
    <svg className="lay-icon" width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="5.75" />
      <path d="M4 12 12 4" />
    </svg>
  );
}

/**
 * Option C, Scope: the preset placed among the library, as an instrument's XY
 * display would: the field first, then the name large, its authors, its
 * measures read out as one line of words, its colours as dots, my tags, the
 * playlists holding it and its actions as a row of keys. With nothing playing
 * the field still draws the library, and it says so; no action shows.
 */
export function InspectorScope(props: InspectorProps) {
  const { subject: p, picked, from, playlists, library, onSet, onAddTo, onBack, onPlay, onEdit } = props;
  const dots = useMemo(() => dotsOf(library ?? []), [library]);
  const c = p ? characterOf(p) : null;
  const readout = c ? [c.speed.word, c.brightness.word, c.intensity.word].filter((w): w is string => !!w) : [];
  const colours = c ? colourNames(c) : [];
  const inLists = p ? holding(p, playlists) : null;
  return (
    <div className="insp-c" data-none={p ? undefined : ''}>
      {picked && (
        <div className="insp-c-top">
          <BackAction className="insp-c-back" onBack={onBack} />
        </div>
      )}
      <Field dots={dots} c={c} />
      {!p || !c ? (
        <div className="insp-c-none">
          <p className="insp-c-none-title">Nothing playing yet</p>
          <p className="insp-c-quiet">Each dot is a preset, by how fast it moves and how bright it is. Play one and it lights up here.</p>
        </div>
      ) : (
        <>
          <div className="insp-c-head">
            <p className="insp-c-kicker">
              {picked ? 'Picked' : 'Now playing'}
              {c.style && (
                <>
                  <span className="insp-c-sep" aria-hidden="true" />
                  {c.subStyle ? `${c.style}, ${c.subStyle}` : c.style}
                </>
              )}
            </p>
            <h2 className="insp-c-name" title={c.name}>
              {c.name}
            </h2>
            {c.by && <p className="insp-c-by">{c.by}</p>}
            {from && <p className="insp-c-from">{from}</p>}
          </div>

          <div className="insp-c-read">
            {c.unmeasured ? (
              <p className="insp-c-quiet">Not drawn yet</p>
            ) : (
              <p className="insp-c-words">
                {readout.map((w, i) => (
                  <span key={w + i}>
                    {i > 0 && <span className="insp-c-sep" aria-hidden="true" />}
                    {w}
                  </span>
                ))}
              </p>
            )}
            {(c.hues.length > 0 || c.grey) && (
              <p className="insp-c-hues">
                <span className="insp-c-swatches" aria-hidden="true">
                  {c.hues.length ? c.hues.map((h, i) => <span key={i} className="insp-c-swatch" style={{ background: h.css }} />) : <span className="insp-c-swatch" data-grey="" />}
                </span>
                <span>{colours.length ? listed(colours) : 'grey'}</span>
              </p>
            )}
          </div>

          <div className="insp-c-keys">
            {picked && (
              <PlayAction className="insp-c-key" onPlay={onPlay}>
                <span aria-hidden="true">Play</span>
              </PlayAction>
            )}
            <StarAction className="insp-c-key" p={p} onSet={onSet}>
              <span aria-hidden="true">{p.star ? 'Starred' : 'Star'}</span>
            </StarAction>
            <AddAction className="insp-c-key" p={p} playlists={playlists} onAddTo={onAddTo}>
              <span aria-hidden="true">Add</span>
            </AddAction>
            <NeverAction className="insp-c-key" p={p} onSet={onSet}>
              <NeverGlyph />
              <span aria-hidden="true">Never</span>
            </NeverAction>
            <EditAction className="insp-c-key" onEdit={onEdit}>
              <EditGlyph />
              <span aria-hidden="true">Edit</span>
            </EditAction>
          </div>

          <div className="insp-c-mine">
            <TagsAction className="insp-c-tags" p={p} onSet={onSet} />
            {inLists && <p className="insp-c-quiet insp-c-in">{inLists.length ? `In ${listed(inLists)}` : 'In no playlist yet'}</p>}
          </div>
        </>
      )}
    </div>
  );
}
