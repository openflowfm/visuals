import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { seeded } from './backend.ts';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..');

/** The page's own source: no tests, stories, fixtures or the dev bridge. */
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === 'stories' || n === 'dev' ? [] : files(p);
    return /\.tsx?$/.test(n) && !/\.(test|stories)\.tsx?$/.test(n) ? [p] : [];
  });

/** The lab editor's commands: the stories don't show the editor. */
const LAB_ONLY = ['apply', 'default_shader', 'set_value'];

describe("the stories' fake app", () => {
  it('answers every command the page invokes', () => {
    const invoked = new Map<string, string>();
    for (const f of files(src)) for (const m of readFileSync(f, 'utf8').matchAll(/invoke(?:<[^(]*?>)?\(\s*'([a-z_]+)'/g)) invoked.set(m[1], relative(src, f));
    const backend = readFileSync(join(here, 'backend.ts'), 'utf8');
    const handled = new Set([...backend.matchAll(/case '([a-z_]+)':/g)].map((m) => m[1]));
    // The scrape itself works: a few the page is known to send.
    expect([...invoked.keys()]).toEqual(expect.arrayContaining(['library_index', 'playlists', 'act', 'fx_state']));
    const missing = [...invoked].filter(([cmd]) => !handled.has(cmd) && !LAB_ONLY.includes(cmd)).map(([cmd, file]) => `${cmd} (${file})`);
    expect(missing).toEqual([]);
  });

  it('makes up the same values from the same seed', () => {
    const a = seeded(1);
    const b = seeded(1);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect(first.every((n) => n >= 0 && n < 1)).toBe(true);
    expect(seeded(2)()).not.toBe(first[0]);
  });
});
