import { expect, test, vi } from 'vitest';
import { videoResources, receivedVideoFrame, closeVideoFrame, videoResourceSummary } from './video-resources';
test('weak frame ownership counts successful release once without retaining surfaces', () => {
  const decoded = videoResources.decoded,
    closed = videoResources.closed;
  const frame = { close: vi.fn() } as unknown as VideoFrame;
  receivedVideoFrame();
  closeVideoFrame(frame);
  closeVideoFrame(frame);
  expect(videoResources.decoded - decoded).toBe(1);
  expect(videoResources.closed - closed).toBe(1);
  expect(frame.close).toHaveBeenCalledOnce();
  expect(videoResourceSummary()).toContain('decode jobs');
});
