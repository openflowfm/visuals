import { afterEach, expect, test, vi } from 'vitest';
import { VideoPackets } from './video-packets';
afterEach(() => vi.unstubAllGlobals());
test('one prefetched packet stays bounded until consumed', async () => {
  const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
  vi.stubGlobal('fetch', fetcher);
  const packets = new VideoPackets((after) => `video?after=${after}`);
  packets.prefetch('1');
  packets.prefetch('2');
  packets.prefetch('3');
  expect(fetcher).toHaveBeenCalledOnce();
  const first = await packets.take('4');
  expect(first.buffer.byteLength).toBe(3);
  expect(fetcher).toHaveBeenCalledOnce();
  packets.prefetch('5');
  expect(fetcher).toHaveBeenCalledTimes(2);
  await packets.dispose();
});
test('dispose aborts and drains in-flight prefetch before returning', async () => {
  let aborted = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('aborted'));
          });
        }),
    ),
  );
  const packets = new VideoPackets(() => '/video');
  packets.prefetch('0');
  await packets.dispose();
  expect(aborted).toBe(true);
  await expect(packets.take('0')).rejects.toThrow('stopped');
});
test('prefetch errors are retained for consumer and dispose safely discards failure', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('Transport failed');
    }),
  );
  const packets = new VideoPackets(() => '/video');
  packets.prefetch('0');
  await Promise.resolve();
  await expect(packets.take('0')).rejects.toThrow('Transport failed');
  await packets.dispose();
});
