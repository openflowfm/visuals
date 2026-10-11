import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { answersFor, appendLabels, countsFor, readLabels, type Label } from './labels.ts';

const at = '2026-10-10T12:00:00.000Z';

function tmp(): string {
  return join(mkdtempSync(join(tmpdir(), 'tags-labels-')), 'labels.json');
}

describe('label storage', () => {
  it('reads a missing file as no labels', () => {
    expect(readLabels(tmp())).toEqual({ version: 1, labels: [] });
  });

  it('appends and saves at once, one label per line', () => {
    const file = tmp();
    appendLabels([{ hash: 'a', tag: 'red', answer: 'yes', at, path: 'A.milk' }], file);
    appendLabels([{ hash: 'b', tag: 'red', answer: 'no', at }], file);
    const text = readFileSync(file, 'utf8');
    expect(text.split('\n').filter((l) => l.includes('"hash"'))).toHaveLength(2);
    expect(readLabels(file).labels.map((l) => l.hash)).toEqual(['a', 'b']);
    expect(JSON.parse(text).labels[0]).toEqual({ hash: 'a', tag: 'red', answer: 'yes', at, path: 'A.milk' });
    // Written through a temporary file of its own, which doesn't stay behind.
    expect(readdirSync(dirname(file))).toEqual(['labels.json']);
  });

  it('refuses a malformed label and leaves the file alone', () => {
    const file = tmp();
    appendLabels([{ hash: 'a', tag: 'red', answer: 'yes', at }], file);
    expect(() => appendLabels([{ hash: 'b', tag: 'red', answer: 'maybe', at } as unknown as Label], file)).toThrow();
    expect(readLabels(file).labels).toHaveLength(1);
  });

  it('refuses to read a broken file', () => {
    const file = tmp();
    writeFileSync(file, JSON.stringify({ version: 1, labels: [{ hash: 'a' }] }));
    expect(() => readLabels(file)).toThrow(/malformed/);
  });

  it('takes the latest answer per preset and tag', () => {
    const labels: Label[] = [
      { hash: 'a', tag: 'red', answer: 'yes', at },
      { hash: 'a', tag: 'blue', answer: 'no', at },
      { hash: 'b', tag: 'red', answer: 'unsure', at },
      { hash: 'a', tag: 'red', answer: 'no', at },
    ];
    expect(answersFor(labels, 'red')).toEqual(
      new Map([
        ['a', 'no'],
        ['b', 'unsure'],
      ]),
    );
    expect(countsFor(labels, 'red')).toEqual({ yes: 0, no: 1, unsure: 1 });
  });
});
