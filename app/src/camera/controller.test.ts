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
  await vi.advanceTimersByTimeAsync(0);
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

test('device selection while off is inert; switching active capture releases it before acquiring the next', async () => {
  const h = harness();
  h.controller.selectDevice('usb');
  expect(h.deps.acquire).not.toHaveBeenCalled();
  await h.controller.start();
  expect(h.deps.acquire).toHaveBeenLastCalledWith('usb');
  h.controller.selectDevice('built-in');
  expect(h.track.stop).toHaveBeenCalledOnce();
  expect(h.source.dispose).toHaveBeenCalledOnce();
  expect(h.deps.acquire).toHaveBeenLastCalledWith('built-in');
  expect(h.track.stop.mock.invocationCallOrder[0]).toBeLessThan(h.deps.acquire.mock.invocationCallOrder[1]);
  await vi.advanceTimersByTimeAsync(0);
  expect(h.controller.state).toMatchObject({ deviceId: 'built-in', status: 'active' });
  h.controller.stop();
});
test('rapid choices discard old permission grants and keep only the latest selection', async () => {
  const h = harness();
  const first = deferred<MediaStream>();
  const second = deferred<MediaStream>();
  h.deps.acquire.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const start = h.controller.start();
  h.controller.selectDevice('second');
  h.controller.selectDevice('third');
  await vi.advanceTimersByTimeAsync(0);
  expect(h.controller.state).toMatchObject({ deviceId: 'third', status: 'active' });
  const discarded = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
  const stop = vi.fn();
  const late = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  first.resolve(late);
  second.resolve(discarded);
  await start;
  await vi.advanceTimersByTimeAsync(0);
  expect(stop).toHaveBeenCalledOnce();
  expect(h.deps.begin).toHaveBeenCalledOnce();
  expect(h.controller.state).toMatchObject({ deviceId: 'third', status: 'active' });
  h.controller.stop();
});
test('native session transitions are ordered through late begins and slow ends', async () => {
  const h = harness();
  const firstBegin = deferred<string>();
  const firstEnd = deferred<void>();
  h.deps.begin.mockReturnValueOnce(firstBegin.promise).mockResolvedValue('latest');
  h.deps.end.mockReturnValueOnce(firstEnd.promise);
  const start = h.controller.start();
  await vi.advanceTimersByTimeAsync(0);
  h.controller.selectDevice('second');
  await vi.advanceTimersByTimeAsync(0);
  expect(h.deps.begin).toHaveBeenCalledOnce();
  firstBegin.resolve('obsolete');
  await vi.advanceTimersByTimeAsync(0);
  expect(h.deps.end).toHaveBeenCalledWith('obsolete');
  expect(h.deps.begin).toHaveBeenCalledOnce();
  h.controller.selectDevice('latest');
  firstEnd.resolve();
  await start;
  await vi.advanceTimersByTimeAsync(0);
  expect(h.deps.begin).toHaveBeenCalledTimes(2);
  expect(h.deps.submit.mock.calls[0][0].sessionToken).toBe('latest');
  expect(h.controller.state.deviceId).toBe('latest');
  h.controller.stop();
});
test('enumeration refreshes labels on grant and devicechange; unsubscribe drops late results', async () => {
  const h = harness();
  const enumerate = vi.fn(async () => [{ deviceId: 'usb', label: '' }]);
  let changed = () => {};
  const unwatch = vi.fn();
  const controller = new CameraController({
    ...h.deps,
    enumerate,
    watchDevices: (callback) => {
      changed = callback;
      return unwatch;
    },
  });
  const detach = controller.watchDevices();
  await vi.advanceTimersByTimeAsync(0);
  expect(controller.state.devices).toEqual([{ deviceId: 'usb', label: '' }]);
  expect(h.deps.acquire).not.toHaveBeenCalled();
  enumerate.mockResolvedValue([{ deviceId: 'usb', label: 'Desk camera' }]);
  await controller.start();
  expect(controller.state.devices[0].label).toBe('Desk camera');
  enumerate.mockResolvedValue([]);
  changed();
  await vi.advanceTimersByTimeAsync(0);
  expect(controller.state.devices).toEqual([]);
  expect(h.deps.acquire).toHaveBeenCalledOnce();
  const late = deferred<{ deviceId: string; label: string }[]>();
  enumerate.mockReturnValue(late.promise);
  changed();
  detach();
  late.resolve([{ deviceId: 'late', label: 'No longer watched' }]);
  await vi.advanceTimersByTimeAsync(0);
  expect(unwatch).toHaveBeenCalledOnce();
  expect(controller.state.devices).toEqual([]);
  controller.stop();
});
