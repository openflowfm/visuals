import { expect, test } from 'vitest';
import { VideoFreshness } from './capture';
test('only new decoded generations refresh freshness; stale observations fail closed', () => {
  const source = new VideoFreshness();
  expect(source.take(0)).toBeNull();
  source.observe(1, 10);
  expect(source.take(20)).toBe(10);
  for (let i = 0; i < 30; i++) {
    source.observe(1, 30 + i);
    expect(source.take(30 + i)).toBeNull();
  }
  source.observe(2, 100);
  expect(source.take(351)).toBeNull();
  source.observe(3, 400);
  expect(source.take(405)).toBe(400);
});
