import { useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { LibraryRow, Mine } from '../../api.ts';
import { tileBy, tileName } from '../../PresetTile.tsx';
import { bandColour, bandPaths, dotOf, dotsOf, H, M, marksPath, nearest, step, timesOf, tunedPath, tunedSays, W, xOf, yOf, type Direction, type Dot } from './field.ts';
import './field.css';

export interface FieldProps {
  /** The library's rows: every measured one is a dot. */
  library: readonly LibraryRow[];
  /** The user's data by key: speed and brightness overrides move a dot, and so does its own speed (`tune.speed`), which marks it too. */
  mine?: Readonly<Record<string, Mine>>;
  /** The preset the panel shows (lit), or null. */
  subject: string | null;
  /** The preset playing: marked too while another one is shown. */
  playing: string | null;
  /** How intense the subject is, 0–1: its ring's width; null when unmeasured. */
  intensity: number | null;
  /** The subject's hue, a CSS colour, for its marks. */
  hue: string;
  /** What the field says about the subject ("Slow and dark, among 250 presets"). */
  description: string;
  /** Several presets picked together, by key: each gets a small ring in the accent (no lit cursor: pass `subject` null with them). */
  marked?: readonly string[];
  /** A dot picked, by click or Enter. */
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
 * The field: every preset in the library a faint dot by speed (slow to fast,
 * across) and brightness (dark to bright, up), the subject lit with a fine
 * cursor through it and a ring as wide as it is intense, the preset playing
 * marked with a ring of its own while another is shown. With several picked
 * (`marked`) there is no lit subject: each pick gets a small ring in the
 * accent, all drawn as one path. Markings at the edges, no grid or frame; the
 * edges' words are the inspector's character words (slow, fast; dark, bright).
 *
 * The dots are one SVG path per hue band, so the full pack's ~9,800 draw as a
 * dozen nodes. The pointer finds the dot nearest it: hover names it, a click
 * picks it. From the keyboard the field is one stop, a listbox whose one
 * rendered option is the dot under its cursor: the arrows move the cursor to
 * the nearest dot that way, Enter (or Space) picks it, and the cursor starts
 * on the subject. Its name shows in the same tip as hover's.
 */
export function Field({ library, mine, subject, playing, intensity, hue, description, marked, onPick }: FieldProps) {
  const dots = useMemo(() => dotsOf(library, mine), [library, mine]);
  const paths = useMemo(() => bandPaths(dots), [dots]);
  const tuned = useMemo(() => tunedPath(dots), [dots]);
  const marks = useMemo(() => (marked?.length ? marksPath(dots, marked) : ''), [dots, marked]);
  // The first marked pick with a dot: where the keyboard's cursor starts with several picked (worked out only when it is needed).
  const markedFirst = () => {
    const want = new Set(marked);
    return want.size ? dots.findIndex((d) => want.has(d.row.key)) : -1;
  };
  const [hover, setHover] = useState(-1);
  // The keyboard's cursor, by key, so it stays on its preset if the library changes under it.
  const [cursorKey, setCursorKey] = useState<string | null>(null);
  const cursor = dotOf(dots, cursorKey);
  const setCursor = (i: number) => setCursorKey(dots[i]?.row.key ?? null);
  const id = useId();

  const lit = dotOf(dots, subject);
  const mark = playing && playing !== subject ? dotOf(dots, playing) : -1;
  const start = () => {
    if (lit >= 0) return lit;
    const first = markedFirst();
    return first >= 0 ? first : mark >= 0 ? mark : nearest(dots, xOf(0.5), yOf(0.5), Infinity);
  };

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
    <figure className="insp-field">
      <span className="insp-field-axis insp-field-axis-top" aria-hidden="true">
        bright
      </span>
      <div
        className="insp-field-plot"
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
          className="insp-field-scope"
          viewBox={`0 0 ${W} ${H}`}
          aria-hidden="true"
          data-hot={hover >= 0 ? '' : undefined}
          onPointerMove={(ev) => setHover(at(ev))}
          onPointerLeave={() => setHover(-1)}
          onClick={(ev) => pick(at(ev))}
        >
          <g className="insp-field-ticks">
            {TICKS.map((t) => (
              <path key={`x${t}`} d={`M${xOf(t)} ${H} v${t === 0.5 ? -5 : -3}`} />
            ))}
            {TICKS.map((t) => (
              <path key={`y${t}`} d={`M0 ${yOf(t)} h${t === 0.5 ? 5 : 3}`} />
            ))}
            <path className="insp-field-centre" d={`M${xOf(0.5) - 2.5} ${yOf(0.5)} h5 M${xOf(0.5)} ${yOf(0.5) - 2.5} v5`} />
          </g>
          <g className="insp-field-dots" data-dim={lit >= 0 || marks ? '' : undefined}>
            {paths.map((p) => (
              <path key={p.band} d={p.d} stroke={bandColour(p.band)} />
            ))}
          </g>
          {tuned && <path className="insp-field-tuned" d={tuned} />}
          {marks && <path className="insp-field-marked" d={marks} data-count={marked?.length} />}
          {mark >= 0 && <PlayingMark dot={dots[mark]} />}
          {lit >= 0 && <Lit dot={dots[lit]} ring={ring} hue={hue} />}
          {tip && <circle className="insp-field-hot" cx={tip.x} cy={tip.y} r={4} />}
        </svg>
        {tip && (
          <span className="insp-field-tip" aria-hidden="true" style={{ left: `${(tip.x / W) * 100}%`, top: `${(tip.y / H) * 100}%`, ['--at' as string]: tip.x / W }}>
            {nameOf(tip.row)}
            {tip.tuned && <span className="insp-field-tip-note"> · {timesOf(tip.tuned.speed)} speed</span>}
            {tip.row.key === playing && <span className="insp-field-tip-note"> · playing</span>}
          </span>
        )}
        {active && (
          <span
            className="insp-field-sr"
            role="option"
            id={optionId}
            aria-selected={active.row.key === subject || !!marked?.includes(active.row.key)}
            aria-setsize={dots.length}
            aria-posinset={cursor + 1}
          >
            {optionName(active, playing)}
          </span>
        )}
      </div>
      <span className="insp-field-sr" id={`${id}-says`}>
        {description}.{lit >= 0 && dots[lit].tuned ? ` ${tunedSays(dots[lit])}.` : ''} Arrow keys move among the presets; Enter shows one.
      </span>
      <span className="insp-field-axis insp-field-axis-low" aria-hidden="true">
        dark
      </span>
      <span className="insp-field-axis insp-field-axis-x" aria-hidden="true">
        <span>slow</span>
        <span>fast</span>
      </span>
    </figure>
  );
}

/** "Spiral, by geiss, at 0.5× speed, playing": an option's name. */
function optionName(d: Dot, playing: string | null): string {
  const by = tileBy(d.row.authors, '');
  return `${nameOf(d.row)}${by ? `, by ${by}` : ''}${d.tuned ? `, at ${timesOf(d.tuned.speed)} speed` : ''}${d.row.key === playing ? ', playing' : ''}`;
}
/** The subject: a fine cursor through it to the edges' ticks, a ring as wide as it is intense, a point in its hue. */
function Lit({ dot: { x, y }, ring, hue }: { dot: Dot; ring: number; hue: string }) {
  return (
    <g className="insp-field-lit" style={{ color: hue }}>
      <path className="insp-field-cursor" d={`M${x} ${M - 4} V${H - M + 4} M${M - 4} ${y} H${W - M + 4}`} />
      <path className="insp-field-cursor-tick" d={`M${x} ${H} v-6 M0 ${y} h6`} />
      <circle className="insp-field-ring" cx={x} cy={y} r={ring} />
      <circle className="insp-field-glow" cx={x} cy={y} r={4.5} />
      <circle className="insp-field-point" cx={x} cy={y} r={2.6} />
    </g>
  );
}

/** The preset playing, while another is shown: a quiet ring and a small play mark beside it, so the way back is in sight. */
function PlayingMark({ dot: { x, y } }: { dot: Dot }) {
  return (
    <g className="insp-field-playing">
      <circle cx={x} cy={y} r={3.5} />
      <path d={`M${x + 5.5} ${y - 2.5} l3.5 2.5 l-3.5 2.5Z`} />
    </g>
  );
}
