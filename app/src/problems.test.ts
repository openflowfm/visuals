import { describe, expect, it } from 'vitest';
import { detailOf, openFailed, problem } from './problems.ts';

describe('problem', () => {
  it('keeps what the app said as the detail', () => {
    expect(problem("Couldn't rename the playlist.", 'no playlist abc')).toEqual({ text: "Couldn't rename the playlist.", detail: 'no playlist abc' });
  });

  it('reads an Error and drops an empty or repeated detail', () => {
    expect(problem('x', new Error('boom')).detail).toBe('boom');
    expect(problem('x', '  ').detail).toBeNull();
    expect(problem('x').detail).toBeNull();
    expect(problem('same', 'same').detail).toBeNull();
  });
});

describe('detailOf', () => {
  it('stringifies anything else', () => {
    expect(detailOf({ code: 3 })).toBe('{"code":3}');
    expect(detailOf(null)).toBeNull();
  });
});

describe('openFailed', () => {
  it('names the preset, not its path', () => {
    const p = openFailed('Geiss/Spiral Galaxy.milk', 'shader: line 3: bad token');
    expect(p.text).toBe("Couldn't open Spiral Galaxy — the last preset keeps playing.");
    expect(p.detail).toBe('shader: line 3: bad token');
  });

  it('says something without a path', () => {
    expect(openFailed(null, 'x').text).toBe("Couldn't open that preset.");
  });
});
