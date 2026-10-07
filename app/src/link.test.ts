import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

import { beatsToNext, CHOICES, choicesFor, runOn, statusText, type Frame } from './link.ts';

const frame = (over: Partial<Frame> = {}): Frame => ({
  enabled: true,
  tempo: 120,
  peers: 0,
  playing: false,
  beat: 10,
  phase: 0,
  quantum: 4,
  one: 0,
  bar: 3,
  beatInBar: 1,
  barPhase: 0,
  every: { every: 0, unit: 'bars' },
  next: null,
  at: 1000,
  ...over,
});

describe('runOn', () => {
  it('is the frame itself at its own time', () => {
    expect(runOn(frame({ barPhase: 1.5 }), 1000)).toEqual({ bar: 3, phase: 1.5 });
  });

  it('runs on at the tempo: 120 bpm is a beat every 500 ms', () => {
    expect(runOn(frame({ barPhase: 3 }), 1500)).toEqual({ bar: 4, phase: 0 });
  });

  it('never runs backwards before the frame', () => {
    expect(runOn(frame({ barPhase: 2 }), 0)).toEqual({ bar: 3, phase: 2 });
  });
});

describe('beatsToNext', () => {
  it('is null with changes off', () => {
    expect(beatsToNext(frame(), 2000)).toBeNull();
  });

  it('counts down at the tempo', () => {
    expect(beatsToNext(frame({ next: 14 }), 2000)).toBe(2);
  });
});

describe('choicesFor', () => {
  it('offers the list as is for an interval it has', () => {
    expect(choicesFor({ every: 4, unit: 'bars' })).toEqual(CHOICES);
  });

  it('treats off as off whatever its unit', () => {
    expect(choicesFor({ every: 0, unit: 'beats' })).toHaveLength(CHOICES.length);
  });

  it('adds an interval set elsewhere at the top', () => {
    const c = choicesFor({ every: 3, unit: 'bars' });
    expect(c).toHaveLength(CHOICES.length + 1);
    expect(c[0]).toEqual({ every: 3, unit: 'bars', name: 'every 3 bars' });
  });
});

describe('statusText', () => {
  it('says whose clock it is', () => {
    expect(statusText(frame({ enabled: false }))).toBe('off the network: our own clock');
    expect(statusText(frame())).toBe('no one else in the session: our own clock');
    expect(statusText(frame({ peers: 1 }))).toBe('1 peer');
    expect(statusText(frame({ peers: 2, playing: true }))).toBe('2 peers · playing');
  });
});
