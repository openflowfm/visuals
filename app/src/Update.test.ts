import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { afterCheck, day, Notes } from './Update.tsx';
import { blocks, inlines } from './notes.ts';

const html = (notes: string) => renderToStaticMarkup(createElement(Notes, { notes }));

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

describe('release notes', () => {
  it('parts paragraphs on blank lines and joins the lines of one', () => {
    expect(blocks('First line\nsame paragraph.\n\nSecond.')).toEqual([
      { kind: 'paragraph', children: [{ kind: 'text', text: 'First line same paragraph.' }] },
      { kind: 'paragraph', children: [{ kind: 'text', text: 'Second.' }] },
    ]);
  });

  it('makes lists of - and * lines, a paragraph before them kept apart', () => {
    expect(blocks('New:\n- one\n* two\n  carried on\n\nAfter.')).toEqual([
      { kind: 'paragraph', children: [{ kind: 'text', text: 'New:' }] },
      { kind: 'list', items: [[{ kind: 'text', text: 'one' }], [{ kind: 'text', text: 'two carried on' }]] },
      { kind: 'paragraph', children: [{ kind: 'text', text: 'After.' }] },
    ]);
  });

  it('reads headings, and Windows line ends', () => {
    expect(blocks('## Fixes\r\n- a')).toEqual([
      { kind: 'heading', children: [{ kind: 'text', text: 'Fixes' }] },
      { kind: 'list', items: [[{ kind: 'text', text: 'a' }]] },
    ]);
  });

  it('reads bold, code and links', () => {
    expect(inlines('**Faster** `bench` [notes](https://example.com/a) and https://example.com/b.')).toEqual([
      { kind: 'bold', children: [{ kind: 'text', text: 'Faster' }] },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'bench' },
      { kind: 'text', text: ' ' },
      { kind: 'link', text: 'notes', href: 'https://example.com/a' },
      { kind: 'text', text: ' and ' },
      { kind: 'link', text: 'https://example.com/b', href: 'https://example.com/b' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('keeps links that are not web links as text', () => {
    expect(inlines('[click](javascript:alert)')).toEqual([{ kind: 'text', text: '[click](javascript:alert)' }]);
    expect(inlines('[file](file:///etc/passwd)')).toEqual([{ kind: 'text', text: '[file](file:///etc/passwd)' }]);
  });

  it('draws them as HTML', () => {
    expect(html('Hi **there**.\n\n- `a`\n- [b](https://example.com)')).toBe(
      '<p>Hi <strong>there</strong>.</p><ul><li><code>a</code></li><li><a href="https://example.com" title="https://example.com">b</a></li></ul>',
    );
  });

  it('escapes markup in the notes rather than drawing it', () => {
    const out = html('<img src=x onerror=alert(1)> **<b>bold</b>** `<script>`\n\n[<i>x</i>](https://example.com/"onmouseover="alert(1))');
    expect(out).not.toMatch(/<img|<b>|<script|<i>/);
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(out).toContain('<strong>&lt;b&gt;bold&lt;/b&gt;</strong>');
    expect(out).toContain('<code>&lt;script&gt;</code>');
    expect(out).toContain('href="https://example.com/&quot;onmouseover=&quot;alert(1"');
  });
});
