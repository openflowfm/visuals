import { describe, expect, it } from 'vitest';
import { centreFor, homeLook, scrollFor } from './LibraryGrid';

// The home's grid scrolls behind its pinned preview (`under`) and its pinned transport bar
// (`over`): keeping a tile in view counts the covered top and bottom as out of view.
describe('the home grid kept clear of the pinned bar', () => {
  const rowHeight = 100;
  const height = 600;

  it('pads its foot by the bar, so the last row comes to rest above it', () => {
    const look = homeLook(22, 0, 0, 80);
    expect(look.padBottom).toBe(homeLook().padBottom + 80);
    expect(look.over).toBe(80);
    expect(homeLook().over).toBeUndefined();
  });

  it('scrolls a row under the bar up clear of it', () => {
    const tall = 700;
    const plain = homeLook(22, 0, 200);
    const look = homeLook(22, 0, 200, 120);
    // Row 3's foot is visible without the bar, hidden behind it with one.
    expect(scrollFor(3, rowHeight, 0, tall, plain)).toBeNull();
    const to = scrollFor(3, rowHeight, 0, tall, look);
    expect(to).not.toBeNull();
    // At that scroll its foot (and the 8px margin) sits on the bar's top, and it is kept.
    const foot = look.padTop + 3 * rowHeight + rowHeight - look.rowGap + look.padTop - 200;
    expect(foot - to!).toBe(tall - 120);
    expect(scrollFor(3, rowHeight, to!, tall, look)).toBeNull();
  });

  it('still scrolls a row under the preview down clear of it', () => {
    const look = homeLook(22, 0, 200, 80);
    expect(scrollFor(0, rowHeight, 150, height, look)).toBe(0);
  });

  it('centres the playing row in what shows between the preview and the bar', () => {
    const plain = homeLook(22, 0, 200);
    const look = homeLook(22, 0, 200, 200);
    expect(centreFor(6, rowHeight, height, look)).toBeGreaterThan(centreFor(6, rowHeight, height, plain));
  });
});
