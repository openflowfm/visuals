import { expect, test } from 'vitest';
import { OutputMeter } from './output-meter';
test('duplicate native sequence responses count once and skipped generations are not invented', () => {
  const meter = new OutputMeter(0);
  expect(meter.record(100, '1')).toBe(true);
  expect(meter.record(200, '1')).toBe(false);
  expect(meter.record(300, '999')).toBe(true);
  expect(meter.snapshot(1000)).toMatchObject({ verified: true, nativeFps: 2, readsPerSecond: 3, seconds: 1 });
});
test('missing or malformed headers report unverified throughput and preserve safe wide IDs', () => {
  const meter = new OutputMeter(0);
  expect(meter.record(100, '9007199254740993')).toBe(true);
  expect(meter.record(200, '9007199254740994')).toBe(true);
  expect(meter.record(300, null)).toBe(true);
  meter.record(400, 'NaN');
  expect(meter.snapshot(1000)).toMatchObject({ verified: false, readsPerSecond: 4 });
});
test('rolling sample expires old duplicates and unknown data, reset clears prior source', () => {
  const meter = new OutputMeter(0);
  meter.record(100, null);
  for (let i = 1; i <= 600; i++) meter.record(1000 + (i * 1000) / 60, String(i));
  expect(meter.snapshot(11000)).toMatchObject({ verified: true, nativeFps: 60, seconds: 10 });
  meter.reset(11000);
  meter.record(11500, '600');
  expect(meter.snapshot(12000)).toMatchObject({ verified: true, nativeFps: 1, seconds: 1 });
});

test('new or reset measurement warms up before a first frame can imply inflated FPS', () => {
  const meter = new OutputMeter(1000);
  meter.record(1000, '1');
  expect(meter.snapshot(1000).ready).toBe(false);
  meter.record(1016, '2');
  expect(meter.snapshot(1016).ready).toBe(false);
  meter.record(1600, '3');
  expect(meter.snapshot(1600).ready).toBe(true);
  meter.reset(1700);
  meter.record(1700, '4');
  expect(meter.snapshot(1700).ready).toBe(false);
  // A genuinely slow one-frame-per-second source is measurable after a full second.
  expect(meter.snapshot(2700).ready).toBe(true);
});
