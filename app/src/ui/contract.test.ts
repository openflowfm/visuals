import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AMBIENT_VARS, packs, toCssVars } from '@satoramoto/zen';

// zen's styling rule (its src/library/library.test.tsx), held over this app's UI: everything
// under app/src/ui reads only the variables zen's contract produces (`toCssVars()`) or ones
// declared here, and has no literal colours or radii and no light-dark().

// Tests run from the repo root.
const dir = join(process.cwd(), 'app/src/ui');
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');
/** Everything the UI draws with: styles and markup; stories and tests excluded. */
const SOURCES = readdirSync(dir, { recursive: true, encoding: 'utf8' })
  .filter((f) => /\.(tsx?|css)$/.test(f) && !/\.(stories|test)\.tsx?$/.test(f))
  .sort();

// zen's scope stylesheet builds these per element; zen's public entry doesn't export them
// (SCOPE_VARS in its contract.ts), so they're spelled out here.
const SCOPE_VARS = ['--mat-lit-glow', '--ambient-light', '--ambient-held'];
const CONTRACT = new Set<string>([...packs.flatMap((p) => ['light', 'dark'].flatMap((m) => Object.keys(toCssVars(p.facets, m as 'light' | 'dark')))), ...SCOPE_VARS, ...AMBIENT_VARS]);

/**
 * Variables zen's layout sets on an assembled screen's slots (layout/assembly), which the UI reads
 * but zen's entry doesn't export by name. Only ever shrinks.
 */
const READ_ALLOWED: Record<string, string> = {
  '--lib-under': "a slot's room under the region pinned above it (`under`), in px",
  '--lib-over': "a slot's room over the region pinned below it (`over`), in px",
  '--lib-panel-inset': "the assembled screen's inset for a panel laid over a column",
};

/**
 * Colour literals with no contract variable to map to, per file, as the number of matches.
 * The count can only go down: a file's matches over its entry fail, and so does an entry over its matches.
 */
const COLOUR_ALLOWED: Record<string, { count: number; why: string }> = {
  'model/librarySearch.ts': { count: 9, why: "the search's colour words' swatches: each is that named colour, not a theme's" },
  'model/inspector-model.ts': { count: 1, why: "a preset's own hue, drawn at that hue" },
  'model/field.ts': { count: 3, why: "the field's data scales (frequency band, style, group): a hue per value, not a theme's" },
  'model/params.ts': { count: 7, why: 'not CSS: `rgba(…)` is the helper that builds MilkDrop colour parameters' },
};

const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe("zen's contract", () => {
  it('the UI only reads contract variables or ones it declares', () => {
    const declared = new Set<string>();
    for (const file of SOURCES) for (const m of read(file).matchAll(/(--[a-z0-9-]+)\s*:/g)) declared.add(m[1]);
    // An inline style declares a variable as a key: { '--x': … }.
    for (const file of SOURCES) for (const m of read(file).matchAll(/['"](--[a-z0-9-]+)['"]\s*[:\]]/g)) declared.add(m[1]);
    const unknown: string[] = [];
    const allowedRead = new Set<string>();
    for (const file of SOURCES)
      for (const m of read(file).matchAll(/var\((--[a-z0-9-]+)/g)) {
        if (CONTRACT.has(m[1]) || declared.has(m[1])) continue;
        if (m[1] in READ_ALLOWED) allowedRead.add(m[1]);
        else unknown.push(`${file} reads ${m[1]}`);
      }
    expect(unknown).toEqual([]);
    // An allowlisted variable nothing reads any more comes off the list.
    expect([...allowedRead].sort()).toEqual(Object.keys(READ_ALLOWED).sort());
  });

  it('the UI contains no literal colours (beyond the allowlist), radii or light-dark()', () => {
    const colours: Record<string, number> = {};
    for (const file of SOURCES) {
      const src = strip(read(file));
      const n = src.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g)?.length ?? 0;
      if (n) colours[file] = n;
      // `0` (no rounding) and `inherit` aren't radii a theme chooses.
      expect(src, `${file} has a literal radius`).not.toMatch(/border-radius:(?!\s*(var\(|0(px)?\s*[;}]|inherit\s*[;}]))/);
      expect(src, `${file} has a literal radius`).not.toMatch(/borderRadius:\s*(?!['"`]?var\(|0\b)/);
      // light-dark() follows a literal color-scheme; zen's scheme comes from var(--scheme).
      expect(src, `${file} uses light-dark()`).not.toMatch(/\blight-dark\(/);
    }
    expect(colours).toEqual(Object.fromEntries(Object.entries(COLOUR_ALLOWED).map(([f, { count }]) => [f, count])));
  });
});
