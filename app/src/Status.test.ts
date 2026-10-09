import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Fx } from './fx.ts';
import type { Frame } from './link.ts';
import { audioLabel, beatLabel, beatLit, hearingAt, SILENT_AFTER, bpmText, fpsShown, outputLabel, outputText, peersText, Status } from './Status.tsx';

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

  it('keeps the meter and the beat dot, which change every frame, away from VoiceOver', () => {
    expect(html).not.toContain('aria-live');
    for (const dot of html.match(/<span class="live-status-(dot|meter)"[^>]*>/g) ?? []) expect(dot).toContain('aria-hidden="true"');
  });
});
