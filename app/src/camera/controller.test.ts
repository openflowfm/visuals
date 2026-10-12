import { afterEach, expect, test, vi } from 'vitest';
import { CameraController, type CameraDependencies, type CaptureSource, type PreparedFrame } from './controller';
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
function harness() {
  vi.useFakeTimers();
  const track = { stop: vi.fn(), onended: null as (() => void) | null, readyState: 'live' };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  const prepared: PreparedFrame = { width: 1, height: 1, paths: [], remainingFreshMs: 123, rgba: new Uint8ClampedArray([30, 50, 70, 255]) };
  const source = { ready: Promise.resolve(), frame: vi.fn(() => prepared as PreparedFrame | null), reset: vi.fn(), dispose: vi.fn() } satisfies CaptureSource;
  const deps = {
    acquire: vi.fn(async () => stream),
    source: vi.fn((_stream: MediaStream, _fail: (error: unknown) => void) => source),
    begin: vi.fn(async () => 'token'),
    end: vi.fn(async () => {}),
    submit: vi.fn(async (frame) => frame.sequence),
    now: () => Date.now(),
  } satisfies CameraDependencies;
  return { controller: new CameraController(deps), deps, source, stream, track, prepared };
}
afterEach(() => vi.useRealTimers());
test('permission is explicit; Stop releases video and rejects late permission grants', async () => {
  const h = harness();
  const permission = deferred<MediaStream>();
  h.deps.acquire.mockReturnValue(permission.promise);
  expect(h.deps.acquire).not.toHaveBeenCalled();
  const start = h.controller.start();
  h.controller.stop();
  permission.resolve(h.stream);
  await start;
  expect(h.track.stop).toHaveBeenCalledOnce();
  expect(h.deps.begin).not.toHaveBeenCalled();
  expect(h.controller.state.status).toBe('off');
});
test('a late native session is invalidated, never resurrecting a stopped camera', async () => {
  const h = harness();
  const begin = deferred<string>();
  h.deps.begin.mockReturnValue(begin.promise);
  const start = h.controller.start();
  await vi.advanceTimersByTimeAsync(0);
  h.controller.stop();
  begin.resolve('late');
  await start;
  expect(h.deps.end).toHaveBeenCalledWith('late');
  expect(h.deps.submit).not.toHaveBeenCalled();
  expect(h.source.dispose).toHaveBeenCalledOnce();
});
test('one ack in flight with no queued captures, default independent opacity and exact freshness', async () => {
  const h = harness();
  const ack = deferred<number>();
  h.deps.submit.mockReturnValue(ack.promise);
  await h.controller.start();
  await vi.advanceTimersByTimeAsync(200);
  expect(h.deps.submit).toHaveBeenCalledOnce();
  expect(h.source.frame).toHaveBeenCalledOnce();
  expect(h.deps.submit.mock.calls[0][0]).toMatchObject({ sequence: 1, remainingFreshMs: 123, cameraOpacity: 0, outlineOpacity: 0.65, feedMix: 0.3 });
  expect(h.deps.submit.mock.calls[0][0]).not.toHaveProperty('rgba');
  h.controller.stop();
  ack.resolve(1);
  await vi.advanceTimersByTimeAsync(200);
  expect(h.deps.submit).toHaveBeenCalledOnce();
  expect(h.deps.end).toHaveBeenCalledWith('token');
  expect(h.controller.state.status).toBe('off');
});
test('permission rejection and track loss stop resources and expose errors', async () => {
  const h = harness();
  h.deps.acquire.mockRejectedValueOnce(new Error('Permission denied'));
  await h.controller.start();
  expect(h.controller.state.message).toBe('Permission denied');
  expect(h.controller.state.status).toBe('failed');
  await h.controller.start();
  h.track.onended?.();
  expect(h.controller.state.status).toBe('failed');
  expect(h.track.stop).toHaveBeenCalled();
  expect(h.source.dispose).toHaveBeenCalled();
  expect(h.deps.end).toHaveBeenCalledWith('token');
});
test('mirror/isolation reset source history and bump epoch; absent fresh frames do not submit', async () => {
  const h = harness();
  await h.controller.start();
  await vi.advanceTimersByTimeAsync(0);
  const epoch = h.deps.submit.mock.calls[0][0].sourceEpoch;
  h.controller.configure({ mirror: false, personOnly: false });
  await vi.advanceTimersByTimeAsync(34);
  expect(h.source.reset).toHaveBeenCalledOnce();
  expect(h.deps.submit.mock.calls[1][0].sourceEpoch).toBe(epoch + 1);
  h.source.frame.mockReturnValue(null);
  const count = h.deps.submit.mock.calls.length;
  await vi.advanceTimersByTimeAsync(1000);
  expect(h.deps.submit).toHaveBeenCalledTimes(count);
  h.controller.stop();
});
test('synchronous mask failure during preparation cannot publish active or submit after Stop', async () => {
  const h = harness();
  h.deps.source.mockImplementation((_stream, fail) => {
    h.source.frame.mockImplementation(() => {
      fail('Mask failed');
      return h.prepared;
    });
    return h.source;
  });
  await h.controller.start();
  await vi.advanceTimersByTimeAsync(100);
  expect(h.controller.state.status).toBe('failed');
  expect(h.deps.submit).not.toHaveBeenCalled();
  expect(h.source.dispose).toHaveBeenCalledOnce();
});
test('restart waits for the previous submit ack; old failure cannot stop a new session', async () => {
  const h = harness();
  const ack = deferred<number>();
  h.deps.submit.mockReturnValueOnce(ack.promise);
  await h.controller.start();
  h.controller.stop();
  const restart = h.controller.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(h.deps.submit).toHaveBeenCalledOnce();
  ack.reject(new Error('old token expired'));
  await restart;
  await vi.advanceTimersByTimeAsync(0);
  expect(h.controller.state.status).toBe('active');
  expect(h.deps.submit).toHaveBeenCalledTimes(2);
  h.controller.stop();
});
