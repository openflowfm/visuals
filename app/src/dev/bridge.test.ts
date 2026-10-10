import { describe, expect, it, vi } from 'vitest';
import { bridged, createBridge, ERROR_TYPE, tokenFrom } from './bridge.ts';

/** A fetch that answers from `answer` and records what it was sent. */
function fakeFetch(answer: (path: string, body: unknown) => Response) {
  const sent: { path: string; body: unknown; token: string | null }[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? 'null'));
    const token = new Headers(init?.headers).get('x-bridge-token');
    sent.push({ path: String(url), body, token });
    return answer(String(url), body);
  }) as unknown as typeof globalThis.fetch;
  return { fetch, sent };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

describe('the dev bridge shim', () => {
  it('takes the token from the URL, else the one kept', () => {
    expect(tokenFrom('?token=abc', 'old')).toBe('abc');
    expect(tokenFrom('', 'old')).toBe('old');
    expect(tokenFrom('?x=1', null)).toBeNull();
  });

  it("points the app's thumbnail URLs at the bridge, however deep", () => {
    const rows = [{ key: 'k', thumbnail: 'thumb://localhost/starter/cream-of-the-crop/ab.webp', look: { hues: [1] } }, { thumbnail: null }];
    expect(bridged(rows, 't k')).toEqual([{ key: 'k', thumbnail: '/__bridge/thumb/starter/cream-of-the-crop/ab.webp?token=t%20k', look: { hues: [1] } }, { thumbnail: null }]);
  });

  it('sends a command with its token and resolves to its answer', async () => {
    const { fetch, sent } = fakeFetch(() => json([{ thumbnail: 'thumb://localhost/a.webp' }]));
    const b = createBridge({ token: 'tok', fetch, session: 's' });
    await expect(b.internals.invoke('library_index', {})).resolves.toEqual([{ thumbnail: '/__bridge/thumb/a.webp?token=tok' }]);
    expect(sent).toEqual([{ path: '/__bridge/invoke', body: { cmd: 'library_index', args: {}, session: 's', seq: 0 }, token: 'tok' }]);
  });

  it('numbers commands in the order the page sends them, however their answers come back', async () => {
    const answers: ((r: Response) => void)[] = [];
    const sent: unknown[] = [];
    const fetch = vi.fn((_url: string, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      return new Promise<Response>((resolve) => answers.push(resolve));
    }) as unknown as typeof globalThis.fetch;
    const b = createBridge({ token: 'tok', fetch, session: 's' });
    // As `Library.tsx`'s `play()` does: load, then follow the grid, in one tick.
    const load = b.internals.invoke('act', { action: { kind: 'load' } });
    const follow = b.internals.invoke('act', { action: { kind: 'query' } });
    await Promise.resolve();
    expect(sent).toEqual([
      { cmd: 'act', args: { action: { kind: 'load' } }, session: 's', seq: 0 },
      { cmd: 'act', args: { action: { kind: 'query' } }, session: 's', seq: 1 },
    ]);
    answers[1](json('second'));
    answers[0](json('first'));
    await expect(Promise.all([load, follow])).resolves.toEqual(['first', 'second']);
  });

  it("rejects with the command's own error", async () => {
    const { fetch } = fakeFetch(() => new Response(JSON.stringify('no such preset'), { headers: { 'content-type': ERROR_TYPE } }));
    const b = createBridge({ token: 'tok', fetch });
    await expect(b.internals.invoke('open', { path: '/x.milk' })).rejects.toBe('no such preset');
  });

  it('fails on a token the bridge refuses, without trying again', async () => {
    const { fetch, sent } = fakeFetch(() => new Response('the dev bridge wants its token', { status: 403 }));
    const b = createBridge({ token: 'bad', fetch });
    await expect(b.internals.invoke('stats')).rejects.toThrow(/refused the token/);
    expect(sent).toHaveLength(1);
  });

  it('hands a raw answer back as bytes', async () => {
    const { fetch } = fakeFetch(() => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'application/octet-stream' } }));
    const b = createBridge({ token: 'tok', fetch });
    const got = (await b.internals.invoke('previews')) as ArrayBuffer;
    expect([...new Uint8Array(got)]).toEqual([1, 2, 3]);
  });

  it('tells the painter where the bench goes, and still tells the app', async () => {
    const { fetch, sent } = fakeFetch(() => json(null));
    const place = vi.fn();
    const b = createBridge({ token: 'tok', fetch, place, session: 's' });
    await b.internals.invoke('place_bench', { x: 1, y: 2, width: 30, height: 40 });
    expect(place).toHaveBeenCalledWith({ x: 1, y: 2, width: 30, height: 40 });
    expect(sent[0].body).toEqual({ cmd: 'place_bench', args: { x: 1, y: 2, width: 30, height: 40 }, session: 's', seq: 0 });
  });

  it('relays an event once, delivers it to each listener, and stops after unlisten', async () => {
    const { fetch, sent } = fakeFetch(() => json(null));
    const b = createBridge({ token: 'tok', fetch });
    const seen: unknown[] = [];
    const a = b.internals.transformCallback((m) => seen.push(['a', m]));
    const c = b.internals.transformCallback((m) => seen.push(['c', m]));
    const idA = (await b.internals.invoke('plugin:event|listen', { event: 'live', target: { kind: 'Any' }, handler: a })) as number;
    await b.internals.invoke('plugin:event|listen', { event: 'live', target: { kind: 'Any' }, handler: c });
    expect(sent.filter((s) => s.path === '/__bridge/listen')).toEqual([{ path: '/__bridge/listen', body: { event: 'live' }, token: 'tok' }]);
    b.deliver(JSON.stringify({ event: 'live', payload: { n: 1 } }));
    b.deliver(JSON.stringify({ event: 'lists', payload: 2 }));
    expect(seen).toEqual([
      ['a', { event: 'live', id: idA, payload: { n: 1 } }],
      ['c', { event: 'live', id: idA + 1, payload: { n: 1 } }],
    ]);
    b.eventInternals.unregisterListener('live', idA);
    await b.internals.invoke('plugin:event|unlisten', { event: 'live', eventId: idA });
    b.deliver(JSON.stringify({ event: 'live', payload: 3 }));
    expect(seen.at(-1)).toEqual(['c', { event: 'live', id: idA + 1, payload: 3 }]);
    await b.relayAgain();
    expect(sent.filter((s) => s.path === '/__bridge/listen')).toHaveLength(2);
  });

  it("waits while the app behind the bridge isn't up, then gives up", async () => {
    let up = false;
    const refused = () => new Response('not up yet', { status: 503, headers: { 'x-bridge-unreachable': '1' } });
    const { fetch, sent } = fakeFetch(() => (up ? json(7) : refused()));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const b = createBridge({ token: 'tok', fetch, retry: 1, tries: 3 });
    await expect(b.internals.invoke('stats')).rejects.toThrow(/isn't answering/);
    expect(sent).toHaveLength(3);
    up = true;
    await expect(b.internals.invoke('stats')).resolves.toBe(7);
  });

  it('never sends a command again once it may have reached the app', async () => {
    const { fetch, sent } = fakeFetch(() => new Response('', { status: 502 }));
    const b = createBridge({ token: 'tok', fetch, retry: 1, tries: 3 });
    await expect(b.internals.invoke('act', { action: { kind: 'next' } })).rejects.toThrow(/said 502/);
    expect(sent).toHaveLength(1);
    const thrown = createBridge({ token: 'tok', fetch: (() => Promise.reject(new TypeError('network'))) as unknown as typeof globalThis.fetch, retry: 1 });
    await expect(thrown.internals.invoke('stats')).rejects.toThrow('network');
  });

  it('says when the bridge refuses the token for an event too', async () => {
    const { fetch } = fakeFetch(() => new Response('the dev bridge wants its token', { status: 403 }));
    const b = createBridge({ token: 'bad', fetch });
    const handler = b.internals.transformCallback(() => {});
    await expect(b.internals.invoke('plugin:event|listen', { event: 'live', handler })).rejects.toThrow(/refused the token/);
  });
});
