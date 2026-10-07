import type { Approval, Listed } from './api.ts';

/** Which presets the list shows, by verdict. */
export type Show = 'all' | 'open' | 'approve' | 'reject' | 'noted';
export const SHOWS: { value: Show; label: string }[] = [
  { value: 'all', label: 'all' },
  { value: 'open', label: 'not judged' },
  { value: 'approve', label: 'approved' },
  { value: 'reject', label: 'rejected' },
  { value: 'noted', label: 'with a note' },
];

/** The presets matching every word of `search` (name or folder) and `show`. */
export function filter(presets: Listed[], approvals: Record<string, Approval>, search: string, show: Show): Listed[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  return presets.filter((p) => {
    const a = approvals[p.id];
    if (show === 'open' && a?.verdict) return false;
    if ((show === 'approve' || show === 'reject') && a?.verdict !== show) return false;
    if (show === 'noted' && !a?.note) return false;
    const text = `${p.group} ${p.name}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

/** The preset `by` steps from `current` in `list`, wrapping; the first when `current` is not in it. */
export function step(list: Listed[], current: string | null, by: number): Listed | null {
  if (!list.length) return null;
  const at = list.findIndex((p) => p.path === current);
  if (at < 0) return list[by < 0 ? list.length - 1 : 0];
  return list[(((at + by) % list.length) + list.length) % list.length];
}

/** At most `size` rows to draw around `at`, so a pack of thousands stays quick. */
export function windowAround(length: number, at: number, size: number): [number, number] {
  if (length <= size) return [0, length];
  const start = Math.max(0, Math.min(length - size, (at < 0 ? 0 : at) - Math.floor(size / 2)));
  return [start, start + size];
}
