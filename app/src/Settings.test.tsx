import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { closesSheet, keep, qualityLine, readKept, SECTIONS, Settings } from './Settings.tsx';
import { MoreEffects } from './MoreEffects.tsx';

/** A key press from an element: inside an open menu or not. */
const press = (key: string, inOpenMenu = false) => ({ key, target: { closest: (selector: string) => (inOpenMenu && selector === '[aria-expanded="true"]' ? {} : null) } as unknown as EventTarget });

describe('closesSheet', () => {
  it('closes on Esc', () => {
    expect(closesSheet(press('Escape'))).toBe(true);
  });

  it('leaves Esc to an open menu inside the sheet', () => {
    expect(closesSheet(press('Escape', true))).toBe(false);
  });

  it('ignores every other key', () => {
    expect(closesSheet(press('Enter'))).toBe(false);
    expect(closesSheet(press('m'))).toBe(false);
  });

  it('closes on Esc from no element, or one that is not an element', () => {
    expect(closesSheet({ key: 'Escape', target: null })).toBe(true);
    expect(closesSheet({ key: 'Escape', target: {} as EventTarget })).toBe(true);
  });
});

describe('qualityLine', () => {
  it("says the app's reason when it gives one", () => {
    expect(qualityLine({ chosen: 'auto', effective: 'high', reason: 'Auto picked high for Apple M1.' })).toBe('Auto picked high for Apple M1.');
  });

  it('falls back to what auto picked, or what is drawn', () => {
    expect(qualityLine({ chosen: 'auto', effective: 'medium', reason: '' })).toBe('Auto picked medium.');
    expect(qualityLine({ chosen: 'low', effective: 'low', reason: '' })).toBe('Drawing at low.');
  });
});

describe('keep', () => {
  it('resolves to null when the app keeps the switch', async () => {
    const asked: boolean[] = [];
    await expect(
      keep(async (on) => {
        asked.push(on);
      }, true),
    ).resolves.toBeNull();
    expect(asked).toEqual([true]);
  });

  it("resolves to the app's own words when it refuses", async () => {
    await expect(keep(() => Promise.reject(new Error('No crash folder.')), true)).resolves.toBe('No crash folder.');
    await expect(keep(() => Promise.reject('not allowed'), false)).resolves.toBe('not allowed');
  });
});

describe('readKept', () => {
  it('resolves to the state when the app reads it', async () => {
    await expect(readKept(async () => true)).resolves.toEqual({ on: true, problem: null });
  });

  it('says why, rather than off, when the read fails', async () => {
    await expect(readKept(() => Promise.reject(new Error('No settings folder.')))).resolves.toEqual({ on: null, problem: 'No settings folder.' });
  });
});

describe('the sheets', () => {
  it('draw nothing while closed', () => {
    expect(renderToStaticMarkup(<Settings open={false} onClose={() => {}} />)).toBe('');
    expect(renderToStaticMarkup(<MoreEffects open={false} onClose={() => {}} />)).toBe('');
  });

  it('show every settings section, in order, in plain words, behind a scrim', () => {
    const html = renderToStaticMarkup(<Settings open onClose={() => {}} />);
    expect(html).toContain('class="vf-scrim"');
    expect(html).toContain('role="dialog" aria-label="Settings"');
    const headings = [...html.matchAll(/<h3[^>]*>([^<]*)<\/h3>/g)].map((m) => m[1]);
    expect(headings).toEqual([...SECTIONS]);
    expect(headings).toContain('Picture quality');
    expect(html).toContain('No usage tracking');
    expect(html).toContain('Send crash reports');
    expect(html).toContain('Reduce flashing');
  });

  it('draw More effects as a drawer with no scrim', () => {
    const html = renderToStaticMarkup(<MoreEffects open onClose={() => {}} />);
    expect(html).toContain('aria-label="More effects"');
    expect(html).toContain('vf-sheet more-fx');
    expect(html).not.toContain('vf-scrim');
  });
});
