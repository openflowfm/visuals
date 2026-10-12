export interface CameraPreset {
  id: string;
  title: string;
  authors: string[];
  thumbnail: string | null;
}
export function stepPreset(items: CameraPreset[], current: string, direction: number) {
  if (!items.length) return null;
  const index = items.findIndex((p) => p.id === current);
  return items[(Math.max(0, index) + direction + items.length) % items.length];
}
/** Serializes requests, skipping obsolete queued choices without interrupting the
 * native preset compiler already in flight. Only the newest result updates UI. */
export class LatestSelection {
  private revision = 0;
  private chain: Promise<void> = Promise.resolve();
  request(action: () => Promise<void>, accepted: () => void, failed: (error: unknown) => void) {
    const revision = ++this.revision;
    this.chain = this.chain.then(async () => {
      if (revision !== this.revision) return;
      try {
        await action();
        if (revision === this.revision) accepted();
      } catch (error) {
        if (revision === this.revision) failed(error);
      }
    });
    return this.chain;
  }
}
