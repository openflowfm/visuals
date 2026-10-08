import { describe, expect, it } from 'vitest';
import { Say, say, WORDS, type Jargon } from './words.ts';

describe('the plain words', () => {
  it('give every term a plain word that uses none of the jargon', () => {
    const terms = Object.keys(WORDS) as Jargon[];
    for (const term of terms) {
      const plain = say(term).toLowerCase();
      expect(plain.length).toBeGreaterThan(0);
      for (const jargon of terms) expect(plain, `${term} → ${plain}`).not.toMatch(new RegExp(`\\b${jargon.toLowerCase()}\\b`));
    }
  });

  it('say the ones the app was asked to', () => {
    expect(say('bench')).toBe('preview');
    expect(say('sensitivity')).toBe('how much it reacts');
    expect(say('hold')).toBe('stay on this one');
    expect(say('the one')).toBe('bar start');
  });

  it('start a sentence with a capital', () => {
    expect(Say('hold')).toBe('Stay on this one');
  });
});
