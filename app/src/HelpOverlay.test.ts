import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CONTROLS, control, GROUPS, HelpOverlay, HOME_HELP, titleOf, type ControlId } from './HelpOverlay.tsx';
import { liveKeys, type KeyLike } from './liveKeys.ts';

const IDS: Record<ControlId, true> = {
  audio: true,
  beat: true,
  output: true,
  fps: true,
  help: true,
  settings: true,
  leave: true,
  now: true,
  next: true,
  fullscreen: true,
  previous: true,
  random: true,
  step: true,
  hold: true,
  strobe: true,
  blackout: true,
  freeze: true,
  tempo: true,
  intensity: true,
  more: true,
  playlists: true,
  moods: true,
  upnext: true,
  rate: true,
  favourite: true,
  punch: true,
  invert: true,
  mirror: true,
  reset: true,
  crate: true,
  panels: true,
};

const ARROWS: Record<string, string> = { '←': 'ArrowLeft', '→': 'ArrowRight', '↑': 'ArrowUp', '↓': 'ArrowDown' };

/** The presses a control's keys name, as key events: "hold S, ⇧S latches" is S and ⇧S; "1–5" is 1 to 5. */
function pressesOf(keys: string): Partial<KeyLike>[] {
  const out: Partial<KeyLike>[] = [];
  for (const token of keys.split(/[\s,]+/)) {
    const range = /^(\d)–(\d)$/.exec(token);
    if (range) {
      for (let d = Number(range[1]); d <= Number(range[2]); d++) out.push({ key: String(d) });
      continue;
    }
    const m = /^(⌘?)(⇧?)(Esc|[A-Z0-9?\\]|[←→↑↓])$/.exec(token);
    if (!m) continue;
    const key = m[3] === 'Esc' ? 'Escape' : (ARROWS[m[3]] ?? m[3]);
    out.push({ key, metaKey: m[1] === '⌘', shiftKey: m[2] === '⇧' || key === '?' });
  }
  return out;
}

function sends(press: Partial<KeyLike>): number {
  let sent = 0;
  const count = () => void sent++;
  const keys = liveKeys({ editor: count, act: count, fx: count, rate: count, favourite: count, help: count, panels: count });
  keys.keydown({ key: '', metaKey: false, shiftKey: false, ctrlKey: false, altKey: false, repeat: false, target: null, preventDefault: () => {}, ...press });
  return sent;
}

describe('the live controls', () => {
  it('lists every control exactly once', () => {
    const ids = CONTROLS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(Object.keys(IDS).sort());
  });

  it('names every control and says what it does', () => {
    for (const c of CONTROLS) {
      expect(c.name.trim(), c.id).not.toBe('');
      expect(c.does.trim(), c.id).not.toBe('');
      expect(
        GROUPS.some((g) => g.where === c.where),
        c.id,
      ).toBe(true);
    }
  });

  it('finds a control by its id', () => {
    expect(control('freeze').keys).toBe('hold F, ⇧F latches');
    expect(control('favourite').keys).toBe('L');
    expect(() => control('nope' as ControlId)).toThrow();
  });

  it('makes a tooltip of the name, what it does and its keys', () => {
    const t = control('tempo');
    expect(titleOf('tempo')).toBe(`${t.name}: ${t.does} (T)`);
    const i = control('intensity');
    expect(titleOf('intensity')).toBe(`${i.name}: ${i.does}`);
  });

  it('names keys that live mode answers', () => {
    for (const c of CONTROLS) {
      if (!c.keys || c.where === 'crate') continue;
      const presses = pressesOf(c.keys);
      expect(presses.length, `${c.id}: ${c.keys}`).toBeGreaterThan(0);
      for (const p of presses) expect(sends(p), `${c.id}: ${p.key}`).toBe(1);
    }
  });

  it('names every key live mode answers', () => {
    const named = new Set(
      CONTROLS.filter((c) => c.where !== 'crate')
        .flatMap((c) => pressesOf(c.keys))
        .map((p) => p.key?.toLowerCase()),
    );
    for (const key of ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'r', 'h', 's', 'p', 'b', 't', 'i', 'm', '0', '1', '2', '3', '4', '5', 'f', '?', 'escape', 'l']) {
      expect(named.has(key), key).toBe(true);
    }
  });
});

describe('the ? overlay, to VoiceOver', () => {
  const html = renderToStaticMarkup(createElement(HelpOverlay, { open: true, onClose: () => {} }));

  it('is a modal dialog named by its heading, which takes focus (the trap needs tabindex -1)', () => {
    const dialog = /<[a-z]+[^>]*role="dialog"[^>]*>/.exec(html)?.[0] ?? '';
    expect(dialog).toContain('aria-modal="true"');
    expect(dialog).toContain('aria-labelledby="live-help-title"');
    expect(dialog).toContain('tabindex="-1"');
    expect(html).toContain('<h2 id="live-help-title">Live controls</h2>');
  });

  it('names its ✕ in words, the glyph hidden from VoiceOver', () => {
    const close = /<button[^>]*aria-label="Close live controls"[^>]*>(.*?)<\/button>/.exec(html);
    expect(close).not.toBeNull();
    expect(close?.[1]).toContain('aria-hidden="true"');
  });

  it('heads each group, and lists every control with its keys and what it does', () => {
    const headings = [...html.matchAll(/<h3>([^<]*)<\/h3>/g)].map((m) => m[1].replace(/&#x27;/g, "'"));
    expect(headings).toEqual(GROUPS.map((g) => g.heading));
    const all = renderToStaticMarkup(createElement(HelpOverlay, { open: true, onClose: () => {}, stage: true }));
    for (const c of CONTROLS) {
      if (c.keys) expect(all, c.id).toContain(`<kbd>${c.keys.replace(/&/g, '&amp;')}</kbd>`);
    }
    expect([...all.matchAll(/<dt>/g)].length).toBe(CONTROLS.length);
  });

  it("lists the Stage's own controls only when told the Stage is showing", () => {
    expect(html).not.toContain('Hide the controls');
    const stage = renderToStaticMarkup(createElement(HelpOverlay, { open: true, onClose: () => {}, stage: true }));
    expect(stage).toContain('Hide the controls');
    expect(stage).toContain('Playlists and up next');
  });

  it("files the audio input along the bottom, in the dock's transport bar, with its levels", () => {
    const audio = control('audio');
    expect(GROUPS.find((g) => g.where === audio.where)?.heading).toBe('Along the bottom');
    expect(audio.does).toContain('levels');
  });

  it('draws nothing while closed', () => {
    expect(renderToStaticMarkup(createElement(HelpOverlay, { open: false, onClose: () => {} }))).toBe('');
  });
});

describe("the home's ? overlay", () => {
  const html = renderToStaticMarkup(createElement(HelpOverlay, { open: true, onClose: () => {}, list: HOME_HELP }));

  it('is its own dialog, named Home controls, with a ✕ named for it', () => {
    const dialog = /<[a-z]+[^>]*role="dialog"[^>]*>/.exec(html)?.[0] ?? '';
    expect(dialog).toContain('aria-labelledby="home-help-title"');
    expect(html).toContain('<h2 id="home-help-title">Home controls</h2>');
    expect(html).toContain('aria-label="Close home controls"');
    expect(html).not.toContain('Live controls');
  });

  it('lists the keys the home answers, and says a playlist moves on by itself until H holds it', () => {
    for (const keys of ['←', '→', 'R', 'H', '?', 'Esc', '⌘F', '⌘I', '⌃⌘S', 'Click or Enter']) expect(html, keys).toContain(`<kbd>${keys}</kbd>`);
    const hold = HOME_HELP.groups.flatMap((g) => g.rows).find((r) => r.keys === 'H');
    expect(hold?.does).toMatch(/moving on by itself/);
    expect([...html.matchAll(/<dt>/g)].length).toBe(HOME_HELP.groups.reduce((n, g) => n + g.rows.length, 0));
  });
});
