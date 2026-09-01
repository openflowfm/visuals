import { describe, expect, it } from 'vitest';
import {
  MAX_MODEL_PENDING_DECODES,
  createTextureCache,
  textureEntryKey,
  type DecodedPicture,
  type TextureAdapter,
  type TextureRequest,
} from './modelTextures.ts';

interface Fake {
  id: number;
  srgb: boolean;
  closed: boolean;
}

/** A WebGL stand-in whose decodes finish only when the test says so. */
function fakeAdapter() {
  const waiting: { resolve(): void; reject(error: Error): void }[] = [];
  const freed: Fake[] = [];
  const uploaded: Fake[] = [];
  const closed: number[] = [];
  let serial = 0;
  let failUpload = false;
  const adapter: TextureAdapter<Fake, number> = {
    decode: (_bytes, _mimeType) => new Promise<DecodedPicture<number>>((resolve, reject) => {
      const id = ++serial;
      waiting.push({
        resolve: () => resolve({ image: id, width: 2, height: 2, close: () => closed.push(id) }),
        reject,
      });
    }),
    upload(picture, srgb) {
      if (failUpload) throw new Error('texture exceeds this GPU');
      const made = { id: picture.image, srgb, closed: false };
      uploaded.push(made);
      return made;
    },
    free: (texture) => freed.push(texture),
  };
  const settle = async (count = 1) => {
    // `source` may fetch bytes, so the cache crosses that promise boundary
    // before it asks the adapter to decode them.
    await Promise.resolve();
    for (let at = 0; at < count; at++) waiting.shift()?.resolve();
    // Let the decode, upload and queue pump promises run to completion.
    for (let at = 0; at < 4; at++) await Promise.resolve();
  };
  return { adapter, waiting, freed, uploaded, closed, settle, setFailUpload: (value: boolean) => { failUpload = value; } };
}

const request = (key: string, srgb = true, bytes = 64): TextureRequest => ({
  key,
  srgb,
  mimeType: 'image/png',
  bytes,
  source: () => new Uint8Array([1, 2, 3]),
});

describe('the shared model texture cache', () => {
  it('decodes one picture once for every owner and colour interpretation', async () => {
    const fake = fakeAdapter();
    const cache = createTextureCache(fake.adapter);
    cache.acquire('runner', request('asset:h:0'));
    cache.acquire('watcher', request('asset:h:0'));
    cache.acquire('watcher', request('asset:h:0'));
    cache.acquire('watcher', request('asset:h:0', false));
    expect(cache.stats()).toMatchObject({ textures: 0, decoding: 2, reuse: 1 });
    expect(cache.pendingFor('runner')).toBe(1);
    await fake.settle(2);
    expect(fake.uploaded.map((texture) => texture.srgb)).toEqual([true, false]);
    expect(cache.lookup('asset:h:0', true)?.texture).toBe(fake.uploaded[0]);
    expect(cache.lookup('asset:h:0', false)?.texture).toBe(fake.uploaded[1]);
    expect(cache.stats()).toEqual({ textures: 2, bytes: 128, decoding: 0, reuse: 1 });
    expect(fake.closed).toEqual([1, 2]);
    expect(cache.pendingFor('runner')).toBe(0);

    cache.release('runner');
    expect(cache.stats().textures).toBe(2);
    expect(fake.freed).toEqual([]);
    cache.release('watcher');
    expect(cache.stats()).toEqual({ textures: 0, bytes: 0, decoding: 0, reuse: 1 });
    expect(fake.freed).toHaveLength(2);
    expect(cache.lookup('asset:h:0', true)).toBeNull();
  });

  it('never lets a decode that outlives its last owner become a texture', async () => {
    const fake = fakeAdapter();
    const cache = createTextureCache(fake.adapter);
    cache.acquire('solo', request('asset:h:3'));
    await Promise.resolve();
    expect(fake.waiting).toHaveLength(1);
    cache.release('solo');
    expect(cache.stats().decoding).toBe(0);
    await fake.settle();
    expect(fake.uploaded).toEqual([]);
    expect(fake.closed).toEqual([1]);
    expect(cache.lookup('asset:h:3', true)).toBeNull();
    // A fresh owner asking again starts a fresh decode rather than reviving the old one.
    cache.acquire('later', request('asset:h:3'));
    expect(cache.stats().decoding).toBe(1);
    await fake.settle();
    expect(fake.uploaded).toHaveLength(1);
  });

  it('aborts shared byte work only after its last owner leaves', async () => {
    const fake = fakeAdapter();
    const cache = createTextureCache(fake.adapter);
    const source = { signal: null as AbortSignal | null };
    const pending: TextureRequest = {
      ...request('asset:h:shared'),
      source: (owned) => {
        source.signal = owned;
        return new Promise<Uint8Array>(() => undefined);
      },
    };
    cache.acquire('first', pending);
    cache.acquire('second', pending);
    await Promise.resolve();
    expect(source.signal?.aborted).toBe(false);
    cache.release('first');
    expect(source.signal?.aborted).toBe(false);
    cache.release('second');
    expect(source.signal?.aborted).toBe(true);
    expect(cache.stats().decoding).toBe(0);
  });

  it('bounds concurrent decodes and drops queued work whose owner leaves', async () => {
    const fake = fakeAdapter();
    const cache = createTextureCache(fake.adapter);
    for (let at = 0; at < MAX_MODEL_PENDING_DECODES + 3; at++) cache.acquire('many', request(`asset:h:${at}`));
    await Promise.resolve();
    expect(fake.waiting).toHaveLength(MAX_MODEL_PENDING_DECODES);
    expect(cache.stats().decoding).toBe(MAX_MODEL_PENDING_DECODES + 3);
    cache.keep('many', new Set(Array.from({ length: MAX_MODEL_PENDING_DECODES + 1 }, (_, at) => textureEntryKey(`asset:h:${at}`, true))));
    expect(cache.stats().decoding).toBe(MAX_MODEL_PENDING_DECODES + 1);
    await fake.settle(MAX_MODEL_PENDING_DECODES);
    expect(fake.waiting).toHaveLength(1);
    await fake.settle();
    expect(cache.stats()).toMatchObject({ textures: MAX_MODEL_PENDING_DECODES + 1, decoding: 0 });
    cache.free();
    expect(cache.stats()).toEqual({ textures: 0, bytes: 0, decoding: 0, reuse: 0 });
    expect(fake.freed).toHaveLength(MAX_MODEL_PENDING_DECODES + 1);
  });

  it('keeps an upload failure visible instead of retrying it every frame', async () => {
    const fake = fakeAdapter();
    const cache = createTextureCache(fake.adapter);
    fake.setFailUpload(true);
    cache.acquire('one', request('texture:abc'));
    await fake.settle();
    expect(cache.lookup('texture:abc', true)).toEqual({ texture: null, error: 'texture exceeds this GPU', pending: false });
    expect(cache.pendingFor('one')).toBe(0);
    expect(fake.closed).toEqual([1]);
    cache.acquire('two', request('texture:abc'));
    expect(cache.stats()).toMatchObject({ decoding: 0, reuse: 1 });
  });
});
