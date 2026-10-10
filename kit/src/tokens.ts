// CSS custom properties from a Sketch document's shared styles: its colour
// swatches, text styles and layer styles. Each name's appearance (a `Light`
// or `Dark` segment) decides whether it lands in the light or the dark block;
// names without one apply to both.
//
// Colours keep AppKit's names where the kit uses them (labelColor becomes
// `--mac-label`, secondaryLabelColor `--mac-secondary-label`, systemBlue
// `--mac-blue`); layer styles keep the kit's own path, as a slug.

export type SColor = { red: number; green: number; blue: number; alpha: number };
type SContext = { opacity?: number; blendMode?: number };
type SFill = { isEnabled: boolean; fillType: number; color: SColor; gradient?: SGradient; contextSettings?: SContext };
type SGradient = { gradientType: number; from: string; to: string; stops: { position: number; color: SColor }[] };
type SBorder = SFill & { thickness: number; position: number };
type SShadow = { isEnabled: boolean; color: SColor; offsetX: number; offsetY: number; blurRadius: number; spread: number };
type SBlur = { isEnabled: boolean; type: number; radius: number; saturation?: number };
export type SStyle = {
  fills?: SFill[];
  borders?: SBorder[];
  shadows?: SShadow[];
  innerShadows?: SShadow[];
  blurs?: SBlur[];
  blur?: SBlur;
  contextSettings?: SContext;
  textStyle?: { encodedAttributes: { MSAttributedStringFontAttribute?: { attributes: { name: string; size: number } }; kerning?: number; paragraphStyle?: { maximumLineHeight?: number } } };
};
export type SDocument = {
  sharedSwatches?: { objects: { name: string; value: SColor }[] };
  layerTextStyles?: { objects: { name: string; value: SStyle }[] };
  layerStyles?: { objects: { name: string; value: SStyle }[] };
};

export type Appearance = 'any' | 'light' | 'dark';
export type Token = { name: string; value: string; appearance: Appearance; comment?: string };

const slug = (s: string) =>
  s
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

/** "01 - Idle" → "Idle", "8 Blue" → "Blue", "Active, On, 01 - Idle" → "Active, On, Idle": the kit numbers its entries for ordering. */
const unnumber = (s: string) =>
  s
    .replace(/^\s*\d+\s+(-\s+)?/, '')
    .replace(/\b\d+\s+-\s+/g, '')
    .trim();

/** The appearance a style's name says, and the name without it. */
export function splitAppearance(name: string): { appearance: Appearance; vibrant: boolean; parts: string[] } {
  let appearance: Appearance = 'any';
  let vibrant = false;
  const parts: string[] = [];
  for (const seg of name.split('/').map((s) => s.trim())) {
    const m = /^(Light|Dark)\b(.*)$/.exec(seg);
    if (m && appearance === 'any') {
      appearance = m[1] === 'Light' ? 'light' : 'dark';
      // The kit writes some as "Dark (use plus lighter)", without "Vibrant".
      vibrant = /Vibrant|use plus/.test(m[2]);
      // "Light Background" keeps "Background"; "Dark Vibrant (use plus lighter)" keeps nothing.
      const restOf = m[2].replace(/Vibrant|\(.*?\)/g, '').trim();
      if (restOf) parts.push(restOf);
    } else if (/^(Light|Dark)( Vibrant.*)?$/.test(seg)) {
      continue;
    } else {
      parts.push(seg);
    }
  }
  return { appearance, vibrant, parts };
}

// ---- colour ----------------------------------------------------------------

/** Premultiplied RGBA, 0 to 1. */
type Px = [number, number, number, number];

const premul = (c: SColor, opacity = 1): Px => {
  const a = c.alpha * opacity;
  return [c.red * a, c.green * a, c.blue * a, a];
};

const round = (v: number, places: number) => {
  const r = Math.round(v * 10 ** places) / 10 ** places;
  return Object.is(r, -0) ? 0 : r;
};

export function cssColor([r, g, b, a]: Px): string {
  const un = (v: number) => (a > 0 ? round(Math.min(255, Math.max(0, (v / a) * 255)), 1) : 0);
  const rgb = `${un(r)} ${un(g)} ${un(b)}`;
  const alpha = round(a, 3);
  return alpha >= 1 ? `rgb(${rgb})` : `rgb(${rgb} / ${alpha})`;
}

const BLENDS = [
  'normal',
  'darken',
  'multiply',
  'color-burn',
  'lighten',
  'screen',
  'color-dodge',
  'overlay',
  'soft-light',
  'hard-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
  'plus-darker',
  'plus-lighter',
];
export const blendName = (mode: number) => BLENDS[mode] ?? 'normal';

/** W3C separable blend functions, on unpremultiplied channels. */
function separable(mode: number, cb: number, cs: number): number {
  switch (mode) {
    case 1:
      return Math.min(cb, cs);
    case 2:
      return cb * cs;
    case 3:
      return cb === 1 ? 1 : cs === 0 ? 0 : 1 - Math.min(1, (1 - cb) / cs);
    case 4:
      return Math.max(cb, cs);
    case 5:
      return cb + cs - cb * cs;
    case 6:
      return cb === 0 ? 0 : cs === 1 ? 1 : Math.min(1, cb / (1 - cs));
    case 7:
      return separable(9, cs, cb);
    case 8: {
      if (cs <= 0.5) return cb - (1 - 2 * cs) * cb * (1 - cb);
      const d = cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb);
      return cb + (2 * cs - 1) * (d - cb);
    }
    case 9:
      return cs <= 0.5 ? cb * 2 * cs : separable(5, cb, 2 * cs - 1);
    case 10:
      return Math.abs(cb - cs);
    case 11:
      return cb + cs - 2 * cb * cs;
    default:
      return cs;
  }
}

type Rgb = [number, number, number];
const lum = ([r, g, b]: Rgb) => 0.3 * r + 0.59 * g + 0.11 * b;
function clipColor(c: Rgb): Rgb {
  const l = lum(c);
  const n = Math.min(...c);
  const x = Math.max(...c);
  return c.map((v) => {
    if (n < 0) v = l + ((v - l) * l) / (l - n);
    if (x > 1) v = l + ((v - l) * (1 - l)) / (x - l);
    return v;
  }) as Rgb;
}
const setLum = (c: Rgb, l: number): Rgb => clipColor(c.map((v) => v + (l - lum(c))) as Rgb);
const sat = (c: Rgb) => Math.max(...c) - Math.min(...c);
function setSat(c: Rgb, s: number): Rgb {
  const max = Math.max(...c);
  const min = Math.min(...c);
  return c.map((v) => (max > min ? ((v - min) * s) / (max - min) : 0)) as Rgb;
}

/** A blend mode's result colour, unpremultiplied, for backdrop `b` and source `s`. */
function blendRgb(mode: number, b: Rgb, s: Rgb): Rgb {
  switch (mode) {
    case 12:
      return setLum(setSat(s, sat(b)), lum(b));
    case 13:
      return setLum(setSat(b, sat(s)), lum(b));
    case 14:
      return setLum(s, lum(b));
    case 15:
      return setLum(b, lum(s));
    default:
      return [0, 1, 2].map((i) => separable(mode, b[i], s[i])) as Rgb;
  }
}

/**
 * Source `s` composited over backdrop `b` (both premultiplied) with a Sketch
 * blend mode: source-over with the W3C blend formula, or Core Graphics' plus
 * darker and plus lighter.
 */
export function over(b: Px, s: Px, mode: number): Px {
  const [as, ab] = [s[3], b[3]];
  const ao = mode === 16 || mode === 17 ? Math.min(1, as + ab) : as + ab * (1 - as);
  if (mode === 16) return [0, 1, 2].map((i) => Math.max(0, ao - (as - s[i]) - (ab - b[i]))).concat(ao) as Px;
  if (mode === 17) return [0, 1, 2].map((i) => Math.min(ao, s[i] + b[i])).concat(ao) as Px;
  if (mode === 0 || as === 0 || ab === 0) return [0, 1, 2].map((i) => s[i] + b[i] * (1 - as)).concat(ao) as Px;
  const cb = [0, 1, 2].map((i) => b[i] / ab) as Rgb;
  const cs = [0, 1, 2].map((i) => s[i] / as) as Rgb;
  const mixed = blendRgb(mode, cb, cs);
  return [0, 1, 2].map((i) => as * ((1 - ab) * cs[i] + ab * mixed[i]) + (1 - as) * b[i]).concat(ao) as Px;
}

// ---- layer styles -> CSS ---------------------------------------------------------

const px = (v: number) => `${round(v, 2)}px`;

function gradient(f: SFill, opacity: number): string {
  const g = f.gradient!;
  const stops = g.stops.map((s) => `${cssColor(premul(s.color, (f.contextSettings?.opacity ?? 1) * opacity))} ${round(s.position * 100, 1)}%`).join(', ');
  const p = (s: string) =>
    s
      .replace(/[{}\s]/g, '')
      .split(',')
      .map(Number);
  const [fx, fy] = p(g.from);
  const [tx, ty] = p(g.to);
  if (g.gradientType === 1) return `radial-gradient(circle at ${round(fx * 100, 1)}% ${round(fy * 100, 1)}%, ${stops})`;
  if (g.gradientType === 2) return `conic-gradient(${stops})`;
  // CSS angles start at the top and turn clockwise; this ignores the box's aspect.
  const deg = (Math.atan2(tx - fx, -(ty - fy)) * 180) / Math.PI;
  return `linear-gradient(${round((deg + 360) % 360, 1)}deg, ${stops})`;
}

/**
 * The fills as one CSS background: solid fills (whatever their blend modes)
 * composited into a single colour, the style's opacity included; a gradient
 * makes it a layered background instead, where the fills' blend modes are
 * lost (CSS can't blend background layers with plus darker or lighter).
 */
export function background(style: SStyle): string | null {
  const fills = (style.fills ?? []).filter((f) => f.isEnabled && (f.fillType === 0 || f.fillType === 1));
  if (fills.length === 0) return null;
  const opacity = style.contextSettings?.opacity ?? 1;
  if (fills.every((f) => f.fillType === 0)) {
    let acc: Px = [0, 0, 0, 0];
    for (const f of fills) acc = over(acc, premul(f.color, f.contextSettings?.opacity ?? 1), f.contextSettings?.blendMode ?? 0);
    return cssColor([acc[0] * opacity, acc[1] * opacity, acc[2] * opacity, acc[3] * opacity]);
  }
  // CSS lists the top layer first; Sketch lists fills bottom first.
  return fills
    .slice()
    .reverse()
    .map((f) => (f.fillType === 1 ? gradient(f, opacity) : `linear-gradient(${cssColor(premul(f.color, (f.contextSettings?.opacity ?? 1) * opacity))} 0 0)`))
    .join(', ');
}

/** Borders as box-shadow rings: inside → inset, outside → outset, centre → half each; the style's opacity included. */
export function ring(style: SStyle): string | null {
  const parts: string[] = [];
  const opacity = style.contextSettings?.opacity ?? 1;
  for (const b of (style.borders ?? []).filter((x) => x.isEnabled && x.fillType === 0).reverse()) {
    const c = cssColor(premul(b.color, (b.contextSettings?.opacity ?? 1) * opacity));
    if (b.position === 1) parts.push(`inset 0 0 0 ${px(b.thickness)} ${c}`);
    else if (b.position === 2) parts.push(`0 0 0 ${px(b.thickness)} ${c}`);
    else parts.push(`inset 0 0 0 ${px(b.thickness / 2)} ${c}`, `0 0 0 ${px(b.thickness / 2)} ${c}`);
  }
  return parts.length ? parts.join(', ') : null;
}

/** Shadows and inner shadows as one box-shadow list, top first. */
export function shadow(style: SStyle): string | null {
  const one = (s: SShadow, inset: boolean) => `${inset ? 'inset ' : ''}${px(s.offsetX)} ${px(s.offsetY)} ${px(s.blurRadius)} ${px(s.spread)} ${cssColor(premul(s.color))}`;
  const parts = [...(style.innerShadows ?? []).filter((s) => s.isEnabled).map((s) => one(s, true)), ...(style.shadows ?? []).filter((s) => s.isEnabled).map((s) => one(s, false))];
  return parts.length ? parts.join(', ') : null;
}

/** A background blur (or glass) as backdrop-filter; Sketch's radius is twice CSS's deviation. */
export function backdrop(style: SStyle): { value: string; glass: boolean } | null {
  const b = (style.blurs ?? (style.blur ? [style.blur] : [])).find((x) => x.isEnabled && (x.type === 3 || x.type === 4));
  if (!b) return null;
  const parts = [`blur(${px(b.radius / 2)})`];
  if (b.saturation !== undefined && b.saturation !== 1) parts.push(`saturate(${round(b.saturation, 2)})`);
  return { value: parts.join(' '), glass: b.type === 4 };
}

// ---- tokens --------------------------------------------------------------------

const LEVELS: Record<string, string> = { Primary: '', Secondary: 'secondary-', Tertiary: 'tertiary-', Quaternary: 'quaternary-', Quatenary: 'quaternary-', Quinary: 'quinary-', Seximal: 'senary-' };

/** A swatch's token name, or null for the kit's own bookkeeping colours. */
export function swatchName(name: string): { token: string; appearance: Appearance } | null {
  const { appearance, vibrant, parts } = splitAppearance(name);
  const [group, ...rest] = parts;
  const leaf = unnumber(rest.join(' '));
  const v = vibrant ? 'vibrant-' : '';
  switch (group) {
    case 'System Colors':
      return { token: `--mac-${v}${slug(leaf)}`, appearance };
    case 'Labels':
    case 'Fills': {
      const level = LEVELS[leaf] ?? `${slug(leaf)}-`;
      return { token: `--mac-${v}${level}${group === 'Labels' ? 'label' : 'fill'}`, appearance };
    }
    case 'Grays':
      return leaf === 'Grey' ? { token: `--mac-${v}gray`, appearance } : null;
    case 'Separators':
      return { token: `--mac-${v}separator`, appearance };
    case 'Window Backgrounds':
      return { token: `--mac-window-${slug(leaf)}`, appearance };
    default:
      return /^x\./.test(group ?? '') ? null : { token: `--mac-${v}${slug([group, leaf].filter(Boolean).join(' '))}`, appearance };
  }
}

const WEIGHTS: [RegExp, number][] = [
  [/Ultralight/, 100],
  [/Thin/, 200],
  [/Light/, 300],
  [/Medium/, 510],
  [/Semibold/, 590],
  [/Heavy/, 860],
  [/Bold/, 700],
  [/Black/, 1000],
];
export const weightOf = (postscript: string) => WEIGHTS.find(([re]) => re.test(postscript.split('-')[1] ?? ''))?.[1] ?? 400;

/** "Tight Leading/06 Body/Emphasized" → "--mac-font-body-emphasized-tight". */
export function textStyleName(name: string): string | null {
  const parts = name.split('/').map((s) => s.trim());
  const leading = /Leading$/.test(parts[0]) ? slug(parts.shift()!.replace(/ Leading$/, '')) : '';
  if (parts.length < 2) return null;
  const [style, variant] = parts;
  return `--mac-font-${slug(unnumber(style))}${variant === 'Emphasized' ? '-emphasized' : ''}${leading ? `-${leading}` : ''}`;
}

/** Every token the document defines, in document order within each kind. */
export function tokensOf(doc: SDocument): Token[] {
  const tokens: Token[] = [];
  const seen = new Map<string, number>();
  const add = (t: Token) => {
    const key = `${t.appearance} ${t.name}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    tokens.push(n === 1 ? t : { ...t, name: `${t.name}-${n}` });
  };

  for (const s of doc.sharedSwatches?.objects ?? []) {
    const n = swatchName(s.name);
    if (n) add({ name: n.token, value: cssColor(premul(s.value)), appearance: n.appearance });
  }
  for (const [mode, value] of [
    ['light', 'plus-darker'],
    ['dark', 'plus-lighter'],
  ] as const) {
    add({ name: '--mac-vibrant-blend', value, appearance: mode, comment: 'what the vibrant colours are drawn with (WebKit has both)' });
  }

  add({
    name: '--mac-font-family',
    value: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
    appearance: 'any',
    comment: "SF Pro: WebKit's system font applies its tracking and optical sizes itself",
  });
  for (const t of (doc.layerTextStyles?.objects ?? []).slice().sort((a, b) => a.name.localeCompare(b.name))) {
    const name = textStyleName(t.name);
    const attrs = t.value.textStyle?.encodedAttributes;
    const font = attrs?.MSAttributedStringFontAttribute?.attributes;
    if (!name || !font) continue;
    const lh = attrs?.paragraphStyle?.maximumLineHeight;
    add({ name, value: `${weightOf(font.name)} ${px(font.size)}${lh ? `/${px(lh)}` : ''} var(--mac-font-family)`, appearance: 'any' });
    if (attrs?.kerning) add({ name: name.replace('--mac-font-', '--mac-tracking-'), value: px(attrs.kerning), appearance: 'any' });
  }

  for (const s of doc.layerStyles?.objects ?? []) {
    const { appearance, parts } = splitAppearance(s.name);
    const base = `--mac-${parts.map((p) => slug(unnumber(p.replace(/,/g, ' ')))).join('-')}`;
    const st = s.value;
    const bg = background(st);
    if (bg) add({ name: `${base}-bg`, value: bg, appearance });
    const blend = st.contextSettings?.blendMode;
    if (blend) add({ name: `${base}-blend`, value: blendName(blend), appearance });
    const r = ring(st);
    if (r) add({ name: `${base}-ring`, value: r, appearance });
    const sh = shadow(st);
    if (sh) add({ name: `${base}-shadow`, value: sh, appearance, comment: backdrop(st)?.glass ? 'glass lighting, as the kit layers it; a starting point only' : undefined });
    const bd = backdrop(st);
    if (bd) add({ name: `${base}-backdrop`, value: bd.value, appearance, comment: bd.glass ? 'Liquid Glass, approximated as a blur: compare with the PNG' : undefined });
  }
  return tokens;
}

const decl = (t: Token) => `  ${t.name}: ${t.value};${t.comment ? ` /* ${t.comment} */` : ''}`;

/** The stylesheet: shared and light tokens on :root, dark ones by preference or `data-appearance`. */
export function tokensCss(tokens: Token[], source: string): string {
  const of = (a: Appearance) =>
    tokens
      .filter((t) => t.appearance === a)
      .map(decl)
      .join('\n');
  return `/*
 * macOS design tokens, generated by \`npm run tokens\` in kit/ from ${source}.
 * Don't edit by hand: change the generator (kit/src/tokens.ts) and run it again.
 *
 * Light values sit on :root; dark ones apply under prefers-color-scheme: dark,
 * or anywhere under [data-appearance='dark'] (and [data-appearance='light']
 * holds light). Layer styles keep the kit's path: --mac-<path>-bg (the fills
 * composited into one colour), -blend, -ring (borders), -shadow, -backdrop.
 */

:root,
[data-appearance='light'] {
  color-scheme: light;
${of('any')}
${of('light')}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-appearance='light']) {
    color-scheme: dark;
${of('dark').replace(/^/gm, '  ')}
  }
}

[data-appearance='dark'] {
  color-scheme: dark;
${of('dark')}
}
`;
}

const LAYER_PART = /-(bg|blend|ring|shadow|backdrop)(-\d+)?$/;

/**
 * A page showing every token in light and dark side by side: colours as
 * chips, the type scale as samples, and each layer style as a tile over a
 * striped backdrop, so materials and glass show what they blur.
 */
export function tokensPreview(tokens: Token[], cssHref: string): string {
  const names = (pred: (n: string) => boolean) => [...new Set(tokens.map((t) => t.name))].filter(pred);
  const isType = (n: string) => n.startsWith('--mac-font-') || n.startsWith('--mac-tracking-');
  const colours = names((n) => !isType(n) && !LAYER_PART.test(n) && n !== '--mac-vibrant-blend');
  const fonts = names((n) => n.startsWith('--mac-font-') && n !== '--mac-font-family');
  const layers = [...new Set(names((n) => LAYER_PART.test(n)).map((n) => n.replace(LAYER_PART, (_, _part, dup) => `|${dup ?? ''}`)))];
  // Styles that blur what is behind them go over stripes; the rest sit on the window.
  const blurs = (key: string) => names((n) => n.endsWith('-backdrop')).includes(key.replace('|', '-backdrop'));
  const v = (n: string) => `var(${n})`;
  const tile = (key: string) => {
    const [base, dup] = key.split('|');
    const p = (part: string) => `${base}-${part}${dup}`;
    const style = [
      `background:var(${p('bg')},transparent)`,
      `box-shadow:var(${p('ring')},0 0 #0000),var(${p('shadow')},0 0 #0000)`,
      `backdrop-filter:var(${p('backdrop')},none)`,
      `-webkit-backdrop-filter:var(${p('backdrop')},none)`,
      `mix-blend-mode:var(${p('blend')},normal)`,
    ].join(';');
    return `<div class="tile"><div class="sample" style="${style}"></div><code>${base.replace('--mac-', '')}${dup}</code></div>`;
  };
  const panel = (appearance: 'light' | 'dark') => `<section data-appearance="${appearance}">
<h2>${appearance}</h2>
<h3>Colours</h3><div class="grid">${colours.map((n) => `<div class="chip"><span style="background:${v(n)}"></span><code>${n.replace('--mac-', '')}</code></div>`).join('')}</div>
<h3>Type</h3>${fonts.map((n) => `<p style="font:${v(n)}">${n.replace('--mac-font-', '')} — The quick brown fox</p>`).join('')}
<h3>Layer styles</h3><div class="grid">${layers
    .filter((k) => !blurs(k))
    .map(tile)
    .join('')}</div>
<h3>Materials and glass</h3><div class="stage"><div class="grid">${layers.filter(blurs).map(tile).join('')}</div></div>
</section>`;
  return `<!doctype html><meta charset="utf-8"><title>Kit tokens</title><link rel="stylesheet" href="${cssHref}"><style>
body{margin:0;display:grid;grid-template-columns:1fr 1fr;font:var(--mac-font-body)}
section{padding:24px;background:var(--mac-window-background);color:var(--mac-label);min-width:0}
h2{font:var(--mac-font-title1-emphasized);text-transform:capitalize;margin:0 0 8px}
h3{font:var(--mac-font-headline);margin:24px 0 8px}
p{margin:4px 0}
code{font-size:10px;color:var(--mac-secondary-label);overflow-wrap:anywhere}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.chip{display:flex;gap:8px;align-items:center}.chip span{flex:none;width:28px;height:28px;border-radius:7px;box-shadow:inset 0 0 0 0.5px var(--mac-separator)}
.stage{padding:16px;border-radius:12px;background:repeating-linear-gradient(45deg,#ff383c 0 28px,#0088ff 28px 56px,#34c759 56px 84px,#ffcc00 84px 112px)}
.tile{display:flex;flex-direction:column;gap:4px}.stage code{color:#fff;text-shadow:0 1px 2px #000}
.sample{height:44px;border-radius:12px}
</style>${panel('light')}${panel('dark')}`;
}
