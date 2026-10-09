/**
 * Release notes, read as the little Markdown they are written in: paragraphs,
 * `-`/`*` lists, `#` headings, `**bold**`, `inline code`, `[links](https://…)`
 * and bare https links. Everything else, raw HTML included, stays the text it
 * is: this only splits the notes into parts, and React escapes every part when
 * it draws them, so release text can't put markup into the app.
 */

/** A run of text inside a paragraph, a heading or a list item. */
export type Inline = { kind: 'text'; text: string } | { kind: 'bold'; children: Inline[] } | { kind: 'code'; text: string } | { kind: 'link'; text: string; href: string };

/** A block of the notes. */
export type Block = { kind: 'paragraph'; children: Inline[] } | { kind: 'heading'; children: Inline[] } | { kind: 'list'; items: Inline[][] };

const BULLET = /^\s*[-*]\s+(.*)$/;
// The closing `#`s are stripped by hand: `(.*?)\s*#*\s*$` backtracks badly on long runs of spaces.
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;

/** A heading's text without its trailing spaces and closing `#`s. */
function headingText(text: string): string {
  let end = text.trimEnd().length;
  while (end > 0 && text[end - 1] === '#') end--;
  return text.slice(0, end).trimEnd();
}

/** Only web links open; anything else (`javascript:`, `file:`) stays text. */
const WEB = /^https?:\/\/[^\s]+$/i;

// `code`, **bold**, [text](url), or a bare http(s) link (trailing punctuation left out).
// Each run is capped at 500 characters so a hostile line can't make matching quadratic.
const INLINE = /`([^`]{1,500})`|\*\*(.{1,500}?)\*\*|\[([^\]]{1,500})\]\(([^)\s]{1,500})\)|(https?:\/\/[^\s<>]{0,500}[^\s<>.,;:!?)\]'"])/gi;

/** The runs of one line of text. */
export function inlines(source: string): Inline[] {
  const out: Inline[] = [];
  const text = (t: string) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last?.kind === 'text') last.text += t;
    else out.push({ kind: 'text', text: t });
  };
  let at = 0;
  for (const m of source.matchAll(INLINE)) {
    const start = m.index ?? 0;
    text(source.slice(at, start));
    at = start + m[0].length;
    const [whole, code, bold, label, href, bare] = m;
    if (code !== undefined) out.push({ kind: 'code', text: code });
    else if (bold !== undefined) out.push({ kind: 'bold', children: inlines(bold) });
    else if (label !== undefined && href !== undefined) {
      if (WEB.test(href)) out.push({ kind: 'link', text: label, href });
      else text(whole);
    } else if (bare !== undefined) out.push({ kind: 'link', text: bare, href: bare });
  }
  text(source.slice(at));
  return out;
}

/** The notes as blocks: blank lines part paragraphs, bullets make lists. */
export function blocks(notes: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  let list: string[] | null = null;
  const flush = () => {
    if (para.length) out.push({ kind: 'paragraph', children: inlines(para.join(' ')) });
    if (list) out.push({ kind: 'list', items: list.map(inlines) });
    para = [];
    list = null;
  };
  for (const raw of notes.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    const bullet = raw.match(BULLET);
    const heading = raw.match(HEADING);
    if (!line) flush();
    else if (bullet) {
      if (para.length) {
        out.push({ kind: 'paragraph', children: inlines(para.join(' ')) });
        para = [];
      }
      (list ??= []).push(bullet[1].trim());
    } else if (heading) {
      flush();
      out.push({ kind: 'heading', children: inlines(headingText(heading[1])) });
    } else if (list) list[list.length - 1] += ` ${line}`;
    else para.push(line);
  }
  flush();
  return out;
}
