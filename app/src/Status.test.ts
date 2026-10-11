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
  BeatDot,
  beatLabel,
  beatLit,
  SkipNote,
  SKIP_FADE,
  SKIP_SHOWN_FOR,
  skipNextChange,
  skipPhase,
  skipText,
  bpmText,
  fpsShown,
  outputLabel,
  outputText,
  TapButton,
  tapWords,
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
    expect(bpmText(frame({ peers: 0 }), effects)).toBe('128 BPM');
    expect(bpmText(frame({ enabled: false }), effects)).toBe('128 BPM');
    expect(bpmText(null, null)).toBeNull();
  });

  it('says where the picture goes', () => {
    const display = { id: 1, index: 1, name: 'Projector', width: 1920, height: 1080, main: false };
    expect(outputText({ display, size: [1920, 1080] })).toEqual({ on: true, text: 'on Projector' });
    expect(outputText({ display: null, size: null })).toEqual({ on: false, text: 'in this window' });
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

  it('goes back to the skip count when a skip follows a stop while the note fades', () => {
    const stop = addStop(addSkip(null, 1000), 2000, 8);
    const fading = 2000 + SKIP_SHOWN_FOR + SKIP_FADE / 2;
    expect(skipPhase(stop, fading)).toBe('fading');
    const after = addSkip(stop, fading);
    expect(after.stopped).toBeUndefined();
    expect(noteText(after)).toBe('Skipped 2 broken presets');
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

  it('reads as a key: what a press does, the tempo and T’s keycap, never a bare word and a number', () => {
    const tap = renderToStaticMarkup(createElement(TapButton, { effects: { bpm: 120, linked: false } as Fx, onTap: () => {} }));
    expect(tap).toContain('<span class="live-tap-what">Tap in time</span>');
    expect(tap).toContain('<b>120</b> BPM');
    expect(tap).toContain('<kbd aria-hidden="true">T</kbd>');
    const linked = renderToStaticMarkup(createElement(TapButton, { effects: { bpm: 128, linked: true } as Fx, onTap: () => {} }));
    expect(linked).toContain(`>${tapWords(true)}<`);
    const unknown = renderToStaticMarkup(createElement(TapButton, { effects: null, onTap: () => {} }));
    expect(unknown).toContain('<b>—</b> BPM');
  });
});

describe('the live pieces, to VoiceOver', () => {
  it('names the beat and output by what they show', () => {
    expect(beatLabel(frame({ tempo: 123.6 }), effects)).toBe('Beat, 124 BPM, 2 in time');
    expect(beatLabel(frame({ peers: 0 }), effects)).toBe('Beat, 128 BPM');
    expect(beatLabel(null, null)).toBe('Beat');
    expect(outputLabel({ display: { id: 1, index: 1, name: 'Projector', width: 1, height: 1, main: false }, size: null })).toBe('Output, on Projector');
    expect(outputLabel({ display: null, size: null })).toBe('Output, in this window');
  });

  it('reads the skipped note politely, from a live region that is there before anything is said', () => {
    const html = renderToStaticMarkup(createElement(SkipNote, { className: 'stage-skipped' }));
    expect(html).toContain('class="stage-skipped"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toMatch(/><\/span>$/);
  });

  it('keeps the beat dot, which changes every frame, away from VoiceOver', () => {
    expect(renderToStaticMarkup(createElement(BeatDot, { frame: null, className: 'stage-beat-dot' }))).toContain('aria-hidden="true"');
  });
});
