import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { closesSheet, keep, latestOnly, MotionSwitch, qualityLine, readKept, SECTIONS, Settings } from './Settings.tsx';
import { MoreEffects } from './MoreEffects.tsx';
import type { Motion } from './api.ts';

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

describe('latestOnly', () => {
  it('shows only the reply to the latest request, whatever order they come back in', async () => {
    const shown: string[] = [];
    const show = latestOnly<string>((v) => shown.push(v));
    let first!: (v: string) => void;
    const older = show(new Promise<string>((resolve) => (first = resolve)));
    await show(Promise.resolve('newer'));
    first('older');
    await older;
    expect(shown).toEqual(['newer']);
    await show(Promise.resolve('next'));
    expect(shown).toEqual(['newer', 'next']);
  });

  it('passes a failure on, even from an older request', async () => {
    const show = latestOnly<string>(() => {});
    const older = show(Promise.reject(new Error('no')));
    show(Promise.resolve('newer'));
    await expect(older).rejects.toThrow('no');
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

  it('make Settings a modal dialog, and leave the drawer a dialog live stays usable behind', () => {
    const settings = renderToStaticMarkup(<Settings open onClose={() => {}} />);
    expect(settings).toMatch(/<div[^>]*class="vf-sheet settings"[^>]*role="dialog"[^>]*aria-modal="true"/);
    const drawer = renderToStaticMarkup(<MoreEffects open onClose={() => {}} />);
    expect(drawer).toMatch(/<div[^>]*class="vf-sheet more-fx"[^>]*role="dialog"/);
    expect(drawer).not.toContain('aria-modal');
  });

  it('name their close buttons in words, not by the ✕', () => {
    expect(renderToStaticMarkup(<Settings open onClose={() => {}} />)).toMatch(/aria-label="Close settings"[^>]*>✕</);
    expect(renderToStaticMarkup(<MoreEffects open onClose={() => {}} />)).toMatch(/aria-label="Close more effects"[^>]*>✕</);
  });

  it('wait for the app before the reduce-flashing switch can be used', () => {
    const motion = switchTag(renderToStaticMarkup(<Settings open onClose={() => {}} />));
    expect(motion).toContain('aria-pressed="false"');
    expect(motion).toContain('disabled=""');
  });
});

/** The reduce-flashing switch's own tag in `html`. */
const switchTag = (html: string) => html.match(/<button[^>]*aria-label="Reduce flashing"[^>]*>/)?.[0] ?? '';

describe('MotionSwitch', () => {
  const draw = (motion: Motion | null, problem: string | null = null) => renderToStaticMarkup(<MotionSwitch motion={motion} problem={problem} onChange={() => {}} onFollow={() => {}} />);

  it('says macOS decides while no choice has been made here', () => {
    const html = draw({ reduced: true, system: true });
    expect(switchTag(html)).toContain('aria-pressed="true"');
    expect(switchTag(html)).not.toContain('disabled');
    expect(html).toContain('Following macOS&#x27;s Reduce motion.');
    expect(html).not.toContain('Follow macOS&#x27;s Reduce motion"');
  });

  it('says in its tooltip what it calms, and that presets can still flash', () => {
    const html = draw({ reduced: false, system: true });
    expect(html).toContain('title="Calms the app’s strobe, flashes and blackout. Presets can still flash on their own."');
  });

  it('offers to follow macOS again once a choice was made', () => {
    const html = draw({ reduced: false, system: false });
    expect(switchTag(html)).toContain('aria-pressed="false"');
    expect(html).toMatch(/<button[^>]*aria-label="Follow macOS&#x27;s Reduce motion"[^>]*>Follow macOS</);
    expect(html).not.toContain('Following macOS');
  });

  it('is disabled with no line under it until the app has said, and shows why a change failed', () => {
    const html = draw(null, 'No settings folder.');
    expect(switchTag(html)).toContain('disabled=""');
    expect(html).not.toContain('macOS');
    expect(html).toContain('role="status">No settings folder.<');
  });
});
