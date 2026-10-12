import { expect, test, vi } from 'vitest';
import { LatestSelection, stepPreset } from './preset-browser';
const presets = ['a', 'b', 'c'].map((id) => ({ id, title: id, authors: [], thumbnail: null }));
test('navigation wraps filtered presets and handles empty search', () => {
  expect(stepPreset(presets, 'c', 1)?.id).toBe('a');
  expect(stepPreset(presets, 'a', -1)?.id).toBe('c');
  expect(stepPreset([], 'a', 1)).toBeNull();
});
test('rapid choices drain in-flight request, skip superseded choice, commit newest only', async () => {
  const queue = new LatestSelection();
  const calls: string[] = [];
  const accepted = vi.fn();
  let release!: () => void;
  const first = queue.request(
    async () => {
      calls.push('a');
      await new Promise<void>((r) => (release = r));
    },
    () => accepted('a'),
    vi.fn(),
  );
  await Promise.resolve();
  queue.request(
    async () => {
      calls.push('b');
    },
    () => accepted('b'),
    vi.fn(),
  );
  const last = queue.request(
    async () => {
      calls.push('c');
    },
    () => accepted('c'),
    vi.fn(),
  );
  release();
  await first;
  await last;
  expect(calls).toEqual(['a', 'c']);
  expect(accepted.mock.calls).toEqual([['c']]);
});
