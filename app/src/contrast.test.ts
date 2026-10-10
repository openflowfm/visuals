// Home's small grey text against the surfaces it sits on (decision 68): --caption
// on --surface-0 and -1, and --caption-raised on --surface-2 and -3, each at 4.5:1
// or better (WCAG AA for small text), worked out from the tokens in home.css; and
// every rule in Home's stylesheets that paints --surface-2 or -3 sits under one of
// the selectors home.css gives the raised caption.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(here, file), 'utf8');
const home = read('home.css');
const palette = readFileSync(join(here, '../../node_modules/@openflow/widgets/src/palette.css'), 'utf8');

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

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('caption contrast on every surface', () => {
  it.each([
    ['--caption', '--surface-0'],
    ['--caption', '--surface-1'],
    ['--caption-raised', '--surface-2'],
    ['--caption-raised', '--surface-3'],
  ])('%s on %s is at least 4.5:1', (text, surface) => {
    expect(token(text)).toMatch(/^#[0-9a-f]{6}$/i);
    expect(ratio(token(text), token(surface))).toBeGreaterThanOrEqual(4.5);
  });

  it('would catch the plain caption on a raised surface (the check itself)', () => {
    expect(ratio(token('--caption'), token('--surface-3'))).toBeLessThan(4.5);
  });

  it('gives the raised caption to every rule that paints --surface-2 or -3', () => {
    const block = home.match(/((?:\.app\.home [^,{]+,\s*)*\.app\.home [^,{]+)\{\s*--caption: var\(--caption-raised\);/);
    expect(block).not.toBeNull();
    const raised = block![1].split(',').map((s) => s.trim().replace(/^\.app\.home /, ''));
    const sheets = ['home.css', 'tile.css', 'nowpanel.css', 'homebar.css', 'playlisthead.css', 'sources.css', 'popover.css', 'library.css'];
    const uncovered: string[] = [];
    for (const file of sheets) {
      const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
      for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!/background:\s*var\(--surface-[23]\)/.test(body)) continue;
        for (const s of selectors.split(',').map((x) => x.trim())) if (!raised.some((r) => s.includes(r))) uncovered.push(`${file}: ${s}`);
      }
    }
    expect(uncovered).toEqual([]);
  });
});
