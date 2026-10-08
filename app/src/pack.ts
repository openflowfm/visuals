import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

// The presets the app has: the bundled starter set and the full pack's download.
// A stub for now: issue #86 fills in the download (`pack::pack_download`).

/** `pack::State`: where the full pack's download is. */
export type PackState = 'idle' | 'downloading' | 'failed';

/** `pack::PackStatus`. */
export interface PackStatus {
  /** Presets in the bundled starter set. */
  starter: number;
  /** Presets in the presets folder. */
  installed: number;
  /** Presets in the full pack. */
  total: number;
  /** The full pack's download, in bytes. */
  size: number;
  state: PackState;
  /** Bytes downloaded so far. */
  received: number;
  /** Why the last download failed. */
  error: string | null;
}

/** `pack::PROGRESS`. */
export const PROGRESS = 'pack-progress';

export const status = () => invoke<PackStatus>('pack_status');
/** Start downloading the full pack into the presets folder; progress comes on `onProgress`. */
export const download = () => invoke<void>('pack_download');
/** Each step of the download. */
export const onProgress = (f: (s: PackStatus) => void): Promise<UnlistenFn> => listen<PackStatus>(PROGRESS, (e) => f(e.payload));

/** The download's progress, 0–1; 0 before it knows the size. */
export const fraction = (s: PackStatus): number => (s.size > 0 ? Math.min(1, s.received / s.size) : 0);
