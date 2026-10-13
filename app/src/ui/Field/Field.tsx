import { useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Layer } from '@satoramoto/zen';
import { Text, type TextProps } from '@satoramoto/zen';
import type { LibraryRow, Mine } from '../model/api';
import { bandColour, bandPaths, dotOf, dotsOf, H, M, nearest, step, timesOf, tunedPath, tunedSays, W, xOf, yOf, type Direction, type Dot } from '../model/field';
import { tileBy, tileName } from '../PresetTile/PresetTile';
import './Field.css';

export interface FieldProps {
  /** The library's rows: every measured one is a dot. */
  library: readonly LibraryRow[];
  /** The user's data by key: speed and brightness overrides move a dot, and so does its own speed (`tune.speed`), which marks it too. */
  mine?: Readonly<Record<string, Mine>>;
  /** The preset playing (lit), or null: the only one the field marks, whatever a panel beside it is about. */
  playing: string | null;
  /** How intense the preset playing is, 0–1: its ring's width; null when unmeasured. */
  intensity: number | null;
  /** The playing preset's hue, a CSS colour, for its marks. */
  hue: string;
  /** What the field says about the preset playing ("Slow and dark, among 250 presets"), or the library with none. */
  description: string;
  /** A dot picked, by click or Enter: the caller plays it (the field is a way through the library, not a second selection). */
  onPick(row: LibraryRow): void;
}

/** The ticks along an edge: five, the middle one longer, like a scale's markings. */
const TICKS = [0, 0.25, 0.5, 0.75, 1];
/** How near the pointer, in the box's units (about a px each in the panel), a dot must be to be the one under it. */
const REACH = 6;
const ARROWS: Record<string, Direction> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

/** A dot's name, as the tip and a screen reader say it. */
const nameOf = (row: LibraryRow) => tileName(row.title, row.path);

/**
 * **Job.** The field: every preset in the library a faint dot by speed (slow to fast, across)
 * and brightness (dark to bright, up), the preset playing lit with a fine cursor through it and a
 * ring as wide as it is intense. Markings at the edges, no grid or frame. The dots are one SVG
 * path per hue band, so the full pack's ~9,800 draw as a dozen nodes. It is the quick way
 * through the whole library: the pointer finds the dot nearest it, hover names it, a click plays
 * it. From the keyboard the field is one stop, a listbox whose one rendered option is the dot
 * under its cursor: the arrows move the cursor to the nearest dot that way, Enter (or Space)
 * plays it, and the cursor starts on the preset playing. Its name shows in the same tip as
 * hover's. Mount it in `LibraryMap`, the inspector region's section for it.
 *
 * **Changed.** A dot picked plays (`onPick`; the Home plays it as a library tile's play does), so
 * the lit dot is always the one playing: the field no longer follows what a panel beside it is
 * about (it has no `subject`, and no second mark for a preset playing while another is shown),
 * and its words say "Enter plays one". The tip is a `Layer level="float"` (it floats over the field, so it takes the
 * float's glass, edge and cast instead of a raised tint and a hand-made shadow) whose element is a
 * caption `Text`; the edges' words are `Text`s in capitals on a tight line. The markings'
 * hairline is the ink at a fifth rather than a literal white, so it follows the palette. Classes
 * are `vs-field-*`.
 *
 * **Kept.** Its other props, the drawing (box, ticks, dots, ring, cursor), hover's tip,
 * the arrows' cursor, the roles and names.
 *
 * **Tuning knobs**
 * - `--vs-field-hair`: the markings' hairline colour.
 * - `--vs-field-at`: the tip's place across, 0–1 (set inline from the dot).
 * - `--vs-field-tip-width`: the tip's widest.
 */
export function Field({ library, mine, playing, intensity, hue, description, onPick }: FieldProps) {
  const dots = useMemo(() => dotsOf(library, mine), [library, mine]);
  const paths = useMemo(() => bandPaths(dots), [dots]);
  const tuned = useMemo(() => tunedPath(dots), [dots]);
  const [hover, setHover] = useState(-1);
  // The keyboard's cursor, by key, so it stays on its preset if the library changes under it.
  const [cursorKey, setCursorKey] = useState<string | null>(null);
  const cursor = dotOf(dots, cursorKey);
  const setCursor = (i: number) => setCursorKey(dots[i]?.row.key ?? null);
  const id = useId();

  const lit = dotOf(dots, playing);
  const start = () => (lit >= 0 ? lit : nearest(dots, xOf(0.5), yOf(0.5), Infinity));

  /** Where the pointer is, in the box's units: the svg keeps the box's 4:3, so its rectangle maps straight on. */
  const at = (ev: MouseEvent<SVGSVGElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    if (!r.width || !r.height) return -1;
    return nearest(dots, ((ev.clientX - r.left) / r.width) * W, ((ev.clientY - r.top) / r.height) * H, REACH);
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

  return (
    <figure className="vs-field">
      <Axis className="vs-field-axis-top">bright</Axis>
      <div
        className="vs-field-plot"
        role="listbox"
        tabIndex={0}
        aria-label="The library by speed and brightness"
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
              <path key={`x${t}`} d={`M${xOf(t)} ${H} v${t === 0.5 ? -5 : -3}`} />
            ))}
            {TICKS.map((t) => (
              <path key={`y${t}`} d={`M0 ${yOf(t)} h${t === 0.5 ? 5 : 3}`} />
            ))}
            <path className="vs-field-centre" d={`M${xOf(0.5) - 2.5} ${yOf(0.5)} h5 M${xOf(0.5)} ${yOf(0.5) - 2.5} v5`} />
          </g>
          <g className="vs-field-dots" data-dim={lit >= 0 ? '' : undefined}>
            {paths.map((p) => (
              <path key={p.band} d={p.d} stroke={bandColour(p.band)} />
            ))}
          </g>
          {tuned && <path className="vs-field-tuned" d={tuned} />}
          {lit >= 0 && <Lit dot={dots[lit]} ring={ring} hue={hue} />}
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
          <span className="vs-field-sr" role="option" id={optionId} aria-selected={active.row.key === playing} aria-setsize={dots.length} aria-posinset={cursor + 1}>
            {optionName(active, playing)}
          </span>
        )}
      </div>
      <span className="vs-field-sr" id={`${id}-says`}>
        {description}.{lit >= 0 && dots[lit].tuned ? ` ${tunedSays(dots[lit])}.` : ''} Arrow keys move among the presets; Enter plays one.
      </span>
      <Axis className="vs-field-axis-low">dark</Axis>
      <Axis className="vs-field-axis-x">
        <span>slow</span>
        <span>fast</span>
      </Axis>
    </figure>
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
function Lit({ dot: { x, y }, ring, hue }: { dot: Dot; ring: number; hue: string }) {
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
