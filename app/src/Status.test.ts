import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Fx } from './fx.ts';
import type { Frame } from './link.ts';
import {
  addSkip,
  addStop,
  noteText,
  stopText,
  audioLabel,
  beatLabel,
  beatLit,
  hearingAt,
  SILENT_AFTER,
  SKIP_FADE,
  SKIP_SHOWN_FOR,
  skipNextChange,
  skipPhase,
  skipText,
  bpmText,
  fpsShown,
  outputLabel,
  outputShown,
  outputText,
  peersText,
  Status,
  TapButton,
  tempoLabel,
} from './Status.tsx';

const frame = (over: Partial<Frame> = {}): Frame => ({
  enabled: true,
  tempo: 120,
  peers: 2,
  playing: true,
  beat: 10,
  phase: 2,
  quantum: 4,
  one: 0,
  bar: 3,
  beatInBar: 3,
  barPhase: 2,
  every: { every: 0, unit: 'bars' },
  next: null,
  at: 1000,
  ...over,
});

const effects = { bpm: 128.4 } as Fx;

describe('the status strip', () => {
  it('shows the frame rate only while it is low, and not before a first reading', () => {
    expect(fpsShown(0)).toBeNull();
    expect(fpsShown(60)).toBeNull();
    expect(fpsShown(50)).toBeNull();
    expect(fpsShown(49.6)).toBe('50 fps');
    expect(fpsShown(31)).toBe('31 fps');
    expect(fpsShown(NaN)).toBeNull();
  });

  it('lights the beat for the first part of each beat, run on at the tempo', () => {
    // 120 BPM: a beat every 500 ms, from beat 10 at t = 1000.
    expect(beatLit(frame(), 1000)).toBe(true);
    expect(beatLit(frame(), 1070)).toBe(true);
    expect(beatLit(frame(), 1100)).toBe(false);
    expect(beatLit(frame(), 1400)).toBe(false);
    expect(beatLit(frame(), 1510)).toBe(true);
    expect(beatLit(frame({ beat: 10.5 }), 1000)).toBe(false);
    expect(beatLit(null, 1000)).toBe(false);
    expect(beatLit(frame({ tempo: 0 }), 1000)).toBe(false);
  });

  it("shows a Link session's tempo and who keeps it, otherwise the effects' tempo", () => {
    expect(bpmText(frame({ tempo: 123.6 }), effects)).toBe('124 BPM');
    expect(peersText(frame())).toBe('· 2 in time');
    expect(bpmText(frame({ peers: 0 }), effects)).toBe('128 BPM');
    expect(peersText(frame({ peers: 0 }))).toBeNull();
    expect(bpmText(frame({ enabled: false }), effects)).toBe('128 BPM');
    expect(peersText(frame({ enabled: false }))).toBeNull();
    expect(bpmText(null, null)).toBeNull();
  });

  it('says where the picture goes', () => {
    const display = { id: 1, index: 1, name: 'Projector', width: 1920, height: 1080, main: false };
    expect(outputText({ display, size: [1920, 1080] })).toEqual({ on: true, text: 'on Projector' });
    expect(outputText({ display: null, size: null })).toEqual({ on: false, text: 'in this window' });
  });

  it("shows words by the output's light only while the picture isn't on a display", () => {
    const display = { id: 1, index: 1, name: 'Projector', width: 1920, height: 1080, main: false };
    expect(outputShown({ display, size: null })).toBeNull();
    expect(outputShown({ display: null, size: null })).toBe('in this window');
  });
});

describe('the status strip, on screen', () => {
  const noop = () => {};
  const display = { id: 1, index: 1, name: 'Projector', width: 1920, height: 1080, main: false };
  const html = renderToStaticMarkup(createElement(Status, { output: { display, size: null }, show: noop, effects, onHelp: noop, onLeave: noop, onError: noop }));
  const visible = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  it('has no captions: just the lights, the tempo, and ? ⚙ ✕', () => {
    for (const word of ['AUDIO', 'BEAT', 'OUTPUT', 'Projector']) expect(visible).not.toContain(word);
    expect(visible).toBe('128 BPM ? ⚙ ✕');
  });

  it('sets ✕ apart from ? and ⚙', () => {
    const end = /<span class="live-status-end">(.*?)<\/span><span class="live-status-leave">(.*)<\/span><\/div>$/.exec(html);
    expect(end?.[1]).toContain('aria-label="Help"');
    expect(end?.[1]).toContain('aria-label="Settings"');
    expect(end?.[1]).not.toContain('Leave live');
    expect(end?.[2]).toContain('aria-label="Leave live"');
  });
});

describe('the skipped note', () => {
  it('says how many broken presets were skipped', () => {
    expect(skipText(1)).toBe('Skipped 1 broken preset');
    expect(skipText(3)).toBe('Skipped 3 broken presets');
  });

  it('counts skips in quick succession into one line, and starts again once it has gone', () => {
    let note = addSkip(null, 1000);
    expect(note).toEqual({ count: 1, at: 1000 });
    note = addSkip(note, 1200);
    note = addSkip(note, 3000);
    expect(note).toEqual({ count: 3, at: 3000 });
    // While it fades, a new skip still counts in and brings it back.
    note = addSkip(note, 3000 + SKIP_SHOWN_FOR + SKIP_FADE / 2);
    expect(note.count).toBe(4);
    expect(skipPhase(note, note.at)).toBe('shown');
    // Once gone, the next is a new note of one.
    expect(addSkip(note, note.at + SKIP_SHOWN_FOR + SKIP_FADE)).toEqual({ count: 1, at: note.at + SKIP_SHOWN_FOR + SKIP_FADE });
  });

  it('says when stepping stopped, without counting the stop as a skip', () => {
    expect(stopText(8)).toBe("Stopped skipping: 8 presets in a row wouldn't draw");
    let note = addSkip(addSkip(null, 1000), 1100);
    note = addStop(note, 1200, 8);
    expect(note).toEqual({ count: 2, at: 1200, stopped: 8 });
    expect(noteText(note)).toBe("Stopped skipping: 8 presets in a row wouldn't draw");
    // Skipping again after: back to counting, from where it was.
    note = addSkip(note, 1300);
    expect(note).toEqual({ count: 3, at: 1300 });
    expect(noteText(note)).toBe('Skipped 3 broken presets');
    // A stop alone counts no skips.
    expect(addStop(null, 5000, 8)).toEqual({ count: 0, at: 5000, stopped: 8 });
  });

  it('stays a few seconds after the last skip, then fades and goes', () => {
    const note = { count: 2, at: 1000 };
    expect(skipPhase(null, 1000)).toBe('gone');
    expect(skipPhase(note, 1000)).toBe('shown');
    expect(skipPhase(note, 1000 + SKIP_SHOWN_FOR - 1)).toBe('shown');
    expect(skipPhase(note, 1000 + SKIP_SHOWN_FOR)).toBe('fading');
    expect(skipPhase(note, 1000 + SKIP_SHOWN_FOR + SKIP_FADE - 1)).toBe('fading');
    expect(skipPhase(note, 1000 + SKIP_SHOWN_FOR + SKIP_FADE)).toBe('gone');
    expect(SKIP_SHOWN_FOR).toBeGreaterThanOrEqual(2000);
  });

  it('wakes up when the note next changes, and not once it has gone', () => {
    const note = { count: 1, at: 1000 };
    expect(skipNextChange(note, 1000)).toBe(1000 + SKIP_SHOWN_FOR);
    expect(skipNextChange(note, 1000 + SKIP_SHOWN_FOR)).toBe(1000 + SKIP_SHOWN_FOR + SKIP_FADE);
    expect(skipNextChange(note, 1000 + SKIP_SHOWN_FOR + SKIP_FADE)).toBeNull();
    expect(skipNextChange(null, 1000)).toBeNull();
  });
});

describe('tap tempo, in the beat popover', () => {
  it('names the tap button with its tempo, lit (not pressed) while Link keeps it', () => {
    expect(tempoLabel(false, 120.4)).toBe('Tap tempo, 120 BPM (T)');
    expect(tempoLabel(true, 128)).toBe('Link tempo, 128 BPM (T)');
    expect(tempoLabel(false, null)).toBe('Tap tempo (T)');
    const linked = renderToStaticMarkup(createElement(TapButton, { effects: { bpm: 128, linked: true } as Fx, onTap: () => {} }));
    expect(linked).toContain('aria-label="Link tempo, 128 BPM (T)"');
    expect(linked).toContain('data-on=""');
    expect(linked).not.toContain('aria-pressed');
    const tap = renderToStaticMarkup(createElement(TapButton, { effects: { bpm: 120, linked: false } as Fx, onTap: () => {} }));
    expect(tap).toContain('aria-label="Tap tempo, 120 BPM (T)"');
    expect(tap).not.toContain('data-on');
  });
});

describe('the status strip, to VoiceOver', () => {
  const noop = () => {};
  const html = renderToStaticMarkup(createElement(Status, { output: { display: null, size: null }, show: noop, effects, onHelp: noop, onLeave: noop, onError: noop }));
  const tagOf = (attr: string) => [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]).find((t) => t.includes(attr)) ?? '';

  it('names ?, ⚙ and ✕ in words', () => {
    expect(tagOf('aria-label="Help"')).toContain('aria-keyshortcuts="?"');
    expect(tagOf('aria-label="Settings"')).toContain('aria-haspopup="dialog"');
    expect(tagOf('aria-label="Leave live"')).toContain('aria-keyshortcuts="Escape Meta+Shift+L"');
  });

  it('names each light by what it shows, and says it opens a popover', () => {
    expect(tagOf('data-light="audio"')).toContain('aria-label="Audio, silent"');
    expect(tagOf('data-light="beat"')).toContain('aria-label="Beat, 128 BPM"');
    expect(tagOf('data-light="output"')).toContain('aria-label="Output, in this window"');
    for (const light of ['audio', 'beat', 'output']) {
      expect(tagOf(`data-light="${light}"`)).toContain('aria-haspopup="dialog"');
      expect(tagOf(`data-light="${light}"`)).toContain('aria-expanded="false"');
    }
    expect(beatLabel(frame({ tempo: 123.6 }), effects)).toBe('Beat, 124 BPM, 2 in time');
    expect(beatLabel(null, null)).toBe('Beat');
    expect(outputLabel({ display: { id: 1, index: 1, name: 'Projector', width: 1, height: 1, main: false }, size: null })).toBe('Output, on Projector');
    expect(audioLabel(true)).toBe('Audio, hearing');
    expect(audioLabel(false)).toBe('Audio, silent');
  });

  it('calls the audio silent only after a second of nothing, not in a gap between notes', () => {
    expect(hearingAt(null, 5000)).toBe(false);
    expect(hearingAt(5000, 5000)).toBe(true);
    expect(hearingAt(5000, 5000 + SILENT_AFTER - 1)).toBe(true);
    expect(hearingAt(5000, 5000 + SILENT_AFTER)).toBe(false);
  });

  it('reads the skipped note politely, from a live region that is there before anything is said', () => {
    const lives = html.match(/<[^>]*aria-live[^>]*>[^<]*/g) ?? [];
    expect(lives).toHaveLength(1);
    expect(lives[0]).toContain('class="live-status-skipped"');
    expect(lives[0]).toContain('aria-live="polite"');
    expect(lives[0]).toMatch(/>$/);
  });

  it('keeps the meter and the beat dot, which change every frame, away from VoiceOver', () => {
    for (const dot of html.match(/<span class="live-status-(dot|meter)"[^>]*>/g) ?? []) expect(dot).toContain('aria-hidden="true"');
  });
});
