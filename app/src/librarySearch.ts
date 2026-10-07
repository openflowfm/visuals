import type { Entry } from './api.ts';

/** The most rows the library draws at once; past this, keep typing. */
export const CAP = 400;

export interface Found {
  shown: Entry[];
  matched: number;
  total: number;
}

/** Entries matching every word of `query` (case-insensitive, against `${group} ${name}`), at most `cap` of them. */
export function searchLibrary(entries: Entry[], query: string, cap: number = CAP): Found {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = words.length
    ? entries.filter((e) => {
        const text = `${e.group} ${e.name}`.toLowerCase();
        return words.every((w) => text.includes(w));
      })
    : entries;
  return { shown: hits.slice(0, cap), matched: hits.length, total: entries.length };
}

const count = (n: number) => n.toLocaleString('en-US');

/** The summary line under the search box, or null when nothing needs saying. */
export function foundSummary(found: Found, query: string): string | null {
  const q = query.trim();
  if (found.matched === 0 && q) return `no presets match “${q}”`;
  if (found.matched > found.shown.length) return `showing ${count(found.shown.length)} of ${count(found.matched)} — keep typing`;
  return null;
}

const PAGE = 10;

/**
 * Next row index for a key in a list of `length` rows from `at` (-1 = none focused):
 * ArrowDown/ArrowUp ±1 clamped, Home/End, PageDown/PageUp ±10; null for any other key.
 * From -1 every movement lands on a real row (ArrowDown → 0); an empty list gives -1.
 */
export function rowFor(key: string, at: number, length: number): number | null {
  let next: number;
  switch (key) {
    case 'ArrowDown': next = at + 1; break;
    case 'ArrowUp': next = at < 0 ? 0 : at - 1; break;
    case 'PageDown': next = at < 0 ? 0 : at + PAGE; break;
    case 'PageUp': next = at - PAGE; break;
    case 'Home': next = 0; break;
    case 'End': next = length - 1; break;
    default: return null;
  }
  if (length <= 0) return -1;
  return Math.max(0, Math.min(length - 1, next));
}
