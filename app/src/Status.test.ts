import { describe, expect, it } from 'vitest';
import type { Fx } from './fx.ts';
import type { Frame } from './link.ts';
import { beatLit, bpmText, fpsShown, outputText, peersText } from './Status.tsx';

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
