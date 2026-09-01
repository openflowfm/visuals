/**
 * Immutable decoded pictures, shared by every model instance and setup that
 * reads them.
 *
 * A GLB's images are part of its content address, so two setups over one
 * asset, or two instances of one setup, must never decode or upload the same
 * bytes twice. The cache is keyed by picture and colour interpretation, counts
 * owners rather than instances, bounds how many decodes run at once, and
 * treats a decode that finishes after its last owner left as garbage rather
 * than as a texture: nothing here can resurrect a freed resource.
 *
 * WebGL is behind an adapter so the ownership, abort and accounting rules are
 * testable without a context.
 */

/** Decodes that may be in flight at once, across every instance. */
export const MAX_MODEL_PENDING_DECODES = 4;

export interface DecodedPicture<I> {
  image: I;
  width: number;
  height: number;
  close(): void;
}

export interface TextureAdapter<T, I> {
  decode(bytes: Uint8Array, mimeType: string): Promise<DecodedPicture<I>>;
  /** Uploads and may throw for a GPU limit; the picture is closed by the cache either way. */
  upload(picture: DecodedPicture<I>, srgb: boolean): T;
  free(texture: T): void;
}

export interface TextureRequest {
  /** Picture identity: `asset:<hash>:<image index>` or `texture:<hash>`. */
  key: string;
  /** Base colour and emissive are sRGB; every other slot is data. Part of the identity. */
  srgb: boolean;
  mimeType: string;
  /** Estimated decoded RGBA bytes with mips, for accounting. */
  bytes: number;
  /** Called at most once per cache entry, by whichever owner arrived first. */
  source: (signal: AbortSignal) => Promise<Uint8Array> | Uint8Array;
}

export interface TextureView<T> {
  texture: T | null;
  error: string | null;
  pending: boolean;
}

export interface TextureStats {
  /** Uploaded GPU textures currently held. */
  textures: number;
  /** Estimated decoded bytes of those textures. */
  bytes: number;
  /** Decodes queued or running. */
  decoding: number;
  /** Acquisitions answered by an entry that already existed. */
  reuse: number;
}

export interface TextureCache<T> {
  /** Ask for a picture on behalf of an owner. Idempotent per owner and key. */
  acquire(owner: string, request: TextureRequest): void;
  /** Keep only these entry keys for an owner, releasing the rest. */
  keep(owner: string, keys: ReadonlySet<string>): void;
  release(owner: string): void;
  lookup(key: string, srgb: boolean): TextureView<T> | null;
  /** Entries this owner holds which have neither uploaded nor failed. */
  pendingFor(owner: string): number;
  stats(): TextureStats;
  free(): void;
}

export const textureEntryKey = (key: string, srgb: boolean): string => `${key}#${srgb ? 'srgb' : 'data'}`;

interface Entry<T> {
  id: string;
  request: TextureRequest;
  owners: Set<string>;
  texture: T | null;
  error: string | null;
  pending: boolean;
  aborted: boolean;
  abort: AbortController;
}

export function createTextureCache<T, I>(adapter: TextureAdapter<T, I>): TextureCache<T> {
  const entries = new Map<string, Entry<T>>();
  const held = new Map<string, Set<string>>();
  const queue: Entry<T>[] = [];
  let running = 0;
  let reuse = 0;

  const finish = (entry: Entry<T>, error: string | null) => {
    entry.pending = false;
    entry.error = error;
  };

  const run = async (entry: Entry<T>) => {
    running += 1;
    let picture: DecodedPicture<I> | null = null;
    try {
      const bytes = await entry.request.source(entry.abort.signal);
      if (entry.aborted) return;
      picture = await adapter.decode(bytes, entry.request.mimeType);
      if (entry.aborted) return;
      entry.texture = adapter.upload(picture, entry.request.srgb);
      finish(entry, null);
    } catch (error) {
      if (!entry.aborted) finish(entry, (error as Error).message);
    } finally {
      picture?.close();
      running -= 1;
      pump();
    }
  };

  const pump = () => {
    while (running < MAX_MODEL_PENDING_DECODES && queue.length) {
      const next = queue.shift()!;
      if (!next.aborted) void run(next);
    }
  };

  const drop = (entry: Entry<T>) => {
    entry.aborted = true;
    entry.abort.abort();
    entries.delete(entry.id);
    const queued = queue.indexOf(entry);
    if (queued >= 0) queue.splice(queued, 1);
    if (entry.texture !== null) {
      adapter.free(entry.texture);
      entry.texture = null;
    }
    entry.pending = false;
  };

  const releaseKey = (owner: string, id: string) => {
    const entry = entries.get(id);
    if (!entry) return;
    entry.owners.delete(owner);
    if (entry.owners.size === 0) drop(entry);
  };

  return {
    acquire(owner, request) {
      const id = textureEntryKey(request.key, request.srgb);
      const mine = held.get(owner) ?? new Set<string>();
      held.set(owner, mine);
      const existing = entries.get(id);
      if (existing) {
        if (!mine.has(id)) reuse += 1;
        existing.owners.add(owner);
        mine.add(id);
        return;
      }
      const entry: Entry<T> = {
        id,
        request,
        owners: new Set([owner]),
        texture: null,
        error: null,
        pending: true,
        aborted: false,
        abort: new AbortController(),
      };
      entries.set(id, entry);
      mine.add(id);
      queue.push(entry);
      pump();
    },
    keep(owner, keys) {
      const mine = held.get(owner);
      if (!mine) return;
      for (const id of [...mine]) {
        if (keys.has(id)) continue;
        mine.delete(id);
        releaseKey(owner, id);
      }
    },
    release(owner) {
      const mine = held.get(owner);
      if (!mine) return;
      held.delete(owner);
      for (const id of mine) releaseKey(owner, id);
    },
    lookup(key, srgb) {
      const entry = entries.get(textureEntryKey(key, srgb));
      return entry ? { texture: entry.texture, error: entry.error, pending: entry.pending } : null;
    },
    pendingFor(owner) {
      let count = 0;
      for (const id of held.get(owner) ?? []) if (entries.get(id)?.pending) count += 1;
      return count;
    },
    stats() {
      let textures = 0;
      let bytes = 0;
      let decoding = 0;
      for (const entry of entries.values()) {
        if (entry.texture !== null) {
          textures += 1;
          bytes += entry.request.bytes;
        }
        if (entry.pending) decoding += 1;
      }
      return { textures, bytes, decoding, reuse };
    },
    free() {
      for (const entry of [...entries.values()]) drop(entry);
      held.clear();
      queue.length = 0;
    },
  };
}
