import type { Owner, Preset, Problem } from './api.ts';
import { claimed, read, specsOf, spelling, type Spec } from './params.ts';

/**
 * A preset as a graph: one node per stage of MilkDrop's pipeline, holding that
 * stage's code and settings as the file wrote them.
 *
 * The graph is a view of the preset, not a second copy of it. Every edit lands
 * in the `Preset` the engine loads, so what the bench draws is always the file.
 */

export type Code = { field: string; label: string; lang: 'eel' | 'hlsl' };

export interface Stage {
  id: string;
  label: string;
  /** What a node of this kind is, for colour. */
  kind: 'source' | 'equations' | 'picture' | 'shader' | 'out';
  x: number;
  y: number;
  inlets: string[];
  outlets: string[];
  /** Code blocks: `field` is the preset field (`init`, `waves.2.point`…). */
  code: Code[];
  /** Whose values this stage's settings are. */
  owner?: Owner;
  /** Which of the engine's stage pictures this node shows (`PREVIEWS` order). */
  picture?: number;
}

export interface Cord {
  from: string;
  to: string;
  kind?: string;
}

/** Column pitch: a face is 216 wide. The picture chain runs along the top row so it
 * is on screen when a preset opens; what draws into the feedback stacks below it,
 * custom waves under the warp mesh and the rest under the waveform. */
const COL = 240;
const DRAWN = 330;
const BASE: Owner = { list: 'base' };

export const STAGES: Stage[] = [
  { id: 'audio', label: 'audio in', kind: 'source', x: 0, y: 0, inlets: [], outlets: ['bass/mid/treb'], code: [] },
  { id: 'init', label: 'per-frame init', kind: 'equations', x: 0, y: 90, inlets: [], outlets: ['q'], code: [{ field: 'init', label: 'per_frame_init', lang: 'eel' }] },
  { id: 'frame', label: 'per-frame', kind: 'equations', x: 0, y: 250, inlets: ['audio', 'q'], outlets: ['q', 'vars'], code: [{ field: 'frame', label: 'per_frame', lang: 'eel' }], owner: BASE },
  { id: 'vertex', label: 'warp mesh', kind: 'equations', x: COL, y: 0, inlets: ['vars'], outlets: ['uv'], code: [{ field: 'vertex', label: 'per_vertex', lang: 'eel' }], owner: BASE },
  { id: 'wave', label: 'waveform', kind: 'picture', x: COL * 2, y: DRAWN, inlets: ['vars'], outlets: ['draw'], code: [], owner: BASE, picture: 12 },
  ...[0, 1, 2, 3].map(
    (i): Stage => ({
      id: `wave${i}`,
      label: `custom wave ${i + 1}`,
      kind: 'picture',
      x: COL,
      y: DRAWN + 90 + i * 430,
      inlets: ['q'],
      outlets: ['draw'],
      code: [
        { field: `waves.${i}.init`, label: 'init', lang: 'eel' },
        { field: `waves.${i}.frame`, label: 'per_frame', lang: 'eel' },
        { field: `waves.${i}.point`, label: 'per_point', lang: 'eel' },
      ],
      owner: { list: 'waves', index: i },
      picture: 4 + i,
    }),
  ),
  ...[0, 1, 2, 3].map(
    (i): Stage => ({
      id: `shape${i}`,
      label: `custom shape ${i + 1}`,
      kind: 'picture',
      x: COL * 2,
      y: DRAWN + 520 + i * 440,
      inlets: ['q'],
      outlets: ['draw'],
      code: [
        { field: `shapes.${i}.init`, label: 'init', lang: 'eel' },
        { field: `shapes.${i}.frame`, label: 'per_frame', lang: 'eel' },
      ],
      owner: { list: 'shapes', index: i },
      picture: 8 + i,
    }),
  ),
  { id: 'motion', label: 'motion vectors', kind: 'picture', x: COL * 2, y: DRAWN + 2280, inlets: ['vars'], outlets: ['draw'], code: [], owner: BASE, picture: 13 },
  { id: 'border', label: 'borders', kind: 'picture', x: COL * 2, y: DRAWN + 2640, inlets: ['vars'], outlets: ['draw'], code: [], owner: BASE, picture: 14 },
  { id: 'warp', label: 'warp shader', kind: 'shader', x: COL * 2, y: 0, inlets: ['uv', 'q', 'last frame'], outlets: ['picture'], code: [{ field: 'warp', label: 'warp', lang: 'hlsl' }], picture: 0 },
  { id: 'blur', label: 'blur', kind: 'picture', x: COL * 3, y: 0, inlets: ['picture'], outlets: ['blur1-3'], code: [], owner: BASE, picture: 2 },
  { id: 'feedback', label: 'feedback', kind: 'picture', x: COL * 3, y: DRAWN + 120, inlets: ['picture', 'draw'], outlets: ['frame'], code: [], owner: BASE, picture: 1 },
  { id: 'comp', label: 'comp shader', kind: 'shader', x: COL * 4, y: 0, inlets: ['frame', 'blur', 'q'], outlets: ['picture'], code: [{ field: 'comp', label: 'comp', lang: 'hlsl' }], owner: BASE, picture: 3 },
  { id: 'out', label: 'out', kind: 'out', x: COL * 5, y: 0, inlets: ['picture'], outlets: [], code: [], picture: 3 },
];

export const port = (stage: string, name: string) => `${stage}:${name}`;

export function cords(): Cord[] {
  const c = (a: string, ao: string, b: string, bi: string, kind?: string): Cord => ({ from: port(a, ao), to: port(b, bi), kind });
  const out: Cord[] = [
    c('audio', 'bass/mid/treb', 'frame', 'audio', 'audio'),
    c('init', 'q', 'frame', 'q', 'q'),
    c('frame', 'vars', 'vertex', 'vars'),
    c('frame', 'vars', 'wave', 'vars'),
    c('frame', 'vars', 'motion', 'vars'),
    c('frame', 'vars', 'border', 'vars'),
    c('frame', 'q', 'warp', 'q', 'q'),
    c('frame', 'q', 'comp', 'q', 'q'),
    c('vertex', 'uv', 'warp', 'uv'),
    c('warp', 'picture', 'blur', 'picture', 'picture'),
    c('warp', 'picture', 'feedback', 'picture', 'picture'),
    c('feedback', 'frame', 'warp', 'last frame', 'picture'),
    c('feedback', 'frame', 'comp', 'frame', 'picture'),
    c('blur', 'blur1-3', 'comp', 'blur', 'picture'),
    c('comp', 'picture', 'out', 'picture', 'picture'),
    c('wave', 'draw', 'feedback', 'draw', 'draw'),
    c('motion', 'draw', 'feedback', 'draw', 'draw'),
    c('border', 'draw', 'feedback', 'draw', 'draw'),
  ];
  for (const i of [0, 1, 2, 3]) {
    out.push(c('frame', 'q', `wave${i}`, 'q', 'q'), c(`wave${i}`, 'draw', 'feedback', 'draw', 'draw'));
    out.push(c('frame', 'q', `shape${i}`, 'q', 'q'), c(`shape${i}`, 'draw', 'feedback', 'draw', 'draw'));
  }
  return out;
}

/** Read a field by its dotted path (`waves.2.point`). */
export function getField(p: Preset, field: string): string {
  return field.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], p) as string;
}

/** A copy of `p` with one field replaced. */
export function setField(p: Preset, field: string, value: unknown): Preset {
  const next = structuredClone(p);
  const path = field.split('.');
  const last = path.pop()!;
  const at = path.reduce<Record<string, unknown>>((o, k) => o[k] as Record<string, unknown>, next as unknown as Record<string, unknown>);
  at[last] = value;
  return next;
}

/** The values object an owner's settings live in. */
export function valuesFor(p: Preset, owner: Owner): Record<string, number> {
  return owner.list === 'base' ? p.values : p[owner.list][owner.index].values;
}

/** A copy of `p` with one setting changed; returns the key as written. */
export function setValue(p: Preset, owner: Owner, key: string, value: number): [Preset, string] {
  const values = valuesFor(p, owner);
  const k = spelling(values, key);
  const field = owner.list === 'base' ? 'values' : `${owner.list}.${owner.index}.values`;
  return [setField(p, field, { ...values, [k]: value }), k];
}

/** A stage's settings, with their current values. */
export function settingsOf(p: Preset, s: Stage): [Spec, number][] {
  if (!s.owner) return [];
  const values = valuesFor(p, s.owner);
  return specsOf(s.id).map((spec) => [spec, read(values, spec)]);
}

/** The file's values no stage claims — version numbers and the like — shown on per-frame. */
export function otherValues(p: Preset): [string, number][] {
  return Object.entries(p.values).filter(([k]) => !claimed.has(k.toLowerCase()));
}

/** Whether a stage does anything in this preset. */
export function isOn(p: Preset, s: Stage): boolean {
  if (s.owner && s.owner.list !== 'base') return (valuesFor(p, s.owner).enabled ?? 0) !== 0;
  return true;
}

/** Whether either shader reads a blur, which is when the engine draws one
 * (`Renderer::load`, Butterchurn's `getHighestBlur`). */
export function usesBlur(p: Preset): boolean {
  return /blur[123]|GetBlur[123]/.test(p.warp + p.comp);
}

/** The problems that belong to a stage. */
export function problemsOf(problems: Problem[], s: Stage): Problem[] {
  return problems.filter((p) => p.stage === s.id || p.stage.split('.')[0] === s.id);
}

/** The first lines of a stage's code, for its face. */
export function codeLines(p: Preset, s: Stage, n: number): string[] {
  const lines = s.code.flatMap((c) => getField(p, c.field).split('\n').map((l) => l.trim()).filter(Boolean));
  return lines.length > n ? [...lines.slice(0, n - 1), `… ${lines.length - n + 1} more`] : lines;
}
