// Home's small grey text against the surfaces it sits on (decisions 68 and 69):
// --caption on --surface-0 and -1, and --caption-raised on the raised surfaces,
// each at 4.5:1 or better (WCAG AA for small text), worked out from the tokens in
// home.css; and every rule in Home's stylesheets that paints a raised surface sits
// under one of the selectors home.css gives the raised caption.
//
// Since decision 69 the main window is frosted glass and most surfaces are faint
// tints, so what text sits on depends on the material and on what is behind the
// window. The worst case is a light desktop behind the frost. Nobody can measure
// the real frost from here (macOS draws it), so each material's lightest is an
// estimate of the dark appearance over a white desktop, rounded up for margin:
//
// - hud (the default), under-window, window, content, header: the dense, dark
//   materials, about #2a2a2a (under-window) to #363636 (hud) over white; checked
//   at #3c3c3c. These take home.css's own captions.
// - sidebar, fullscreen-ui, popover, menu: thinner, more of the desktop through,
//   about #444444; checked at #4a4a4a, with the brighter captions home.css gives
//   them under `:root[data-frost=…]` (set by VISUALS_FROST in a dev run).
// - glass (macOS 26's regular Liquid Glass): lighter again, about #4c4c4c;
//   checked at #555555, with brighter captions still.
// - glass-clear: lets the desktop through almost as it is, so no grey caption is
//   safe on it; it takes glass's captions and is for comparing only, not checked.
//
// Every material's darkest, over a dark desktop (and solid with "Reduce
// transparency" on), is about #1e1e1e. Each surface is laid over the material,
// as the page stacks them, before the ratio is taken, with the tints as shipped
// (VISUALS_FROST_TINT under 1 is a dev comparison, and lighter). Popovers, menus
// and a dragged tile are glass over the grid: their fill is checked over a white
// picture under the blur, the worst they can float over.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(here, file), 'utf8');
const uncomment = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const home = read('home.css');
const palette = readFileSync(join(here, '../../node_modules/@openflow/widgets/src/palette.css'), 'utf8');

const DARKEST = '#1e1e1e';
/** Each frost VISUALS_FROST offers but glass-clear, with its lightest in the dark appearance (above); the default first. */
const FROSTS: [string, string][] = [
  ['hud', '#3c3c3c'],
  ['under-window', '#3c3c3c'],
  ['window', '#3c3c3c'],
  ['content', '#3c3c3c'],
  ['header', '#3c3c3c'],
  ['sidebar', '#4a4a4a'],
  ['fullscreen-ui', '#4a4a4a'],
  ['popover', '#4a4a4a'],
  ['menu', '#4a4a4a'],
  ['glass', '#555555'],
];

/** The declarations home.css makes for frost `frost` under `:root[data-frost=…]`, or none. */
function frostBlock(frost: string | undefined): string {
  if (!frost) return '';
  for (const [, selectors, body] of uncomment(home).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selectors.split(',').some((s) => s.trim().startsWith(`:root[data-frost='${frost}']`))) return body;
  }
  return '';
}

/** A token's value as declared (frost `frost`'s own block, home.css, then the widgets' palette), with `var()`s followed. */
function token(name: string, frost?: string): string {
  for (const css of [frostBlock(frost), home, palette]) {
    const m = css.match(new RegExp(`${name}:\\s*([^;]+);`));
    if (!m) continue;
    const value = m[1].trim();
    const ref = value.match(/^var\((--[\w-]+)\)$/);
    return ref ? token(ref[1], frost) : value;
  }
  throw new Error(`no ${name}`);
}

type Rgba = [number, number, number, number];
type Rgb = [number, number, number];

/** A `#rrggbb`, `rgb(r, g, b)` or `rgba(r, g, b, a)` colour, channels 0–255 and alpha 0–1. */
function parse(colour: string): Rgba {
  const hex = colour.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [...[0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)), 1] as Rgba;
  const rgb = colour.match(/^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3], rgb[4] === undefined ? 1 : +rgb[4]];
  throw new Error(`not a colour this test reads: ${colour}`);
}

/** The opaque colour of `layers` (tokens, bottom to top) painted over `backdrop`. */
function over(backdrop: string, layers: string[]): Rgb {
  let [r, g, b] = parse(backdrop);
  for (const name of layers) {
    const [lr, lg, lb, a] = parse(token(name));
    [r, g, b] = [r + (lr - r) * a, g + (lg - g) * a, b + (lb - b) * a];
  }
  return [r, g, b];
}

/** WCAG relative luminance. */
function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((c) => c / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Text in token `text` (as frost `frost` has it) over `layers` over `backdrop`. */
const ratio = (text: string, layers: readonly string[], backdrop: string, frost?: string) => {
  const [hi, lo] = [luminance(parse(token(text, frost)).slice(0, 3) as Rgb), luminance(over(backdrop, [...layers]))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('caption contrast on every surface, over every frost', () => {
  // Where each surface sits: the window's areas on the frost; chips, fields and
  // tracks on an area; pictures' backings on an area; menu items on a popover,
  // which floats over the grid (a white picture, blurred, at worst).
  const window: [string, string[]][] = [
    ['--caption', ['--surface-0']],
    ['--caption', ['--surface-1']],
    ['--caption-raised', ['--surface-0', '--surface-2']],
    ['--caption-raised', ['--surface-1', '--surface-2']],
    ['--caption-raised', ['--surface-0', '--surface-3']],
    ['--caption-raised', ['--surface-1', '--surface-3']],
    ['--caption-raised', ['--surface-0', '--surface-thumb']],
  ];
  const floating: [string, string[]][] = [
    ['--caption-raised', ['--surface-float']],
    ['--caption-raised', ['--surface-float', '--surface-3']],
  ];
  const cases = FROSTS.flatMap(([frost, lightest]) => [
    ...[DARKEST, lightest].flatMap((material) => window.map(([text, layers]) => [frost, text, layers.join(' on '), material, layers] as const)),
    ...floating.map(([text, layers]) => [frost, text, layers.join(' on '), '#ffffff', layers] as const),
  ]);
  it.each(cases)('%s: %s over %s over %s is at least 4.5:1', (frost, text, _, backdrop, layers) => {
    expect(token(text, frost)).toMatch(/^#[0-9a-f]{6}$/i);
    expect(ratio(text, layers, backdrop, frost)).toBeGreaterThanOrEqual(4.5);
  });

  it('would catch the plain caption on a raised surface over the light frost (the check itself)', () => {
    expect(ratio('--caption', ['--surface-1', '--surface-3'], FROSTS[0][1])).toBeLessThan(4.5);
  });

  it('gives the lighter frosts brighter captions than the default’s, and glass-clear glass’s', () => {
    const lum = (text: string, frost?: string) => luminance(parse(token(text, frost)).slice(0, 3) as Rgb);
    for (const frost of ['sidebar', 'glass']) {
      expect(lum('--caption', frost), frost).toBeGreaterThan(lum('--caption'));
      expect(lum('--caption-raised', frost), frost).toBeGreaterThan(lum('--caption-raised'));
    }
    expect(token('--caption', 'glass-clear')).toBe(token('--caption', 'glass'));
  });

  it('lets the frost through the window’s surfaces and the glass’s fill, and keeps the preview’s corners opaque', () => {
    for (const name of ['--surface-0', '--surface-1', '--surface-2', '--surface-3', '--surface-float', '--surface-thumb']) expect(parse(token(name))[3], name).toBeLessThan(1);
    expect(parse(token('--surface-corner'))[3]).toBe(1);
    // The window's tints are faint, so the material carries the look.
    for (const name of ['--surface-0', '--surface-1', '--surface-2', '--surface-3']) expect(parse(token(name))[3], name).toBeLessThanOrEqual(0.1);
  });

  it('blurs what is under every glass surface: popovers, menus and a dragged tile', () => {
    expect(token('--glass')).toMatch(/blur\(\d+px\)/);
    for (const [file, selector] of [
      ['popover.css', '.vf-pop-panel'],
      ['home.css', '.home-ghost'],
    ]) {
      const body = uncomment(read(file)).match(new RegExp(`(?:^|\\})\\s*${selector.replace(/\./g, '\\.')} \\{([^}]*)\\}`))![1];
      expect(body, file).toContain('background: var(--surface-float);');
      expect(body, file).toContain('-webkit-backdrop-filter: var(--glass);');
      expect(body, file).toContain('\n  backdrop-filter: var(--glass);');
    }
  });

  it('scales the same tints by VISUALS_FROST_TINT', () => {
    const block = uncomment(home).match(/:root\[data-frost-tint\] \.app\.home \{([^}]*)\}/);
    expect(block).not.toBeNull();
    for (const name of ['--surface-0', '--surface-1', '--surface-2', '--surface-3']) {
      const [r, g, b, a] = parse(token(name));
      expect(block![1], name).toContain(`${name}: rgba(${r}, ${g}, ${b}, calc(${a} * var(--frost-tint)));`);
    }
  });

  it('gives the raised caption to every rule that paints a raised surface', () => {
    const block = home.match(/((?:\.app\.home [^,{]+,\s*)*\.app\.home [^,{]+)\{\s*--caption: var\(--caption-raised\);/);
    expect(block).not.toBeNull();
    const raised = block![1].split(',').map((s) => s.trim().replace(/^\.app\.home /, ''));
    const sheets = ['home.css', 'tile.css', 'nowpanel.css', 'homebar.css', 'playlisthead.css', 'sources.css', 'popover.css', 'library.css'];
    const uncovered: string[] = [];
    for (const file of sheets) {
      const css = uncomment(read(file));
      for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!/background:\s*var\(--surface-(2|3|float|thumb)\)/.test(body)) continue;
        for (const s of selectors.split(',').map((x) => x.trim())) if (!raised.some((r) => s.includes(r))) uncovered.push(`${file}: ${s}`);
      }
    }
    expect(uncovered).toEqual([]);
  });
});

describe('the preview’s corners over the frost (decision 69)', () => {
  it('are painted over the native view at each hole’s own radius, once it draws', () => {
    const css = uncomment(home);
    const rule = css.match(/([^{}]+)\{([^{}]*var\(--surface-corner\)[^{}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1].split(',').map((s) => s.trim())).toEqual(['.home .now-preview:not([data-loading])::before', '.home .home-bar-mini:not([data-loading])::before']);
    expect(rule![2]).toContain('--r: var(--hole-radius)');
    for (const [file, hole] of [
      ['nowpanel.css', '.now-panel .now-preview'],
      ['homebar.css', '.home-bar .home-bar-mini'],
    ]) {
      const body = read(file).match(new RegExp(`${hole.replace(/\./g, '\\.')} \\{([^}]*)\\}`))![1];
      expect(body, file).toMatch(/--hole-radius: \d+px;/);
      expect(body, file).toContain('border-radius: var(--hole-radius);');
    }
  });
});
