import { describe, expect, it } from 'vitest';
import type { Source } from './api.ts';
import { current, deniedNote, goneNote, keepChannels, label } from './SourcePicker.tsx';

const daw: Source = { id: { kind: 'app', bundle: 'com.ableton.live' }, name: 'Ableton Live', channels: 2 };
const mac: Source = { id: { kind: 'system' }, name: 'everything on this Mac', channels: 2 };
const agg2: Source = { id: { kind: 'device', name: 'Aggregate Device', size: 2 }, name: 'Aggregate Device', channels: 2 };
const agg8: Source = { id: { kind: 'device', name: 'Aggregate Device', size: 8 }, name: 'Aggregate Device', channels: 8 };
const sources = [daw, mac, agg2, agg8];

describe('the source picker', () => {
  it('finds what is heard by name, and an input by its channel count too', () => {
    expect(current(sources, { name: 'Ableton Live', left: 1, right: 2, size: 2 })).toBe(0);
    expect(current(sources, { name: 'Aggregate Device', left: 1, right: 2, size: 8 })).toBe(3);
    expect(current(sources, { name: 'Bitwig Studio', left: 1, right: 2, size: 2 })).toBe(-1);
    expect(current(sources, null)).toBe(-1);
  });

  it('lists inputs with their channels and apps by name', () => {
    expect(sources.map(label)).toEqual(['Ableton Live', 'everything on this Mac', 'Aggregate Device (2 ch)', 'Aggregate Device (8 ch)']);
  });

  it('says plainly when a source went away, and nothing when the app went back to it', () => {
    expect(goneNote('Ableton Live', 'everything on this Mac', [mac])).toBe("Ableton Live is gone, so listening to everything on this Mac until it's back");
    expect(goneNote('everything on this Mac', 'Ableton Live', sources)).toBeNull();
    expect(goneNote(null, 'Ableton Live', sources)).toBeNull();
    expect(goneNote('Ableton Live', 'Ableton Live', [])).toBeNull();
  });

  it('says where to allow hearing other apps when macOS refused it', () => {
    expect(deniedNote({ choice: null, channels: 2, denied: true })).toContain('System Settings › Privacy & Security › Screen & System Audio Recording');
    expect(deniedNote({ choice: null, channels: 2, denied: false })).toBeNull();
    expect(deniedNote({ choice: null, channels: 2 })).toBeNull();
  });

  it('keeps the channels when the next source has them', () => {
    expect(keepChannels({ name: 'Aggregate Device', left: 5, right: 6, size: 8 }, agg8)).toEqual([5, 6]);
    expect(keepChannels({ name: 'Aggregate Device', left: 5, right: 6, size: 8 }, daw)).toEqual([1, 2]);
    expect(keepChannels(null, { ...agg2, channels: 1 })).toEqual([1, 1]);
  });
});
