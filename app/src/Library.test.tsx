import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LibraryRow, Mine } from './api.ts';
import { prepareRow } from './librarySearch.ts';
import { chipSays, findSays, groupSays, groupTitle, valueSays, Values } from './Library.tsx';
import { PresetDrawer, pressedFor } from './PresetDrawer.tsx';

const row = (key: string): LibraryRow => ({ key, path: `/p/${key}`, hash: '', style: 'A', sub_style: null, authors: [], title: key, thumbnail: null, look: null, starter: false });
const p = (key: string, mine?: Mine) => prepareRow(row(key), mine);
const none = () => {};

/** Every attribute `name` in `html`, in order. */
const attrs = (html: string, name: string) => [...html.matchAll(new RegExp(`${name}="([^"]*)"`, 'g'))].map((m) => m[1]);

describe('the library chips, read aloud', () => {
  it('names the star group in words, not ★', () => {
    expect(groupSays('star')).toBe('starred');
    expect(chipSays('star', 0)).toBe('starred');
    expect(chipSays('style', 2)).toBe('style, 2 picked');
  });

  it('says a value with its count, without the ★', () => {
    expect(valueSays('★ starred', 1)).toBe('starred, 1 preset');
    expect(valueSays('A › warm', 1234)).toBe('A › warm, 1,234 presets');
  });

  it('labels each value with its whole name and state, and the group in words', () => {
    const html = renderToStaticMarkup(
      <Values
        group="style"
        values={[
          { value: 'A', count: 3 },
          { value: 'A/warm', count: 1 },
        ]}
        selected={['A/warm']}
        find=""
        onFind={none}
        onPick={none}
      />,
    );
    expect(attrs(html, 'aria-label')).toEqual(['style values', 'A, 3 presets', 'A › warm, 1 preset']);
    expect(attrs(html, 'aria-pressed')).toEqual(['false', 'true']);
  });

  it('names the star group in words on its values', () => {
    const html = renderToStaticMarkup(<Values group="star" values={[{ value: 'yes', count: 2 }]} selected={[]} find="" onFind={none} onPick={none} />);
    expect(attrs(html, 'aria-label')).toEqual(['starred values', 'starred, 2 presets']);
  });
});

describe("the home's filter panel", () => {
  it('finds an author, a style, a tag', () => {
    expect(findSays('author')).toBe('find an author');
    expect(findSays('style')).toBe('find a style');
    expect(findSays('tags')).toBe('find a tag');
    expect(findSays('intensity')).toBe('find an intensity');
    const authors = Array.from({ length: 13 }, (_, i) => ({ value: `a${i}`, count: 1 }));
    const html = renderToStaticMarkup(<Values group="author" values={authors} selected={[]} find="" onFind={none} onPick={none} home />);
    expect(html).toContain('placeholder="find an author"');
    expect(html).toContain('aria-label="find an author"');
  });

  it('names the groups in sentence case', () => {
    expect(groupTitle('style')).toBe('Style');
    expect(groupTitle('star')).toBe('★ Starred');
    expect(groupTitle('tags')).toBe('My tags');
  });

  it("puts a picked style's sub-styles on their own line, under the style", () => {
    const values = [
      { value: 'A', count: 3 },
      { value: 'A/warm', count: 1 },
      { value: 'B', count: 2 },
      { value: 'B/cold', count: 2 },
    ];
    const html = renderToStaticMarkup(<Values group="style" values={values} selected={['A']} find="" onFind={none} onPick={none} home />);
    expect(attrs(html, 'aria-label')).toEqual(['style values', 'A, 3 presets', 'B, 2 presets', 'in A', 'A › warm, 1 preset']);
    expect(html).toContain('<span class="lib-values-in">In A</span>');
  });

  it("never cuts off a picked style's sub-styles, however many values come before them", () => {
    // 160 styles, more than the 150 an open group lists, then Z's 3 sub-styles, which sort last.
    const styles = Array.from({ length: 160 }, (_, i) => ({ value: `S${String(i).padStart(3, '0')}`, count: 1 }));
    const values = [...styles, { value: 'Z', count: 3 }, ...['a', 'b', 'c'].map((s) => ({ value: `Z/${s}`, count: 1 }))];
    const html = renderToStaticMarkup(<Values group="style" values={values} selected={['Z']} find="" onFind={none} onPick={none} home />);
    const labels = attrs(html, 'aria-label');
    expect(labels.slice(-4)).toEqual(['in Z', 'Z › a, 1 preset', 'Z › b, 1 preset', 'Z › c, 1 preset']);
    // The cap still holds for the other styles, the picked one past it stays, and the note counts only those left out.
    expect(labels.filter((l) => /^S\d+,/.test(l))).toHaveLength(150);
    expect(labels).toContain('Z, 3 presets');
    expect(html).toContain('10 more: type to find one');
  });
});

describe('the preset drawer, read aloud', () => {
  const drawer = (chosen: ReturnType<typeof p>[], current: string | null = null) =>
    renderToStaticMarkup(<PresetDrawer chosen={chosen} hiddenByFilter={0} playlists={[]} current={current} onSet={none} onLoad={none} onClose={none} error={null} />);

  it('says a toggle is on for all, some or none', () => {
    const star = (x: { star: boolean }) => x.star;
    expect(pressedFor([p('a', { star: true }), p('b', { star: true })], star)).toBe(true);
    expect(pressedFor([p('a', { star: true }), p('b')], star)).toBe('mixed');
    expect(pressedFor([p('a')], star)).toBe(false);
  });

  it('gives the picture, the close and the toggles word names and states', () => {
    const html = drawer([p('a', { star: true, tags: ['warm'] })]);
    expect(html).toContain('aria-label="close, let go of the selection"');
    expect(html).toContain('aria-label="play a"');
    expect(html).toMatch(/aria-label="star" aria-pressed="true"/);
    expect(html).toMatch(/aria-label="never play" aria-pressed="false"/);
    expect(html).toContain('aria-label="take the tag warm off"');
    expect(html).toMatch(/role="group" aria-label="tags"/);
    expect(html).toMatch(/<span aria-hidden="true">★<\/span>/);
  });

  it('says the picture is playing, and a mixed selection is mixed', () => {
    expect(drawer([p('a')], '/p/a')).toContain('aria-label="a, playing"');
    const html = drawer([p('a', { star: true, tags: ['warm'] }), p('b')]);
    expect(html).toMatch(/aria-label="star" aria-pressed="mixed"/);
    expect(html).toContain('aria-label="take the tag warm off (on 1 of 2)"');
  });
});
