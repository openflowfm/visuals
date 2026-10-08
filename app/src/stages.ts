import type { Owner, Preset, Problem } from './api.ts';
import { PARAMS, claimed, read, specsOf, spelling, type Spec } from './params.ts';

/**
 * A preset as a graph: MilkDrop's fixed pipeline read left to right, with what
 * draws into the feedback stacked as layers beside it.
 *
 *   audio → motion → warp → feedback → composite → screen
 *                            ↑
 *                          layers (waveform, custom waves and shapes, …)
 *
 * The graph is a view of the preset, not a second copy of it. Every edit lands
 * in the `Preset` the engine loads, so what the bench draws is always the file;
 * opening a preset never writes to it, and only adding or removing a layer (or
 * writing a shader) changes its shape.
 */

export type Code = { field: string; label: string; term: string; lang: 'eel' | 'hlsl' };

export interface Stage {
  id: string;
  /** In plain words. */
  label: string;
  /** What MilkDrop calls it, for people who know. */
  term: string;
  /** What a node of this kind is, for colour. */
  kind: 'source' | 'motion' | 'shader' | 'feedback' | 'layer' | 'out';
  /** Code blocks: `field` is the preset field (`init`, `waves.2.point`…). */
  code: Code[];
  /** Whose values this stage's settings are. */
  owner?: Owner;
  /** Which of the engine's stage pictures this node shows (`PREVIEWS` order). */
  picture?: number;
}

/** The preset's own settings, as opposed to a custom wave's or shape's. */
export const BASE: Owner = { list: 'base' };

const eel = (field: string, label: string, term: string): Code => ({ field, label, term, lang: 'eel' });

/** The pipeline every preset has, in the order a frame runs it. */
export const CHAIN: Stage[] = [
  { id: 'audio', label: 'audio', term: 'bass, mid and treble', kind: 'source', code: [] },
  {
    id: 'motion',
    label: 'motion',
    term: 'per-frame and per-vertex equations: zoom, rotate, warp, move, stretch',
    kind: 'motion',
    code: [eel('init', 'once, at the start', 'per_frame_init'), eel('frame', 'every frame', 'per_frame'), eel('vertex', 'every point of the mesh', 'per_vertex')],
    owner: BASE,
  },
  { id: 'warp', label: 'warp', term: 'warp shader: moves the last frame', kind: 'shader', code: [{ field: 'warp', label: 'warp shader', term: 'warp', lang: 'hlsl' }], picture: 0 },
  { id: 'feedback', label: 'feedback', term: 'the frame kept for the next one: decay, wrap, blur', kind: 'feedback', code: [], owner: BASE, picture: 1 },
  { id: 'comp', label: 'composite', term: 'comp shader: the frame as you see it', kind: 'shader', code: [{ field: 'comp', label: 'composite shader', term: 'comp', lang: 'hlsl' }], owner: BASE, picture: 3 },
  { id: 'out', label: 'screen', term: 'output', kind: 'out', code: [] },
];

/** Everything that can draw into the feedback. Only the ones drawing in a preset show. */
export const LAYERS: Stage[] = [
  { id: 'wave', label: 'waveform', term: 'the built-in waveform', kind: 'layer', code: [], owner: BASE, picture: 12 },
  ...[0, 1, 2, 3].map(
    (i): Stage => ({
      id: `wave${i}`,
      label: `custom wave ${i + 1}`,
      term: `wavecode_${i}`,
      kind: 'layer',
      code: [eel(`waves.${i}.init`, 'once, at the start', 'init'), eel(`waves.${i}.frame`, 'every frame', 'per_frame'), eel(`waves.${i}.point`, 'every point', 'per_point')],
      owner: { list: 'waves', index: i },
      picture: 4 + i,
    }),
  ),
  ...[0, 1, 2, 3].map(
    (i): Stage => ({
      id: `shape${i}`,
      label: `custom shape ${i + 1}`,
      term: `shapecode_${i}`,
      kind: 'layer',
      code: [eel(`shapes.${i}.init`, 'once, at the start', 'init'), eel(`shapes.${i}.frame`, 'every frame', 'per_frame')],
      owner: { list: 'shapes', index: i },
      picture: 8 + i,
    }),
  ),
  { id: 'vectors', label: 'motion vectors', term: 'motion vectors', kind: 'layer', code: [], owner: BASE, picture: 13 },
  { id: 'border', label: 'borders', term: 'outer and inner borders', kind: 'layer', code: [], owner: BASE, picture: 14 },
];

export const STAGES: Stage[] = [...CHAIN, ...LAYERS];

/** What the inspector opens on when nothing is selected. */
export const FIRST = 'motion';

// --- reading and writing the preset ------------------------------------------

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

/** A copy of `p` with several settings of one owner changed. */
function setValues(p: Preset, owner: Owner, changes: Record<string, number>): Preset {
  return Object.entries(changes).reduce((q, [k, v]) => setValue(q, owner, k, v)[0], p);
}

/** Whether either shader reads a blur, which is when the engine draws one
 * (`Renderer::load`, Butterchurn's `getHighestBlur`). */
export function usesBlur(p: Preset): boolean {
  return /blur[123]|GetBlur[123]/.test(p.warp + p.comp);
}

/** A stage's settings, with their current values. The blur's ride on feedback,
 * and only when a shader reads it. */
export function settingsOf(p: Preset, s: Stage): [Spec, number][] {
  if (!s.owner) return [];
  const values = valuesFor(p, s.owner);
  const specs = s.id === 'feedback' && usesBlur(p) ? [...specsOf(s.id), ...PARAMS.blur] : specsOf(s.id);
  return specs.map((spec) => [spec, read(values, spec)]);
}

/**
 * The settings of a stage a written shader has baked in, so changing them no
 * longer reaches the picture, and why. MilkDrop applies decay only in its
 * default warp shader, and gamma, echo and the switches only in its default
 * composite: "write my own" writes their values in as numbers.
 */
export function bakedIn(p: Preset, s: Stage): { keys: Set<string>; why: string } | undefined {
  if (s.id === 'feedback' && p.warp.trim() !== '')
    return { keys: new Set(['fDecay']), why: "The warp shader is written, so decay no longer applies: it only reaches the picture through MilkDrop's default warp. Scale ret in the warp shader instead." };
  if (s.id === 'comp' && p.comp.trim() !== '')
    return { keys: new Set(specsOf('comp').map((spec) => spec.key)), why: "The composite shader is written, so these no longer apply: they only reach the picture through MilkDrop's default composite." };
  return undefined;
}

/** The settings worth a word on a node's face: the ones off their default. */
export function summaryOf(p: Preset, s: Stage, n: number): [Spec, number][] {
  return settingsOf(p, s)
    .filter(([spec, v]) => spec.face && Math.abs(v - spec.def) > 1e-6)
    .slice(0, n);
}

/** The file's values no stage claims — version numbers and the like. */
export function otherValues(p: Preset): [string, number][] {
  return Object.entries(p.values).filter(([k]) => !claimed.has(k.toLowerCase()));
}

// --- which layers draw -------------------------------------------------------

const value = (p: Preset, owner: Owner, key: string, def: number) => {
  const values = valuesFor(p, owner);
  return values[spelling(values, key)] ?? def;
};

/** Code with its `//` and `/* *\/` comments taken out (an unclosed block runs to the end). */
export function uncommented(code: string): string {
  return code.replace(/\/\*[\s\S]*?(?:\*\/|(?![\s\S]))|\/\/.*$/gm, ' ');
}

const isZero = (v: string) => /^[-+]?(0+\.?0*|\.0+)$/.test(v);

/** What per-frame code does to a variable: turns it to something (`on`), only
 * ever to zero (`off`), or leaves it to the file (undefined).
 *
 * `x = 0`, `x *= 0` and `x /= 0` (zero in EEL) zero it; `x = …`, `x += …` and
 * `x -= …` with anything but zero turn it to something whatever the file says;
 * `x *= k` and `x /= k` otherwise only scale the file's value, and `x += 0`
 * changes nothing, so those leave it to the file. */
export function codeSets(code: string, name: string): 'on' | 'off' | undefined {
  const effects = [...uncommented(code).matchAll(new RegExp(`\\b${name}\\s*([-+*/]?)=(?!=)([^;]*)`, 'gi'))].map(([, op, rhs]) => {
    const zero = isZero(rhs.trim());
    if (op === '') return zero ? 'off' : 'on';
    if (op === '*' || op === '/') return zero ? 'off' : undefined;
    return zero ? undefined : 'on';
  });
  const set = effects.filter((e) => e !== undefined);
  if (!set.length) return undefined;
  return set.every((e) => e === 'off') ? 'off' : 'on';
}

/** The per-frame variables that turn each built-in layer up or down, with the
 * file keys they start from. */
const DRIVERS: Record<string, [name: string, key: string, def: number][]> = {
  wave: [['wave_a', 'fWaveAlpha', 0.8]],
  vectors: [['mv_a', 'mv_a', 1]],
  border: [['ob_a', 'ob_a', 0], ['ib_a', 'ib_a', 0]],
};

/** The variable this preset's per-frame code turns a built-in layer on with, if any. */
export function drivenBy(p: Preset, s: Stage): string | undefined {
  return DRIVERS[s.id]?.find(([name]) => codeSets(p.frame, name) === 'on')?.[0];
}

/** The variable per-frame code holds a built-in layer off with, if it does. */
export function heldOffBy(p: Preset, s: Stage): string | undefined {
  const drivers = DRIVERS[s.id];
  if (!drivers) return undefined;
  const off = drivers.filter(([name]) => codeSets(p.frame, name) === 'off');
  return off.length === drivers.length ? off[0][0] : undefined;
}

/** Whether a layer draws anything in this preset. */
export function draws(p: Preset, s: Stage): boolean {
  if (s.kind !== 'layer') return true;
  if (s.owner && s.owner.list !== 'base') return value(p, s.owner, 'enabled', 0) !== 0;
  const lit = (name: string, key: string, def: number) => {
    const set = codeSets(p.frame, name);
    return set === 'on' || (set === undefined && value(p, BASE, key, def) > 0);
  };
  if (s.id === 'wave') return lit('wave_a', 'fWaveAlpha', 0.8);
  if (s.id === 'vectors') return lit('mv_a', 'mv_a', 1) && value(p, BASE, 'nMotionVectorsX', 12) >= 1 && value(p, BASE, 'nMotionVectorsY', 9) >= 1;
  if (s.id === 'border') return (value(p, BASE, 'ob_size', 0.01) > 0 && lit('ob_a', 'ob_a', 0)) || (value(p, BASE, 'ib_size', 0.01) > 0 && lit('ib_a', 'ib_a', 0));
  return false;
}

/** The node a problem belongs to: the engine names `init`, `frame`, `vertex`,
 * `wave0.point`, `shape2.frame`, `warp`, `comp`, or `equations` for all of them. */
export function stageOfProblem(stage: string): string {
  const [head] = stage.split('.');
  const list = /^(waves?|shapes?)\.?(\d)/.exec(stage) ?? /^(wave|shape)(\d)$/.exec(head);
  if (list) return `${list[1].replace(/s$/, '')}${list[2]}`;
  if (head === 'init' || head === 'frame' || head === 'vertex' || head === 'equations') return 'motion';
  return head;
}

/** The problems that belong to a stage. */
export function problemsOf(problems: Problem[], s: Stage): Problem[] {
  return problems.filter((p) => stageOfProblem(p.stage) === s.id);
}

/** The layers this preset shows: the ones that draw, and any with a problem to see. */
export function layersOf(p: Preset, problems: Problem[] = []): Stage[] {
  return LAYERS.filter((s) => draws(p, s) || problemsOf(problems, s).length > 0);
}

/** The stage the inspector shows for a selection, falling back to motion. */
export function stageFor(p: Preset, selected: string | null, problems: Problem[] = []): Stage {
  const shown = [...CHAIN, ...layersOf(p, problems)];
  return shown.find((s) => s.id === selected) ?? shown.find((s) => s.id === FIRST)!;
}

// --- adding and removing layers ---------------------------------------------

export type LayerKind = 'wave' | 'shape' | 'waveform' | 'vectors' | 'border';

export interface Offer {
  kind: LayerKind;
  label: string;
  /** Why it can't be added, when it can't. */
  full?: string;
}

const isBlank = (texts: string[]) => texts.every((t) => t.trim() === '');

const STARTER_WAVE = {
  values: { enabled: 1, samples: 512, sep: 0, bSpectrum: 0, bUseDots: 0, bDrawThick: 1, bAdditive: 1, scaling: 1, smoothing: 0.5, r: 1, g: 1, b: 1, a: 0.8 },
  init: '',
  frame: 'r = 0.5 + 0.5*sin(time*1.1);\ng = 0.5 + 0.5*sin(time*1.3 + 2);\nb = 0.5 + 0.5*sin(time*1.7 + 4);',
  point: 'ang = sample*6.2832;\nrad = 0.25 + 0.15*value1;\nx = 0.5 + rad*cos(ang);\ny = 0.5 + rad*sin(ang);',
};

const STARTER_SHAPE = {
  values: {
    enabled: 1, sides: 5, additive: 1, thickOutline: 0, textured: 0, num_inst: 1, x: 0.5, y: 0.5, rad: 0.15, ang: 0,
    r: 1, g: 0.5, b: 0.1, a: 0.6, r2: 0.2, g2: 0.1, b2: 1, a2: 0, border_r: 1, border_g: 1, border_b: 1, border_a: 0.5,
  },
  init: '',
  frame: 'ang = time*0.4;\nrad = 0.12 + 0.08*bass;',
};

/** The first custom wave or shape slot that draws nothing, if any is free. */
export function freeSlot(p: Preset, list: 'waves' | 'shapes'): number | undefined {
  const at = p[list].findIndex((_, i) => value(p, { list, index: i }, 'enabled', 0) === 0);
  return at < 0 ? undefined : at;
}

/** What the add menu offers for this preset, and what it can't. */
export function offers(p: Preset): Offer[] {
  const count = (list: 'waves' | 'shapes') => p[list].filter((_, i) => value(p, { list, index: i }, 'enabled', 0) !== 0).length;
  const layer = (id: string) => LAYERS.find((s) => s.id === id)!;
  const builtin = (kind: LayerKind, id: string): Offer => {
    const off = heldOffBy(p, layer(id));
    return { kind, label: layer(id).label, full: draws(p, layer(id)) ? 'already on' : off ? `motion's code sets ${off} = 0` : undefined };
  };
  const custom = (kind: LayerKind, list: 'waves' | 'shapes', label: string): Offer =>
    freeSlot(p, list) === undefined ? { kind, label, full: 'all 4 in use' } : { kind, label: `${label} (${count(list)} of 4 in use)` };
  return [custom('wave', 'waves', 'custom wave'), custom('shape', 'shapes', 'custom shape'), builtin('waveform', 'wave'), builtin('vectors', 'vectors'), builtin('border', 'border')];
}

/**
 * The preset with one more layer, and the id of its node — or null when there
 * is no room (all four custom slots in use, or the layer already on).
 *
 * A custom slot left blank gets starter code that visibly draws; one that still
 * holds code from before (a layer removed earlier, or one the file shipped off)
 * is turned back on as it was.
 */
export function addLayer(p: Preset, kind: LayerKind): { preset: Preset; id: string } | null {
  if (kind === 'wave' || kind === 'shape') {
    const list = kind === 'wave' ? 'waves' : 'shapes';
    const i = freeSlot(p, list);
    if (i === undefined) return null;
    const owner: Owner = { list, index: i };
    const slot = p[list][i];
    const blank = isBlank(kind === 'wave' ? [slot.init, slot.frame, (slot as Preset['waves'][number]).point] : [slot.init, slot.frame]);
    let next: Preset;
    if (blank) {
      const starter = kind === 'wave' ? STARTER_WAVE : STARTER_SHAPE;
      next = setValues(p, owner, starter.values);
      for (const field of ['init', 'frame', 'point'] as const) {
        if (field in starter) next = setField(next, `${list}.${i}.${field}`, (starter as Record<string, unknown>)[field]);
      }
    } else {
      next = setValues(p, owner, { enabled: 1 });
    }
    return { preset: next, id: `${kind}${i}` };
  }
  const id = kind === 'waveform' ? 'wave' : kind;
  const stage = LAYERS.find((s) => s.id === id)!;
  if (draws(p, stage) || heldOffBy(p, stage)) return null;
  const on: Record<string, Record<string, number>> = {
    wave: { fWaveAlpha: 0.8 },
    vectors: {
      mv_a: 1,
      ...(value(p, BASE, 'nMotionVectorsX', 12) < 1 ? { nMotionVectorsX: 12 } : {}),
      ...(value(p, BASE, 'nMotionVectorsY', 9) < 1 ? { nMotionVectorsY: 9 } : {}),
    },
    // The outer border, or the inner one when per-frame code zeroes `ob_a`
    // (it can't zero both: `heldOffBy` stops the add then).
    border:
      codeSets(p.frame, 'ob_a') === 'off'
        ? { ib_size: 0.01, ib_r: 1, ib_g: 1, ib_b: 1, ib_a: 0.5 }
        : { ob_size: 0.01, ob_r: 1, ob_g: 1, ob_b: 1, ob_a: 0.5 },
  };
  return { preset: setValues(p, BASE, on[id]), id };
}

/**
 * The preset with a layer turned off — its code kept, so adding one again brings
 * it back. Null when per-frame code turns it on regardless (see `drivenBy`), since
 * zeroing the file's value would leave it drawing.
 */
export function removeLayer(p: Preset, id: string): Preset | null {
  const stage = LAYERS.find((s) => s.id === id);
  if (!stage) return null;
  if (stage.owner && stage.owner.list !== 'base') return setValues(p, stage.owner, { enabled: 0 });
  if (drivenBy(p, stage)) return null;
  const off: Record<string, Record<string, number>> = { wave: { fWaveAlpha: 0 }, vectors: { mv_a: 0 }, border: { ob_a: 0, ib_a: 0 } };
  return setValues(p, BASE, off[id]);
}

// --- shaders -----------------------------------------------------------------
// MilkDrop's default shaders as code come from the engine (`api.defaultShader`),
// so the graph keeps no copy of them.

/** The first lines of a stage's code, for its face. */
export function codeLines(p: Preset, s: Stage, n: number): string[] {
  const lines = s.code.flatMap((c) => getField(p, c.field).split('\n').map((l) => l.trim()).filter(Boolean));
  return lines.length > n ? [...lines.slice(0, n - 1), `… ${lines.length - n + 1} more`] : lines;
}

/** A shader stage's code as the preset holds it: empty while it runs MilkDrop's
 * default. Empty for any other stage. */
export function shaderCode(p: Preset, s: Stage): string {
  return s.kind === 'shader' ? p[s.id as 'warp' | 'comp'] : '';
}
