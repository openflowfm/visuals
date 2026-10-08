import { describe, expect, it } from 'vitest';
import { afterCheck, day } from './Update.tsx';

const update = { version: '0.3.1', notes: 'Faster previews.', date: '2026-10-08 6:00:00.0 +00:00:00' };

describe('afterCheck', () => {
  it('shows an update whether or not anyone asked', () => {
    expect(afterCheck({ update }, false)).toEqual({ kind: 'found', update });
    expect(afterCheck({ update }, true)).toEqual({ kind: 'found', update });
  });

  it('keeps quiet on launch when there is nothing to say', () => {
    expect(afterCheck({ update: null }, false)).toEqual({ kind: 'idle' });
    expect(afterCheck({ error: "Updates aren't set up in this build." }, false)).toEqual({ kind: 'idle' });
    expect(afterCheck({ error: "Couldn't check for updates: offline" }, false)).toEqual({ kind: 'idle' });
  });

  it('answers someone who asked', () => {
    expect(afterCheck({ update: null }, true)).toEqual({ kind: 'latest' });
    expect(afterCheck({ error: "Updates aren't set up in this build." }, true)).toEqual({ kind: 'said', message: "Updates aren't set up in this build." });
  });
});

describe('day', () => {
  it('keeps the date and drops the time', () => {
    expect(day(update.date)).toBe('2026-10-08');
    expect(day('2026-10-08T06:00:00Z')).toBe('2026-10-08');
  });

  it('is null without a date it can read', () => {
    expect(day(null)).toBeNull();
    expect(day('yesterday')).toBeNull();
  });
});
