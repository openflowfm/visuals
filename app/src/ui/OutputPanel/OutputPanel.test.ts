// `fitLine` (OutputPanel.tsx): the Output panel's one line on how the picture fills its display
// (visuals#266: "Fills" only when the picture really fills it).
//
// Spec:
// 1. A picture the display's own size, on a landscape display, fills it: "Fills <name>."
// 2. A picture the display's own size, on a portrait display (turned on its side), fills it and
//    says it is drawn tall: "Fills <name>, drawn tall to match it."
// 3. A picture wider than its landscape display is letterboxed: "The whole picture, W×H on
//    <name>, with black bars above and below."
// 4. A picture narrower than its landscape display is pillarboxed: "… with black bars at the sides."
// 5. On a portrait display, the same two: a landscape picture has bars above and below, a picture
//    narrower than the display has them at the sides; neither says "Fills".
// 6. With no display or no picture size, the general line: the whole picture with black bars where
//    the shapes differ, a turned display filled.
import { describe, expect, it } from 'vitest';
import type * as output from '../model/output';
import { fitLine } from './OutputPanel';

const display = (name: string, width: number, height: number): output.Display => ({ id: 1, index: 0, name, width, height, main: true });
const status = (d: output.Display | null, size: [number, number] | null): output.Status => ({ display: d, size });

const GENERAL = 'The whole picture, with black bars where the display is a different shape; a display turned on its side is filled.';

describe('fitLine', () => {
  it('spec 1: fills a landscape display', () => {
    expect(fitLine(status(display('Studio Display', 5120, 2880), [5120, 2880]))).toBe('Fills Studio Display.');
    expect(fitLine(status(display('Projector', 1920, 1080), [1920, 1080]))).toBe('Fills Projector.');
  });

  it('spec 2: fills a portrait display, drawn tall', () => {
    expect(fitLine(status(display('Side', 1080, 1920), [1080, 1920]))).toBe('Fills Side, drawn tall to match it.');
    expect(fitLine(status(display('Ultra turned', 1440, 3440), [1440, 3440]))).toBe('Fills Ultra turned, drawn tall to match it.');
  });

  it('spec 3: a wider picture on a landscape display has bars above and below', () => {
    expect(fitLine(status(display('Laptop', 1920, 1200), [1920, 1080]))).toBe('The whole picture, 1920×1080 on Laptop, with black bars above and below.');
  });

  it('spec 4: a narrower picture on a landscape display has bars at the sides', () => {
    expect(fitLine(status(display('Ultrawide', 3440, 1440), [2560, 1440]))).toBe('The whole picture, 2560×1440 on Ultrawide, with black bars at the sides.');
  });

  it('spec 5: letterboxed on a portrait display, never "Fills"', () => {
    expect(fitLine(status(display('Side', 1080, 1920), [1080, 608]))).toBe('The whole picture, 1080×608 on Side, with black bars above and below.');
    expect(fitLine(status(display('Side', 1200, 1920), [1080, 1920]))).toBe('The whole picture, 1080×1920 on Side, with black bars at the sides.');
  });

  it('spec 6: no display or no size gives the general line', () => {
    expect(fitLine(status(null, null))).toBe(GENERAL);
    expect(fitLine(status(null, [1920, 1080]))).toBe(GENERAL);
    expect(fitLine(status(display('Projector', 1920, 1080), null))).toBe(GENERAL);
  });
});
