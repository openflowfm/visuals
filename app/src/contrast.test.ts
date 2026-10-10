// Home's small grey text against the surfaces it sits on (decisions 68 and 69):
// --caption on --surface-0 and -1, and --caption-raised on the raised surfaces,
// each at 4.5:1 or better (WCAG AA for small text), worked out from the tokens in
// home.css; and every rule in Home's stylesheets that paints a raised surface sits
// under one of the selectors home.css gives the raised caption.
//
// Since decision 69 the main window is frosted and most surfaces are translucent
// tints, so what text sits on depends on what is behind the window. The worst case
// assumed here: a light desktop behind the frost, which the under-window material
// in the dark appearance darkens to about #2a2a2a (its darkest, over a dark
// desktop, is about #1e1e1e; with "Reduce transparency" on it is drawn solid in
// that range). #2a2a2a is an estimate, so the lightest case checked is #333333,
// for margin. Each surface is laid over that material, as the page stacks them,
// before the ratio is taken.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(here, file), 'utf8');
const home = read('home.css');
const palette = readFileSync(join(here, '../../node_modules/@openflow/widgets/src/palette.css'), 'utf8');

/** The frost, darkest and lightest, in the dark appearance. */
const MATERIAL = ['#1e1e1e', '#333333'];

/** A token's value as declared (home.css first, then the widgets' palette), with `var()`s followed. */
function token(name: string): string {
  for (const css of [home, palette]) {
    const m = css.match(new RegExp(`${name}:\\s*([^;]+);`));
    if (!m) continue;
    const value = m[1].trim();
    const ref = value.match(/^var\((--[\w-]+)\)$/);
    return ref ? token(ref[1]) : value;
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

/** The opaque colour of `layers` (tokens, bottom to top) painted over `material`. */
function over(material: string, layers: string[]): Rgb {
  let [r, g, b] = parse(material);
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

/** Text in token `text` over `layers` over `material`. */
const ratio = (text: string, layers: string[], material: string) => {
  const [hi, lo] = [luminance(over('#000000', [text])), luminance(over(material, layers))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('caption contrast on every surface, over the frost', () => {
  // Where each surface sits: the window's areas on the frost; chips, fields and
  // tracks on an area; menu items on a popover; pictures' backings on an area.
  const cases: [string, string[]][] = [
    ['--caption', ['--surface-0']],
    ['--caption', ['--surface-1']],
    ['--caption-raised', ['--surface-0', '--surface-2']],
    ['--caption-raised', ['--surface-1', '--surface-2']],
    ['--caption-raised', ['--surface-0', '--surface-3']],
    ['--caption-raised', ['--surface-1', '--surface-3']],
    ['--caption-raised', ['--surface-float']],
    ['--caption-raised', ['--surface-float', '--surface-3']],
    ['--caption-raised', ['--surface-0', '--surface-thumb']],
  ];
  it.each(MATERIAL.flatMap((m) => cases.map(([text, layers]) => [text, layers.join(' on '), m, layers] as const)))('%s over %s over %s is at least 4.5:1', (text, _, material, layers) => {
    expect(token(text)).toMatch(/^#[0-9a-f]{6}$/i);
    expect(ratio(text, [...layers], material)).toBeGreaterThanOrEqual(4.5);
  });

  it('would catch the plain caption on a raised surface over the light frost (the check itself)', () => {
    expect(ratio('--caption', ['--surface-1', '--surface-3'], MATERIAL[1])).toBeLessThan(4.5);
  });

  it('lets the frost through the window’s surfaces, and keeps popovers and the preview’s corners opaque', () => {
    for (const name of ['--surface-0', '--surface-1', '--surface-2', '--surface-3', '--surface-thumb']) expect(parse(token(name))[3], name).toBeLessThan(1);
    for (const name of ['--surface-float', '--surface-corner']) expect(parse(token(name))[3], name).toBe(1);
  });

  it('gives the raised caption to every rule that paints a raised surface', () => {
    const block = home.match(/((?:\.app\.home [^,{]+,\s*)*\.app\.home [^,{]+)\{\s*--caption: var\(--caption-raised\);/);
    expect(block).not.toBeNull();
    const raised = block![1].split(',').map((s) => s.trim().replace(/^\.app\.home /, ''));
    const sheets = ['home.css', 'tile.css', 'nowpanel.css', 'homebar.css', 'playlisthead.css', 'sources.css', 'popover.css', 'library.css'];
    const uncovered: string[] = [];
    for (const file of sheets) {
      const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
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
    const css = home.replace(/\/\*[\s\S]*?\*\//g, '');
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
