import { describe, expect, it } from 'vitest';
import { NONE_SEEN, newest, notes, readSeen, SEEN_KEY, shown, toOffer, writeSeen, type Report } from './CrashPrompt.tsx';
import { say } from './words.ts';

const report = (id: string, when: number, sent = false, text = ''): Report => ({ id, when, summary: `summary ${id}`, sent, text });

describe('the crash prompt', () => {
  it('offers unsent reports not yet seen, newest first', () => {
    const reports = [report('a', 10), report('b', 30), report('c', 20, true), report('d', 5)];
    expect(toOffer(reports, { when: 8, ids: [] }).map((r) => r.id)).toEqual(['b', 'a']);
    expect(toOffer(reports, { when: 30, ids: ['b'] })).toEqual([]);
  });

  it('still offers a report from the same second as the last one seen', () => {
    const seen = newest([report('a', 30)], NONE_SEEN);
    expect(seen).toEqual({ when: 30, ids: ['a'] });
    expect(toOffer([report('a', 30), report('b', 30)], seen).map((r) => r.id)).toEqual(['b']);
    expect(newest([report('b', 30)], seen)).toEqual({ when: 30, ids: ['a', 'b'] });
  });

  it('remembers the newest report it has passed', () => {
    expect(newest([report('a', 10), report('b', 30)], { when: 12, ids: [] })).toEqual({ when: 30, ids: ['b'] });
    expect(newest([], { when: 12, ids: [] })).toEqual({ when: 12, ids: [] });
  });

  it('asks the user to read the text before submitting it, and counts earlier crashes', () => {
    const said = notes(0);
    expect(said.check).toBe(say('crash report check'));
    expect(said.check).toMatch(/^Read the text before you submit it/);
    expect(said.check).toMatch(/device|display/);
    expect(said.earlier).toBeNull();
    expect(notes(1).earlier).toMatch(/^One earlier crash is kept/);
    expect(notes(3).earlier).toMatch(/^3 earlier crashes are kept/);
  });

  it('shows the whole text, or the summary when there is none', () => {
    expect(shown(report('a', 1, false, 'Version: 0.9.0\n'))).toBe('Version: 0.9.0');
    expect(shown(report('a', 1))).toBe('summary a');
  });

  it('keeps what it has seen, and reads nothing seen when storage fails', () => {
    const kept = new Map<string, string>();
    const store = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) };
    expect(readSeen(store)).toEqual(NONE_SEEN);
    writeSeen({ when: 42, ids: ['x'] }, store);
    expect(readSeen(store)).toEqual({ when: 42, ids: ['x'] });
    kept.set(SEEN_KEY, '17');
    expect(readSeen(store)).toEqual({ when: 17, ids: [] });
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readSeen(broken)).toEqual(NONE_SEEN);
    expect(() => writeSeen(NONE_SEEN, broken)).not.toThrow();
    expect(readSeen(undefined)).toEqual(NONE_SEEN);
  });
});
