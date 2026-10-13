// The page's type (decision 69): Instrument Sans for UI, titles and numbers,
// bundled beside main.css with its licence so it loads offline, under the name
// zen's `instrument` faces use; numbers take tabular figures rather than a
// monospace. The lab editor is zen's now, so no sheet here sets a monospace.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(here, file), 'utf8');
const sheets = readdirSync(here).filter((f) => f.endsWith('.css'));

/** Each rule's body, by its selector, in a stylesheet (comments dropped). */
const rules = (css: string) => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));

describe('Instrument Sans', () => {
  it('is declared once, in main.css, from a file bundled beside the page, with its licence, and no network fetch', () => {
    const faces = sheets.flatMap((f) =>
      rules(read(f))
        .filter((r) => r.selector === '@font-face' && r.body.includes("'Instrument Sans'"))
        .map(() => f),
    );
    expect(faces).toEqual(['main.css']);
    const face = rules(read('main.css')).find((r) => r.selector === '@font-face')!;
    const src = face.body.match(/url\('([^']+)'\)/)![1];
    expect(src).toMatch(/^\.\/fonts\/.+\.woff2$/);
    expect(existsSync(join(here, src))).toBe(true);
    expect(face.body).toMatch(/font-weight:\s*400 700/);
    expect(existsSync(join(here, 'fonts/OFL.txt'))).toBe(true);
    for (const f of sheets) expect(read(f), f).not.toMatch(/https?:\/\//);
  });

  it('is what main.tsx loads, beside zen', () => {
    const main = read('main.tsx');
    expect(main).toMatch(/import '\.\/main\.css';/);
    expect(main).toMatch(/import '@satoramoto\/zen\/zen\.css';/);
  });

  it('sets numbers in tabular figures wherever a rule picks the numbers face', () => {
    for (const f of sheets)
      for (const r of rules(read(f)).filter((r) => /font-family:\s*var\(--(font-num|mono)\)/.test(r.body))) expect(r.body, `${f}: ${r.selector}`).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it('sets no monospace of its own: the lab editor and its code are zen’s', () => {
    const mono = sheets.filter((f) => /font-family:\s*(var\(--code\)|[^;]*monospace)/.test(read(f).replace(/\/\*[\s\S]*?\*\//g, '')));
    expect(mono).toEqual([]);
  });
});
