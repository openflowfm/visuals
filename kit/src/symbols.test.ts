import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { backgroundFor, exportedFile, readSymbols, select, sheetHtml } from './symbols.ts';

/** A made-up kit folder: two pages, symbols and other layers mixed. */
function kitFolder() {
  const dir = mkdtempSync(join(tmpdir(), 'kit-'));
  mkdirSync(join(dir, 'pages'));
  writeFileSync(join(dir, 'document.json'), '{}');
  const master = (id: string, name: string) => ({ _class: 'symbolMaster', do_objectID: id, name });
  writeFileSync(join(dir, 'pages', 'a.json'), JSON.stringify({ layers: [master('S2', 'Toggles - Switches/Light/Content Area/3 Rg/On'), { _class: 'text', do_objectID: 'T', name: 'Title' }] }));
  writeFileSync(
    join(dir, 'pages', 'b.json'),
    JSON.stringify({ layers: [master('S1', 'Toggles - Checkboxes/Dark/Content Area/3 Rg/Checked'), master('S3', 'Toggles - Switches/Dark/Content Area/3 Rg/On')] }),
  );
  return dir;
}

describe('readSymbols', () => {
  it('lists every symbol master on every page, sorted by name', () => {
    expect(readSymbols(kitFolder()).map((s) => s.id)).toEqual(['S1', 'S3', 'S2']);
  });

  it('reads a .sketch file the same as its unpacked folder', () => {
    const dir = kitFolder();
    const file = join(mkdtempSync(join(tmpdir(), 'kit-')), 'kit.sketch');
    execFileSync('zip', ['-r', '-q', file, '.'], { cwd: dir });
    expect(readSymbols(file)).toEqual(readSymbols(dir));
  });
});

describe('select', () => {
  it('keeps the symbols whose names start with any prefix', () => {
    const all = readSymbols(kitFolder());
    expect(select(all, ['Toggles - Switches/']).map((s) => s.id)).toEqual(['S3', 'S2']);
    expect(select(all, ['Toggles - Checkboxes/', 'Toggles - Switches/Light/']).map((s) => s.id)).toEqual(['S1', 'S2']);
    expect(select(all, ['Buttons/'])).toEqual([]);
  });
});

describe('exportedFile', () => {
  it('is the name as folders, with sketchtool’s scale suffix on PNGs', () => {
    expect(exportedFile('A/B/On, 1 - Idle', 'png', 2)).toBe('A/B/On, 1 - Idle@2x.png');
    expect(exportedFile('A/On', 'png', 1)).toBe('A/On.png');
  });

  it('never puts a scale on an SVG, which is exported at scale 1', () => {
    expect(exportedFile('A/On', 'svg', 2)).toBe('A/On.svg');
  });
});

describe('sheetHtml', () => {
  it('groups by folder and puts each symbol on its appearance’s window background, at its size in points', () => {
    const html = sheetHtml([
      { name: 'Sw/Dark/Rg/On, 1 - Idle', file: 'Sw/Dark/Rg/On, 1 - Idle@2x.png', zoom: 0.5 },
      { name: 'Sw/Light/Rg/On', file: 'Sw/Light/Rg/On.svg', zoom: 1 },
    ]);
    expect(html).toContain('<h2>Sw/Dark/Rg</h2>');
    expect(html).toContain('<h2>Sw/Light/Rg</h2>');
    expect(html).toContain('src="Sw/Dark/Rg/On%2C%201%20-%20Idle%402x.png" style="zoom:0.5"');
    expect(html).toContain('src="Sw/Light/Rg/On.svg">');
    expect(html).toContain('background:#1e1e1e');
    expect(backgroundFor('Sw/Light/Rg/On')).toBe('#ffffff');
  });
});
