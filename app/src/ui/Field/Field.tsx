import { useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { AxisPicker, Layer } from '@satoramoto/zen';
import { Text, type TextProps } from '@satoramoto/zen';
import type { LibraryRow, Mine } from '../model/api';
import {
  AXES,
  axisOf,
  bandPaths,
  BOX,
  COLOURINGS,
  DEFAULT_AXES,
  dotOf,
  dotsOf,
  endsOf,
  groupColour,
  M,
  marksPath,
  nearest,
  step,
  stylesOf,
  timesOf,
  trailPoints,
  tunedPath,
  tunedSays,
  withAxis,
  xOf,
  yOf,
  type Box,
  type Direction,
  type Dot,
  type MapAxes,
} from '../model/field';
import { tileBy, tileName } from '../PresetTile/PresetTile';
import './Field.css';

export interface FieldProps {
  /** The library's rows: every measured one is a dot. */
  library: readonly LibraryRow[];
  /** The user's data by key: overrides, ratings and styles move a dot, and so does its own speed (`tune.speed`) on an axis showing speed, which marks it too. */
  mine?: Readonly<Record<string, Mine>>;
  /** What the dots are placed and coloured by; `DEFAULT_AXES` (speed across, brightness up, coloured by hue) when left out. */
  axes?: MapAxes;
  /** A new choice of axes: given, a picker under the plot chooses across and one along its left edge chooses up (picking the axis the other shows swaps them); left out, the edges say the axes' ends. */
  onAxes?(next: MapAxes): void;
  /** Presets played, by path (`LibraryRow.path`), oldest first: a dashed line runs through their dots, older segments fainter. */
  trail?: readonly string[];
  /** The plot's shape, in the box's units (about a CSS px each: `boxOf(w, h)`): its viewBox and aspect follow it; the default 4:3 box (`BOX`, 240 by 180) when left out. */
  shape?: Box;
  /** The listbox's accessible name; "The library by speed and brightness" (the axes, in lower case) when left out. */
  name?: string;
  /** The preset playing (lit), or null: the only one the field marks, whatever a panel beside it is about. */
  playing: string | null;
  /** How intense the preset playing is, 0–1: its ring's width; null when unmeasured. */
  intensity: number | null;
  /** The playing preset's hue, a CSS colour, for its marks. */
  hue: string;
  /** What the field says about the preset playing ("Slow and dark, among 250 presets"), or the library with none. */
  description: string;
  /** Several presets picked together, by key: each one's dot gets a small ring in the accent (none or one: no rings; one with no dot is skipped). The preset playing stays lit as ever. */
  marked?: readonly string[];
  /** A dot picked, by click or Enter: the caller plays it (the field is a way through the library, not a second selection). */
  onPick(row: LibraryRow): void;
}

/** The ticks along an edge: five, the middle one longer, like a scale's markings. */
const TICKS = [0, 0.25, 0.5, 0.75, 1];
/** How near the pointer, in the box's units (about a px each, at any shape), a dot must be to be the one under it. */
const REACH = 6;
const ARROWS: Record<string, Direction> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

/** A dot's name, as the tip and a screen reader say it. */
const nameOf = (row: LibraryRow) => tileName(row.title, row.path);

const AXIS_LABELS = AXES.map((a) => a.label);
const COLOUR_LABELS = COLOURINGS.map((c) => c.label);

/**
 * **Job.** The field: every preset in the library a faint dot by two axes (speed across and
 * brightness up unless `axes` says otherwise: any two of speed, brightness, intensity, hue,
 * colourfulness, my rating and style), coloured by hue, style or rating, the preset playing lit
 * with a fine cursor through it and a ring as wide as it is intense, and, with a `trail`, a dashed
 * line through the presets played, fading with age. Markings at the edges, no grid or frame. With
 * `onAxes`, the edges are pickers: one along the plot's left edge for up and one under it for
 * across, each with its ends' words. The dots are one SVG path per colour group, so the full
 * pack's ~9,800 draw as a dozen nodes. It is the quick way
 * through the whole library: the pointer finds the dot nearest it, hover names it, a click plays
 * it. From the keyboard the field is one stop, a listbox whose one rendered option is the dot
 * under its cursor: the arrows move the cursor to the nearest dot that way, Enter (or Space)
 * plays it, and the cursor starts on the first of several picked, else the preset playing. Its name shows in the same tip as
 * hover's. With several presets picked (`marked`), each one's dot is ringed in the accent, all as
 * one path under the lit dot, and the rest step back as they do for a lit one. Mount it in
 * `LibraryMap`, the inspector region's section for it.
 *
 * **Changed.** The rings round several picked are back (`marked`, `marksPath`), lost in the move
 * to zen. A dot picked plays (`onPick`; the Home plays it as a library tile's play does), so
 * the lit dot is always the one playing: the field no longer follows what a panel beside it is
 * about (it has no `subject`, and no second mark for a preset playing while another is shown),
 * and its words say "Enter plays one". The tip is a `Layer level="float"` (it floats over the field, so it takes the
 * float's glass, edge and cast instead of a raised tint and a hand-made shadow) whose element is a
 * caption `Text`; the edges' words are `Text`s in capitals on a tight line. The markings'
 * hairline is the ink at a fifth rather than a literal white, so it follows the palette. Classes
 * are `vs-field-*`. The axes, the colouring, the trail and the pickers are new (`axes`, `onAxes`,
 * `trail`, `name`; `ColourPicker` for a title row); the edges' words follow the axes. The plot's
 * shape is a choice (`shape`, 4:3 when left out): the dots, the ticks, the lit cursor, the tip and
 * the pointer follow it, and a caller that sizes the svg to another shape (the library's Map view)
 * gets a plot that fills its room. Where the svg's box isn't the shape's, the pointer reads it as
 * the svg draws it (centred, scaled to fit).
 *
 * **Kept.** Its other props, the drawing (default box, ticks, dots, ring, cursor), hover's tip,
 * the arrows' cursor, the roles, and with the default axes its names and words.
 *
 * **Tuning knobs**
 * - `--vs-field-hair`: the markings' hairline colour.
 * - `--vs-field-at`: the tip's place across, 0–1 (set inline from the dot).
 * - `--vs-field-tip-width`: the tip's widest.
 */
export function Field({ library, mine, axes = DEFAULT_AXES, onAxes, trail, shape = BOX, name, playing, intensity, hue, description, marked, onPick }: FieldProps) {
  const { w: W, h: H } = shape;
  const box = useMemo(() => ({ w: W, h: H }), [W, H]);
  const dots = useMemo(() => dotsOf(library, mine, axes, box), [library, mine, axes, box]);
  const paths = useMemo(() => bandPaths(dots), [dots]);
  const tuned = useMemo(() => tunedPath(dots), [dots]);
  const needStyles = axes.colour === 'style' || axes.across === 'style' || axes.up === 'style';
  const styles = useMemo(() => (needStyles ? stylesOf(library, mine) : []), [needStyles, library, mine]);
  const trailAt = useMemo(() => (trail?.length ? trailPoints(dots, trail) : []), [dots, trail]);
  const marks = useMemo(() => marksPath(dots, marked), [dots, marked]);
  const ringed = useMemo(() => new Set(marks ? marked : []), [marks, marked]);
  const across = axisOf(axes.across);
  const up = axisOf(axes.up);
  const acrossEnds = endsOf(axes.across, styles);
  const upEnds = endsOf(axes.up, styles);
  const [hover, setHover] = useState(-1);
  // The keyboard's cursor, by key, so it stays on its preset if the library changes under it.
  const [cursorKey, setCursorKey] = useState<string | null>(null);
  const cursor = dotOf(dots, cursorKey);
  const setCursor = (i: number) => setCursorKey(dots[i]?.row.key ?? null);
  const id = useId();

  const lit = dotOf(dots, playing);
  // With several picked, the cursor starts on the first pick that has a dot; else on the preset playing; else mid-field.
  const firstPick = () => (marks && marked ? (marked.map((k) => dotOf(dots, k)).find((i) => i >= 0) ?? -1) : -1);
  const start = () => {
    const pick = firstPick();
    if (pick >= 0) return pick;
    return lit >= 0 ? lit : nearest(dots, xOf(0.5, box), yOf(0.5, box), Infinity);
  };

  /** Where the pointer is, in the box's units: the svg draws the box scaled to fit and centred (its own aspect, unless a caller sizes it), so this undoes that. */
  const at = (ev: MouseEvent<SVGSVGElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    if (!r.width || !r.height) return -1;
    const s = Math.min(r.width / W, r.height / H);
    const x = (ev.clientX - r.left - (r.width - W * s) / 2) / s;
    const y = (ev.clientY - r.top - (r.height - H * s) / 2) / s;
    return nearest(dots, x, y, REACH);
  };
  const pick = (i: number) => {
    if (dots[i]) onPick(dots[i].row);
  };

  const onKeyDown = (ev: KeyboardEvent<HTMLDivElement>) => {
    const dir = ARROWS[ev.key];
    const enter = ev.key === 'Enter' || ev.key === ' ';
    if (!dir && !enter) return;
    ev.preventDefault();
    const from = cursor >= 0 ? cursor : start();
    if (from < 0) return;
    if (dir) setCursor(cursor >= 0 ? step(dots, from, dir) : from);
    else if (cursor >= 0) pick(cursor);
    else setCursor(from);
  };
  // A focus from the keyboard puts the cursor on the subject; a click's focus leaves it to the pointer.
  const pressed = useRef(false);
  const onFocus = () => {
    if (!pressed.current && cursor < 0) setCursor(start());
    pressed.current = false;
  };

  // The library can shrink under the pointer: a stale index is no dot.
  const shown = hover >= 0 && hover < dots.length ? hover : cursor;
  const tip = dots[shown];
  const active = dots[cursor];
  const optionId = `${id}-dot`;
  const ring = 5 + (intensity ?? 0) * 11;

  const pickAxis = (which: 'across' | 'up') => (i: number) => {
    const next = AXES[i];
    if (next && onAxes) onAxes(withAxis(axes, which, next.id));
  };

  return (
    <figure className="vs-field" data-pickers={onAxes ? '' : undefined}>
      {onAxes ? (
        <AxisPicker className="vs-field-pick-up" orientation="vertical" label="Up" items={AXIS_LABELS} index={AXES.indexOf(up)} low={upEnds.low} high={upEnds.high} onChange={pickAxis('up')} />
      ) : (
        <Axis className="vs-field-axis-top">{upEnds.high}</Axis>
      )}
      <div
        className="vs-field-plot"
        role="listbox"
        tabIndex={0}
        aria-label={name ?? `The library by ${across.label.toLowerCase()} and ${up.label.toLowerCase()}`}
        aria-describedby={`${id}-says`}
        aria-activedescendant={active ? optionId : undefined}
        onKeyDown={onKeyDown}
        onPointerDown={() => (pressed.current = true)}
        onFocus={onFocus}
        onBlur={() => {
          pressed.current = false;
          setCursor(-1);
        }}
      >
        <svg
          className="vs-field-scope"
          viewBox={`0 0 ${W} ${H}`}
          aria-hidden="true"
          data-hot={hover >= 0 ? '' : undefined}
          onPointerMove={(ev) => setHover(at(ev))}
          onPointerLeave={() => setHover(-1)}
          onClick={(ev) => pick(at(ev))}
        >
          <g className="vs-field-ticks">
            {TICKS.map((t) => (
              <path key={`x${t}`} d={`M${xOf(t, box)} ${H} v${t === 0.5 ? -5 : -3}`} />
            ))}
            {TICKS.map((t) => (
              <path key={`y${t}`} d={`M0 ${yOf(t, box)} h${t === 0.5 ? 5 : 3}`} />
            ))}
            <path className="vs-field-centre" d={`M${xOf(0.5, box) - 2.5} ${yOf(0.5, box)} h5 M${xOf(0.5, box)} ${yOf(0.5, box) - 2.5} v5`} />
          </g>
          <g className="vs-field-dots" data-dim={lit >= 0 || marks ? '' : undefined}>
            {paths.map((p) => (
              <path key={p.band} d={p.d} stroke={groupColour(axes.colour, p.band, styles)} />
            ))}
          </g>
          {tuned && <path className="vs-field-tuned" d={tuned} />}
          {trailAt.length > 1 && <Trail points={trailAt} />}
          {marks && <path className="vs-field-marked" d={marks} />}
          {lit >= 0 && <Lit dot={dots[lit]} box={box} ring={ring} hue={hue} />}
          {tip && <circle className="vs-field-hot" cx={tip.x} cy={tip.y} r={4} />}
        </svg>
        {tip && (
          <Layer
            level="float"
            as={TipText}
            className="vs-field-tip"
            aria-hidden="true"
            style={{ left: `${(tip.x / W) * 100}%`, top: `${(tip.y / H) * 100}%`, '--vs-field-at': tip.x / W } as CSSProperties}
          >
            {nameOf(tip.row)}
            {tip.tuned && <span className="vs-field-tip-note"> · {timesOf(tip.tuned.speed)} speed</span>}
            {tip.row.key === playing && <span className="vs-field-tip-note"> · playing</span>}
          </Layer>
        )}
        {active && (
          <span className="vs-field-sr" role="option" id={optionId} aria-selected={active.row.key === playing || ringed.has(active.row.key)} aria-setsize={dots.length} aria-posinset={cursor + 1}>
            {optionName(active, playing)}
          </span>
        )}
      </div>
      <span className="vs-field-sr" id={`${id}-says`}>
        {description}.{lit >= 0 && dots[lit].tuned ? ` ${tunedSays(dots[lit])}.` : ''} Arrow keys move among the presets; Enter plays one.
      </span>
      {onAxes ? (
        <AxisPicker className="vs-field-pick-x" label="Across" items={AXIS_LABELS} index={AXES.indexOf(across)} low={acrossEnds.low} high={acrossEnds.high} onChange={pickAxis('across')} />
      ) : (
        <>
          <Axis className="vs-field-axis-low">{upEnds.low}</Axis>
          <Axis className="vs-field-axis-x">
            <span>{acrossEnds.low}</span>
            <span>{acrossEnds.high}</span>
          </Axis>
        </>
      )}
    </figure>
  );
}

/** The map's colour choice, for its title row: a picker of hue, style or rating, no ends. */
export function ColourPicker({ axes, onAxes }: { axes: MapAxes; onAxes(next: MapAxes): void }) {
  return (
    <AxisPicker
      className="vs-field-pick-colour"
      label="Colour"
      items={COLOUR_LABELS}
      index={Math.max(
        0,
        COLOURINGS.findIndex((c) => c.id === axes.colour),
      )}
      onChange={(i) => {
        const next = COLOURINGS[i];
        if (next && next.id !== axes.colour) onAxes({ ...axes, colour: next.id });
      }}
    />
  );
}

/** The presets played: a dashed line through their dots, each segment fainter the older it is. */
function Trail({ points }: { points: readonly { x: number; y: number }[] }) {
  const n = points.length - 1;
  return (
    <g className="vs-field-trail" aria-hidden="true">
      {points.slice(1).map((p, i) => {
        const a = points[i];
        return <path key={i} d={`M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${p.x.toFixed(1)} ${p.y.toFixed(1)}`} style={{ opacity: 0.15 + (0.75 * (i + 1)) / n }} />;
      })}
    </g>
  );
}

/** An edge's words, engraved: tiny capitals on a tight line (Field.css sets the size, weight and tracking). */
function Axis({ className, children }: { className: string; children: ReactNode }) {
  return (
    <Text leading="tight" case="upper" className={`vs-field-axis ${className}`} aria-hidden="true">
      {children}
    </Text>
  );
}

/** The tip's type: a caption, as the Layer's element (Field.css sets its weight). */
function TipText(props: Omit<TextProps, 'role'>) {
  return <Text {...props} as="span" role="caption" />;
}

/** "Spiral, by geiss, at 0.5× speed, playing": an option's name. */
function optionName(d: Dot, playing: string | null): string {
  const by = tileBy(d.row.authors, '');
  return `${nameOf(d.row)}${by ? `, by ${by}` : ''}${d.tuned ? `, at ${timesOf(d.tuned.speed)} speed` : ''}${d.row.key === playing ? ', playing' : ''}`;
}
/** The preset playing: a fine cursor through it to the edges' ticks, a ring as wide as it is intense, a point in its hue. */
function Lit({ dot: { x, y }, box: { w: W, h: H }, ring, hue }: { dot: Dot; box: Box; ring: number; hue: string }) {
  return (
    <g className="vs-field-lit" style={{ color: hue }}>
      <path className="vs-field-cursor" d={`M${x} ${M - 4} V${H - M + 4} M${M - 4} ${y} H${W - M + 4}`} />
      <path className="vs-field-cursor-tick" d={`M${x} ${H} v-6 M0 ${y} h6`} />
      <circle className="vs-field-ring" cx={x} cy={y} r={ring} />
      <circle className="vs-field-glow" cx={x} cy={y} r={4.5} />
      <circle className="vs-field-point" cx={x} cy={y} r={2.6} />
    </g>
  );
}
