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
