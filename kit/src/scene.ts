// What the browser draws: a symbol from the Sketch document turned into a tree
// of plain nodes, with symbol instances expanded, overrides applied, outlines
// worked out as SVG paths and fonts picked. Everything Sketch-specific stays on
// this side, so the drawing code only composites.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CORNER_ROUNDED, ovalPath, pointsPath, roundedRectPath, type CurvePoint, parsePoint } from './geometry.ts';
import { facesOf, fallbackFace, trackingAt, type Face } from './fonts.ts';

/** sRGB components and alpha, 0 to 1. */
export type Color = [number, number, number, number];
export type Stop = { pos: number; color: Color };
export type Paint =
  | { kind: 'color'; color: Color; opacity: number; blend: number }
  | { kind: 'linear' | 'radial' | 'angular'; from: [number, number]; to: [number, number]; ellipse: number; stops: Stop[]; opacity: number; blend: number };
export type Border = { paint: Paint; width: number; position: number; dash: number[]; cap: number; join: number };
export type Shadow = { color: Color; x: number; y: number; blur: number; spread: number; path: string | null };
export type Blur = { type: number; radius: number };
export type TextRun = { text: string; family: string; weight: number; italic: boolean; size: number; color: Color; kerning: number };
export type TextBlock = { runs: TextRun[]; align: number; valign: number; lineHeight: number | null; wrap: boolean };
export type SceneNode = {
  name: string;
  /** Local points to the scene's points: [a, b, c, d, e, f] as in `DOMMatrix`. */
  matrix: number[];
  width: number;
  height: number;
  /** The outline in local points; null for text. */
  path: string | null;
  fills: Paint[];
  borders: Border[];
  shadows: Shadow[];
  innerShadows: Shadow[];
  blurs: Blur[];
  opacity: number;
  /** Sketch's blend mode number: 0 normal … 15 luminosity, 16 plus darker, 17 plus lighter. */
  blend: number;
  /** The children are cut to `path`. */
  clip: boolean;
  /** This layer masks the siblings after it. */
  mask: null | 'outline' | 'alpha';
  breaksMask: boolean;
  text: TextBlock | null;
  children: SceneNode[];
};
export type Scene = { name: string; width: number; height: number; background: Color | null; root: SceneNode; warnings: string[] };

// Sketch's JSON is loose; these name the parts read here.
type SColor = { red: number; green: number; blue: number; alpha: number };
type SGradient = { gradientType: number; from: string; to: string; elipseLength: number; stops: { position: number; color: SColor }[] };
type SContext = { opacity?: number; blendMode?: number };
type SFill = { isEnabled: boolean; fillType: number; color: SColor; gradient: SGradient; contextSettings?: SContext };
type SBorder = SFill & { thickness: number; position: number };
type SShadow = { isEnabled: boolean; color: SColor; offsetX: number; offsetY: number; blurRadius: number; spread: number };
type SBlur = { isEnabled: boolean; type: number; radius: number };
type SStyle = {
  fills?: SFill[];
  borders?: SBorder[];
  borderOptions?: { dashPattern?: number[]; lineCapStyle?: number; lineJoinStyle?: number };
  shadows?: SShadow[];
  innerShadows?: SShadow[];
  blur?: SBlur;
  blurs?: SBlur[];
  contextSettings?: SContext;
  corners?: { radii: number[]; style: number; smoothing?: number };
  textStyle?: { encodedAttributes: SAttributes; verticalAlignment?: number };
};
type SAttributes = {
  MSAttributedStringFontAttribute?: { attributes: { name: string; size: number } };
  MSAttributedStringColorAttribute?: SColor;
  kerning?: number;
  paragraphStyle?: { alignment?: number; maximumLineHeight?: number; minimumLineHeight?: number };
  textStyleVerticalAlignmentKey?: number;
};
export type SLayer = {
  _class: string;
  do_objectID: string;
  name: string;
  isVisible?: boolean;
  frame: { x: number; y: number; width: number; height: number };
  rotation?: number;
  isFlippedHorizontal?: boolean;
  isFlippedVertical?: boolean;
  style?: SStyle;
  layers?: SLayer[];
  clippingBehavior?: number;
  hasClippingMask?: boolean;
  clippingMaskMode?: number;
  shouldBreakMaskChain?: boolean;
  booleanOperation?: number;
  // shapes
  points?: CurvePoint[];
  isClosed?: boolean;
  fixedRadius?: number;
  // symbols
  symbolID?: string;
  overrideValues?: { overrideName: string; value: unknown }[];
  // text
  attributedString?: { string: string; attributes: { location: number; length: number; attributes: SAttributes }[] };
  textBehaviour?: number;
};

export type Kit = {
  dir: string;
  /** Symbol masters by id and by name. */
  symbols: Map<string, SLayer>;
  byName: Map<string, SLayer>;
  /** Faces by PostScript name, from the embedded fonts. */
  faces: Map<string, Face>;
  /** Embedded font files to load in the browser, by family. */
  fontFiles: FontFile[];
};
export type FontFile = { family: string; file: string; variable: boolean };

/** Reads an unpacked `.sketch` (a folder with `document.json` and `pages/`). */
export function loadKit(dir: string): Kit {
  const doc = JSON.parse(readFileSync(join(dir, 'document.json'), 'utf8'));
  const symbols = new Map<string, SLayer>();
  const byName = new Map<string, SLayer>();
  const add = (l: SLayer) => {
    if (l._class === 'symbolMaster' && l.symbolID) {
      symbols.set(l.symbolID, l);
      byName.set(l.name, l);
    }
  };
  for (const f of readdirSync(join(dir, 'pages'))) {
    if (!f.endsWith('.json')) continue;
    const page = JSON.parse(readFileSync(join(dir, 'pages', f), 'utf8'));
    for (const l of page.layers ?? []) add(l);
  }
  for (const s of doc.foreignSymbols ?? []) add(s.symbolMaster);

  const faces = new Map<string, Face>();
  const fontFiles: FontFile[] = [];
  for (const ref of doc.fontReferences ?? []) {
    const file = ref.fontData?._ref;
    if (!file) continue;
    const family = `kit ${ref.fontFamilyName}`;
    const { faces: found, variable } = facesOf(readFileSync(join(dir, file)), family);
    for (const [ps, face] of found) faces.set(ps, face);
    fontFiles.push({ family, file: join(dir, file), variable });
  }
  return { dir, symbols, byName, faces, fontFiles };
}

const color = (c: SColor): Color => [c.red, c.green, c.blue, c.alpha];

type Ctx = { kit: Kit; warnings: Set<string>; where: string[] };
const warn = (ctx: Ctx, what: string) => ctx.warnings.add(`${what} (${ctx.where.join(' › ')})`);

/** Overrides keyed by the path of layer ids below the instance, e.g. `A/B_stringValue`. */
type Overrides = Map<string, unknown>;

function subOverrides(o: Overrides, id: string): Overrides {
  const out: Overrides = new Map();
  for (const [k, v] of o) if (k.startsWith(`${id}/`)) out.set(k.slice(id.length + 1), v);
  return out;
}

const mul = (m: number[], n: number[]): number[] => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

/** The layer's own transform: its offset, then its rotation and flips about its centre. */
function localMatrix(l: SLayer, ctx: Ctx): number[] {
  const { x, y, width: w, height: h } = l.frame;
  let m = [1, 0, 0, 1, x, y];
  const rot = l.rotation ?? 0;
  const fx = l.isFlippedHorizontal ? -1 : 1;
  const fy = l.isFlippedVertical ? -1 : 1;
  if (rot || fx < 0 || fy < 0) {
    if (rot) warn(ctx, 'rotation drawn counter-clockwise, unchecked');
    const a = (-rot * Math.PI) / 180;
    m = mul(m, [1, 0, 0, 1, w / 2, h / 2]);
    m = mul(m, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]);
    m = mul(m, [fx, 0, 0, fy, 0, 0]);
    m = mul(m, [1, 0, 0, 1, -w / 2, -h / 2]);
  }
  return m;
}

function paint(f: SFill, l: SLayer, ctx: Ctx): Paint | null {
  const opacity = f.contextSettings?.opacity ?? 1;
  const blend = f.contextSettings?.blendMode ?? 0;
  if (f.fillType === 0) return { kind: 'color', color: color(f.color), opacity, blend };
  if (f.fillType === 1) {
    const g = f.gradient;
    const kind = (['linear', 'radial', 'angular'] as const)[g.gradientType];
    if (!kind) return (warn(ctx, `gradient type ${g.gradientType} skipped`), null);
    if (kind === 'angular') warn(ctx, 'angular gradient start angle unchecked');
    const { width: w, height: h } = l.frame;
    const [fx, fy] = parsePoint(g.from);
    const [tx, ty] = parsePoint(g.to);
    return {
      kind,
      from: [fx * w, fy * h],
      to: [tx * w, ty * h],
      ellipse: g.elipseLength,
      stops: g.stops.map((s) => ({ pos: s.position, color: color(s.color) })),
      opacity,
      blend,
    };
  }
  warn(ctx, `fill type ${f.fillType} (image or noise) skipped`);
  return null;
}

function shadows(list: SShadow[] | undefined, grow: ((spread: number) => string | null) | null, ctx: Ctx): Shadow[] {
  return (list ?? [])
    .filter((s) => s.isEnabled)
    .map((s) => {
      const path = s.spread && grow ? grow(s.spread) : null;
      if (s.spread && !path) warn(ctx, 'shadow spread on a shape that can only grow as a rectangle or oval: ignored');
      return { color: color(s.color), x: s.offsetX, y: s.offsetY, blur: s.blurRadius, spread: s.spread, path };
    });
}

/** The outline, and how to grow it for a shadow's spread, where that is simple. */
function outline(l: SLayer, ctx: Ctx): { path: string | null; grow: ((s: number) => string | null) | null } {
  const { width: w, height: h } = l.frame;
  const corners = l.style?.corners;
  const radii = corners?.radii ?? (l.fixedRadius !== undefined ? [l.fixedRadius] : (l.points?.map((p) => p.cornerRadius) ?? [0]));
  const style = corners?.style ?? CORNER_ROUNDED;
  const smoothing = corners?.smoothing ?? 0;
  if (corners && corners.style > 1) warn(ctx, `corner style ${corners.style} drawn as rounded`);
  // A spread grows the outline by `s` on every side, and its radii with it.
  const rect = (s: number) =>
    roundedRectPath(
      w + 2 * s,
      h + 2 * s,
      radii.map((r) => Math.max(0, r + s)),
      Math.min(style, 1),
      smoothing,
      -s,
      -s,
    );
  switch (l._class) {
    case 'rectangle':
    case 'group':
    case 'symbolMaster':
    case 'symbolInstance':
    case 'artboard':
      return { path: rect(0), grow: rect };
    case 'oval':
      return { path: ovalPath(w, h), grow: (s) => ovalPath(w + 2 * s, h + 2 * s, -s, -s) };
    case 'shapePath': {
      const { d, rounded } = pointsPath(l.points ?? [], w, h, l.isClosed ?? true);
      if (rounded) warn(ctx, 'corner radii on path points not drawn');
      return { path: d, grow: null };
    }
    case 'triangle':
    case 'star':
    case 'polygon': {
      const { d } = pointsPath(l.points ?? [], w, h, true);
      return { path: d, grow: null };
    }
    default:
      return { path: null, grow: null };
  }
}

function textBlock(l: SLayer, overrides: Overrides, ctx: Ctx): TextBlock {
  const as = l.attributedString!;
  const override = overrides.get(`${l.do_objectID}_stringValue`);
  const base = l.style?.textStyle?.encodedAttributes ?? {};
  const runFrom = (text: string, a: SAttributes): TextRun => {
    const font = a.MSAttributedStringFontAttribute?.attributes ?? base.MSAttributedStringFontAttribute?.attributes ?? { name: 'SFPro-Regular', size: 13 };
    let face = ctx.kit.faces.get(font.name);
    if (!face) {
      face = fallbackFace(font.name);
      warn(ctx, `font ${font.name} not embedded: drawn with ${face.family} ${face.weight}`);
    }
    const c = a.MSAttributedStringColorAttribute ?? base.MSAttributedStringColorAttribute ?? { red: 0, green: 0, blue: 0, alpha: 1 };
    // An explicit kerning replaces the font's own tracking, as in Core Text.
    const kerning = a.kerning ?? base.kerning ?? trackingAt(face.tracking, font.size);
    return { text, family: face.family, weight: face.weight, italic: face.italic, size: font.size, color: color(c), kerning };
  };
  const first = as.attributes[0]?.attributes ?? base;
  const runs = typeof override === 'string' ? [runFrom(override, first)] : as.attributes.map((r) => runFrom(as.string.slice(r.location, r.location + r.length), r.attributes));
  const para = first.paragraphStyle ?? base.paragraphStyle ?? {};
  if ((l.style?.fills ?? []).some((f) => f.isEnabled)) warn(ctx, 'fills on text not drawn');
  return {
    runs,
    align: para.alignment ?? 0,
    valign: first.textStyleVerticalAlignmentKey ?? base.textStyleVerticalAlignmentKey ?? l.style?.textStyle?.verticalAlignment ?? 0,
    lineHeight: para.maximumLineHeight ?? para.minimumLineHeight ?? null,
    wrap: (l.textBehaviour ?? 0) !== 0,
  };
}

function node(l: SLayer, parent: number[], overrides: Overrides, ctx: Ctx, asRoot = false): SceneNode | null {
  if (l.isVisible === false) return null;
  ctx.where.push(l.name);
  try {
    let src = l;
    let layers = l.layers ?? [];
    let inner = overrides;
    let scale: number[] = [1, 0, 0, 1, 0, 0];
    if (l._class === 'symbolInstance') {
      const swapped = overrides.get(`${l.do_objectID}_symbolID`);
      if (swapped === '') return null;
      const id = typeof swapped === 'string' ? swapped : l.symbolID!;
      const master = ctx.kit.symbols.get(id);
      if (!master) return (warn(ctx, `symbol ${id} not found`), null);
      src = master;
      layers = master.layers ?? [];
      inner = subOverrides(overrides, l.do_objectID);
      for (const o of l.overrideValues ?? []) if (!inner.has(o.overrideName)) inner.set(o.overrideName, o.value);
      const sx = l.frame.width / master.frame.width;
      const sy = l.frame.height / master.frame.height;
      if (Math.abs(sx - 1) > 1e-3 || Math.abs(sy - 1) > 1e-3) warn(ctx, `instance scaled ${sx.toFixed(2)}×${sy.toFixed(2)} instead of resized by constraints`);
      scale = [sx, 0, 0, sy, 0, 0];
      for (const k of inner.keys()) {
        if (!/_(stringValue|symbolID)$/.test(k)) warn(ctx, `override ${k.replace(/^.*_/, '')} not applied`);
      }
    }
    const own = asRoot ? [1, 0, 0, 1, 0, 0] : localMatrix(l, ctx);
    const matrix = mul(parent, own);
    const style: SStyle = src.style ?? {};
    // An instance keeps its own opacity and blending; the rest is the master's.
    const ctxs = (l._class === 'symbolInstance' ? l.style?.contextSettings : undefined) ?? style.contextSettings ?? {};
    const shape = { ...src, frame: l.frame } as SLayer;
    const { path, grow } = outline(shape, ctx);
    const blurs = (style.blurs ?? (style.blur ? [style.blur] : [])).filter((b) => b.isEnabled).map((b) => ({ type: b.type, radius: b.radius }));
    for (const b of blurs) {
      if (b.type === 4) warn(ctx, 'glass drawn as a plain background blur: no refraction, highlights or chromatic aberration');
      else if (b.type !== 0 && b.type !== 3) warn(ctx, `blur type ${b.type} drawn as a background blur`);
    }
    if (src._class === 'shapeGroup') warn(ctx, 'shape group drawn as its parts, without their boolean operations');
    const opts = style.borderOptions ?? {};
    const out: SceneNode = {
      name: l.name,
      matrix,
      width: l.frame.width,
      height: l.frame.height,
      path: src._class === 'text' ? null : path,
      fills: src._class === 'text' ? [] : (style.fills ?? []).filter((f) => f.isEnabled).flatMap((f) => paint(f, shape, ctx) ?? []),
      borders: (style.borders ?? [])
        .filter((b) => b.isEnabled)
        .flatMap((b) => {
          const p = paint(b, shape, ctx);
          return p ? [{ paint: p, width: b.thickness, position: b.position, dash: opts.dashPattern ?? [], cap: opts.lineCapStyle ?? 0, join: opts.lineJoinStyle ?? 0 }] : [];
        }),
      shadows: shadows(style.shadows, grow, ctx),
      innerShadows: shadows(style.innerShadows, null, ctx),
      blurs,
      opacity: ctxs.opacity ?? 1,
      blend: ctxs.blendMode ?? 0,
      clip: src.clippingBehavior === 2,
      mask: l.hasClippingMask ? (l.clippingMaskMode === 1 ? 'alpha' : 'outline') : null,
      breaksMask: !!l.shouldBreakMaskChain,
      text: src._class === 'text' ? textBlock(src, overrides, ctx) : null,
      children: [],
    };
    const childMatrix = mul(matrix, scale);
    out.children = layers.flatMap((c) => node(c, childMatrix, inner, ctx) ?? []);
    return out;
  } finally {
    ctx.where.pop();
  }
}

/** The window background a symbol sits on, from its name's appearance. */
export function backgroundFor(name: string): Color {
  return /\/Dark\//.test(name) ? [30 / 255, 30 / 255, 30 / 255, 1] : [1, 1, 1, 1];
}

export function buildScene(kit: Kit, master: SLayer, background: Color | null): Scene {
  const ctx: Ctx = { kit, warnings: new Set(), where: [] };
  const root = node(master, [1, 0, 0, 1, 0, 0], new Map(), ctx, true)!;
  return { name: master.name, width: master.frame.width, height: master.frame.height, background, root, warnings: [...ctx.warnings] };
}
