// The page's type (decision 69): Instrument Sans for UI, titles and numbers,
// bundled beside app.css with its licence so it loads offline; the suite's
// tokens pointed at it; numbers in tabular figures rather than a monospace; and
// a monospace only where the look is code (the lab's .milk text in Recursive,
// the crash report as it would be sent).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(here, file), 'utf8');
const app = read('app.css');
const sheets = readdirSync(here).filter((f) => f.endsWith('.css'));

/** Each rule's body, by its selector, in a stylesheet (comments dropped). */
const rules = (css: string) => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));

describe('Instrument Sans', () => {
  it('is declared from a file bundled beside the page, with its licence, and no network fetch', () => {
    const face = rules(app).find((r) => r.selector === '@font-face' && r.body.includes("'Instrument Sans'"));
    expect(face).toBeDefined();
    const src = face!.body.match(/url\('([^']+)'\)/)![1];
    expect(src).toMatch(/^\.\/fonts\/.+\.woff2$/);
    expect(existsSync(join(here, src))).toBe(true);
    expect(face!.body).toMatch(/font-weight:\s*400 700/);
    expect(existsSync(join(here, 'fonts/OFL.txt'))).toBe(true);
    for (const f of sheets) expect(read(f), f).not.toMatch(/https?:\/\//);
  });

  it('is what the suite tokens and the page tokens name', () => {
    const root = rules(app).find((r) => r.selector === 'html:root')!.body;
    expect(root).toMatch(/--sans:\s*'Instrument Sans'/);
    expect(root).toMatch(/--mono:\s*var\(--sans\)/);
    const home = read('home.css');
    for (const t of ['--font-ui', '--font-display', '--font-num', '--font-mark']) expect(home).toMatch(new RegExp(`${t}:\\s*var\\(--sans\\);`));
  });

  it('sets numbers in tabular figures wherever a rule picks the numbers face', () => {
    for (const f of sheets)
      for (const r of rules(read(f)).filter((r) => /font-family:\s*var\(--(font-num|mono)\)/.test(r.body))) expect(r.body, `${f}: ${r.selector}`).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it('leaves a monospace only where the look is code', () => {
    const mono = sheets.filter((f) => /font-family:\s*(var\(--code\)|[^;]*monospace)/.test(read(f).replace(/\/\*[\s\S]*?\*\//g, '')));
    expect(mono.filter((f) => f !== 'app.css').sort()).toEqual(['crash.css', 'graph.css']);
  });
});
