import { describe, expect, it } from 'vitest';
import { markSeen, NONE_SEEN, notes, readSeen, SEEN_KEY, shown, toOffer, wasSeen, writeSeen, type Report } from './CrashPrompt.tsx';
import { say } from './words.ts';

const report = (id: string, when: number, sent = false, text = ''): Report => ({ id, when, summary: `summary ${id}`, sent, text });

describe('the crash prompt', () => {
  it('offers unsent reports not yet seen, newest first', () => {
    const reports = [report('a', 10), report('b', 30), report('c', 20, true), report('d', 5)];
    expect(toOffer(reports, NONE_SEEN).map((r) => r.id)).toEqual(['b', 'a', 'd']);
    expect(toOffer(reports, { when: 0, ids: ['b', 'a', 'd'] })).toEqual([]);
  });

  it('offers a report older than one already seen', () => {
    const seen = markSeen([report('new', 30)], NONE_SEEN);
    expect(seen).toEqual({ when: 0, ids: ['new'] });
    expect(toOffer([report('new', 30), report('old', 10), report('same', 30)], seen).map((r) => r.id)).toEqual(['same', 'old']);
  });

  it('keeps the reports seen before ids were kept as seen', () => {
    // The old high-water mark: everything before that second, and the ids of that second.
    const legacy = { when: 30, ids: ['b'] };
    expect(wasSeen(report('a', 10), legacy)).toBe(true);
    expect(wasSeen(report('b', 30), legacy)).toBe(true);
    expect(wasSeen(report('c', 30), legacy)).toBe(false);
    expect(wasSeen(report('d', 40), legacy)).toBe(false);
    // Marking more doesn't move the mark on.
    expect(markSeen([report('d', 40)], legacy)).toEqual({ when: 30, ids: ['b', 'd'] });
  });

  it('forgets the ids of reports no longer kept', () => {
    const seen = { when: 0, ids: ['gone', 'a'] };
    expect(markSeen([report('b', 2)], seen, [report('a', 1), report('b', 2)])).toEqual({ when: 0, ids: ['a', 'b'] });
    expect(markSeen([], seen)).toEqual(seen);
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
