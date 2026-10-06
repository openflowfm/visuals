import type { Preset, Problem } from './api.ts';

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
  /** Whether the stage's numbers live in `values` (top level) or a wave/shape slot. */
  values?: 'base' | `waves.${number}` | `shapes.${number}`;
  /** Which top-level values this stage shows, when `values` is `base`. */
  keys?: RegExp;
  /** A wave or shape slot, which can be off. */
  slot?: { list: 'waves' | 'shapes'; index: number };
}

export interface Cord {
  from: string;
  to: string;
  kind?: string;
}

const COL = 270;
const ROW = 92;

/** Which top-level settings belong to which stage, by the names `.milk` files use. */
const KEYS: Record<string, RegExp> = {
  wave: /^(nwavemode|badditivewaves|bwavedots|bwavethick|bmodwavealphabyvolume|bmaximizewavecolor|fwave|fmodwavealpha|wave_|modwavealpha)/i,
  motion: /^(nmotionvectors|mv_)/i,
  border: /^(ob_|ib_)/i,
  vertex: /^(zoom|rot|warp|cx|cy|dx|dy|sx|sy|fwarpanimspeed|fwarpscale|fzoomexponent)$/i,
  feedback: /^(fdecay|btexwrap|bdarkencenter)$/i,
  blur: /^b[123][nx]$/i,
  comp: /^(fvideoecho|nvideoechoorientation|fgammaadj|bbrighten|bdarken$|bsolarize|binvert|fshader|bredbluestereo)/i,
};

const claimed = (key: string) => Object.values(KEYS).some((r) => r.test(key));

export const STAGES: Stage[] = [
  { id: 'audio', label: 'audio in', kind: 'source', x: 0, y: ROW * 1, inlets: [], outlets: ['bass/mid/treb'], code: [] },
  { id: 'init', label: 'per-frame init', kind: 'equations', x: COL, y: 0, inlets: [], outlets: ['q'], code: [{ field: 'init', label: 'per_frame_init', lang: 'eel' }] },
  {
    id: 'frame',
    label: 'per-frame',
    kind: 'equations',
    x: COL,
    y: ROW * 1.6,
    inlets: ['audio', 'q'],
    outlets: ['q', 'vars'],
    code: [{ field: 'frame', label: 'per_frame', lang: 'eel' }],
    values: 'base',
    keys: { test: (k: string) => !claimed(k) } as RegExp,
  },
  ...[0, 1, 2, 3].map(
    (i): Stage => ({
      id: `wave${i}`,
      label: `custom wave ${i + 1}`,
      kind: 'picture',
      x: COL * 2,
      y: ROW * (i + 2.4),
      inlets: ['q'],
      outlets: ['draw'],
      code: [
        { field: `waves.${i}.init`, label: 'init', lang: 'eel' },
        { field: `waves.${i}.frame`, label: 'per_frame', lang: 'eel' },
        { field: `waves.${i}.point`, label: 'per_point', lang: 'eel' },
      ],
      values: `waves.${i}`,
      slot: { list: 'waves', index: i },
    }),
  ),
  ...[0, 1, 2, 3].map(
    (i): Stage => ({
      id: `shape${i}`,
      label: `custom shape ${i + 1}`,
      kind: 'picture',
      x: COL * 2,
      y: ROW * (i + 6.4),
      inlets: ['q'],
      outlets: ['draw'],
      code: [
        { field: `shapes.${i}.init`, label: 'init', lang: 'eel' },
        { field: `shapes.${i}.frame`, label: 'per_frame', lang: 'eel' },
      ],
      values: `shapes.${i}`,
      slot: { list: 'shapes', index: i },
    }),
  ),
  { id: 'vertex', label: 'warp mesh', kind: 'equations', x: COL * 2, y: 0, inlets: ['vars'], outlets: ['uv'], code: [{ field: 'vertex', label: 'per_vertex', lang: 'eel' }], values: 'base', keys: KEYS.vertex },
  { id: 'wave', label: 'waveform', kind: 'picture', x: COL * 2, y: ROW * 1.2, inlets: ['vars'], outlets: ['draw'], code: [], values: 'base', keys: KEYS.wave },
  { id: 'motion', label: 'motion vectors', kind: 'picture', x: COL * 2, y: ROW * 10.4, inlets: ['vars'], outlets: ['draw'], code: [], values: 'base', keys: KEYS.motion },
  { id: 'border', label: 'borders', kind: 'picture', x: COL * 2, y: ROW * 11.4, inlets: ['vars'], outlets: ['draw'], code: [], values: 'base', keys: KEYS.border },
  { id: 'warp', label: 'warp shader', kind: 'shader', x: COL * 3, y: 0, inlets: ['uv', 'q', 'last frame'], outlets: ['picture'], code: [{ field: 'warp', label: 'warp', lang: 'hlsl' }] },
  { id: 'feedback', label: 'feedback', kind: 'picture', x: COL * 4, y: ROW * 1.5, inlets: ['picture', 'draw'], outlets: ['frame'], code: [], values: 'base', keys: KEYS.feedback },
  { id: 'blur', label: 'blur', kind: 'picture', x: COL * 5, y: ROW * 3, inlets: ['frame'], outlets: ['blur1-3'], code: [], values: 'base', keys: KEYS.blur },
  { id: 'comp', label: 'comp shader', kind: 'shader', x: COL * 6, y: ROW * 1.5, inlets: ['frame', 'blur', 'q'], outlets: ['picture'], code: [{ field: 'comp', label: 'comp', lang: 'hlsl' }], values: 'base', keys: KEYS.comp },
  { id: 'out', label: 'out', kind: 'out', x: COL * 7, y: ROW * 1.5, inlets: ['picture'], outlets: [], code: [] },
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
    c('warp', 'picture', 'feedback', 'picture', 'picture'),
    c('feedback', 'frame', 'warp', 'last frame', 'picture'),
    c('feedback', 'frame', 'blur', 'frame', 'picture'),
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

/** The numbers a stage shows, by the name the file uses. */
export function valuesOf(p: Preset, s: Stage): [string, number][] {
  if (!s.values) return [];
  if (s.values === 'base') return Object.entries(p.values).filter(([k]) => s.keys?.test(k));
  const [list, i] = s.values.split('.') as ['waves' | 'shapes', string];
  return Object.entries(p[list][Number(i)].values);
}

export function setValue(p: Preset, s: Stage, key: string, value: number): Preset {
  if (s.values === 'base') return setField(p, 'values', { ...p.values, [key]: value });
  const [list, i] = s.values!.split('.') as ['waves' | 'shapes', string];
  return setField(p, `${list}.${i}.values`, { ...p[list][Number(i)].values, [key]: value });
}

/** Whether a stage does anything in this preset. */
export function isOn(p: Preset, s: Stage): boolean {
  if (s.slot) return (p[s.slot.list][s.slot.index].values.enabled ?? 0) !== 0;
  if (s.id === 'motion') return (p.values.bMotionVectorsOn ?? 1) !== 0 && valuesOf(p, s).some(([k, v]) => /^mv_a$/i.test(k) && v > 0);
  if (s.id === 'warp' || s.id === 'comp') return p[s.id].trim() !== '';
  return true;
}

/** The problems that belong to a stage. */
export function problemsOf(problems: Problem[], s: Stage): Problem[] {
  return problems.filter((p) => p.stage === s.id || p.stage.split('.')[0] === s.id);
}

/** Code lines in a stage, for its face. */
export function linesOf(p: Preset, s: Stage): number {
  return s.code.reduce((n, c) => n + getField(p, c.field).split('\n').filter((l) => l.trim()).length, 0);
}
