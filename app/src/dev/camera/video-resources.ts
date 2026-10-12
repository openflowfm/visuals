/** Process-local ownership counters. Weak tracking never retains a video surface. */
export const videoResources = { decoded: 0, closed: 0, orphaned: 0, decodersOpened: 0, decodersClosed: 0, pendingDecodes: 0 };
const closedFrames = new WeakSet<VideoFrame>();
export function receivedVideoFrame() {
  videoResources.decoded++;
}
export function closeVideoFrame(frame: VideoFrame | null) {
  if (!frame || closedFrames.has(frame)) return;
  frame.close();
  closedFrames.add(frame);
  videoResources.closed++;
}
export function videoResourceSummary() {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number } }).memory;
  const heap = typeof memory?.usedJSHeapSize === 'number' ? `${(memory.usedJSHeapSize / 1048576).toFixed(1)} MiB JS heap` : 'JS heap unavailable';
  return `${heap} · video frames ${videoResources.decoded} decoded / ${videoResources.closed} closed (${videoResources.decoded - videoResources.closed} live, ${videoResources.orphaned} orphaned) · decoders ${videoResources.decodersOpened - videoResources.decodersClosed} live / ${videoResources.decodersOpened} created · decode jobs ${videoResources.pendingDecodes}`;
}
