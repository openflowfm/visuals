import { describe, expect, it, vi } from 'vitest';
import type { Entry, LibraryQuery } from './api.ts';
import { firstToOpen, followAction, followGrid, gridKey, rereadOn, stepDeck, stepping } from './library.ts';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn((..._args: unknown[]): Promise<unknown> => Promise.resolve(null)) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

describe('following the grid', () => {
  const query: LibraryQuery = { groups: { style: ['Geiss'], author: ['Rovastar'] }, text: 'warm' };

  it('asks the deck to play what the grid shows, from the preset opened, without opening it again', () => {
    expect(followAction(query, '/p/b.milk')).toEqual({ kind: 'query', query, at: '/p/b.milk' });
  });

  it('sends the grid’s filter and the preset to the deck as one live action', () => {
    invoke.mockClear();
    followGrid(query, '/p/b.milk');
    expect(invoke).toHaveBeenCalledWith('act', { action: { kind: 'query', query, at: '/p/b.milk' } });
  });

  it('says nothing when the deck refuses, or outside the app', async () => {
    invoke.mockImplementationOnce(() => Promise.reject(new Error('held')));
    expect(() => followGrid(query, '/p/a.milk')).not.toThrow();
    invoke.mockImplementationOnce(() => {
      throw new TypeError('no Tauri');
    });
    expect(() => followGrid(query, '/p/a.milk')).not.toThrow();
    await Promise.resolve();
  });
});

describe('stepping the deck', () => {
  it('counts a step as in flight until the deck answers, even when it fails', async () => {
    let answer: (v: unknown) => void = () => {};
    invoke.mockImplementationOnce(() => new Promise((r) => (answer = r)));
    const sent = stepDeck({ kind: 'next' });
    expect(stepping()).toBe(true);
    answer(null);
    await sent;
    expect(stepping()).toBe(false);
    invoke.mockImplementationOnce(() => Promise.reject(new Error('held')));
    await expect(stepDeck({ kind: 'next' })).rejects.toThrow('held');
    expect(stepping()).toBe(false);
  });
});

describe('gridKey', () => {
  it('changes when the grid’s contents do, under the same filter (a hidden preset)', () => {
    expect(gridKey(['/a', '/b', '/c'])).not.toBe(gridKey(['/a', '/c']));
    expect(gridKey(['/a', '/b'])).toBe(gridKey(['/a', '/b']));
  });
});

describe('rereadOn', () => {
  it('rereads on each change until stopped, then unsubscribes', async () => {
    let fire = () => {};
    const unlisten = vi.fn();
    const reread = vi.fn();
    const stop = rereadOn((f) => {
      fire = f;
      return Promise.resolve(unlisten);
    }, reread);
    fire();
    fire();
    expect(reread).toHaveBeenCalledTimes(2);
    stop();
    fire();
    expect(reread).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledOnce();
  });
});

const entry = (path: string): Entry => ({
  path,
  name: path
    .split('/')
    .pop()!
    .replace(/\.milk$/, ''),
  group: '',
});
const library = [entry('/p/a.milk'), entry('/p/b.milk'), entry('/p/c.milk')];

describe('firstToOpen', () => {
  it('opens the preset asked for, as the library knows it', () => {
    const known = { ...entry('/p/b.milk'), group: 'Geiss' };
    expect(firstToOpen([library[0], known], '/p/b.milk', 0)).toBe(known);
  });

  it('opens a preset asked for that is not in the library by its path', () => {
    expect(firstToOpen(library, '/elsewhere/x.milk', 0)).toEqual({ path: '/elsewhere/x.milk', name: 'x', group: '' });
  });

  it('picks through the library otherwise, never past its end', () => {
    expect(firstToOpen(library, null, 0)).toBe(library[0]);
    expect(firstToOpen(library, null, 0.5)).toBe(library[1]);
    expect(firstToOpen(library, null, 1)).toBe(library[2]);
  });

  it('opens nothing from an empty library', () => {
    expect(firstToOpen([], null, 0.3)).toBeNull();
  });
});
