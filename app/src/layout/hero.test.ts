import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(here, file), 'utf8');

describe('the hero’s rounded corners', () => {
  it('are rounded natively, so the page paints no opaque corners over the hole', () => {
    const css = read('hero.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.lay \.hero-pic\[data-hole\]:not\(\[data-loading\]\)::before \{\s*content: none;\s*\}/);
  });
});
