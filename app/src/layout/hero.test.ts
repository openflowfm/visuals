import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(here, file), 'utf8');

describe('the hero’s rounded corners', () => {
  it('are the same radius on the page and on the native view under it', () => {
    const css = read('layout.css').match(/--lay-hero-radius: (\d+)px;/);
    const rust = read('../../src-tauri/src/bench.rs').match(/pub const HERO_RADIUS: f64 = (\d+(?:\.\d+)?);/);
    expect(css).not.toBeNull();
    expect(rust).not.toBeNull();
    expect(Number(rust![1])).toBe(Number(css![1]));
  });

  it('are rounded natively, so the page paints no opaque corners over the hole', () => {
    const css = read('hero.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.lay \.hero-pic\[data-hole\]:not\(\[data-loading\]\)::before \{\s*content: none;\s*\}/);
  });
});
