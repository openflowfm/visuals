import { describe, expect, it } from 'vitest';
import { DragStore, dropAction, isOver, itemTarget, listTarget, movedEnough, nudge, THRESHOLD, type DragHandlers, type Payload } from './drag.ts';

const lists = [
  { id: 'a', kind: 'manual' as const, items: ['x', 'y', 'z'] },
  { id: 'b', kind: 'manual' as const, items: [] },
  { id: 's', kind: 'smart' as const, items: [] },
];
const preset: Payload = { kind: 'preset', path: '/p/q.milk', name: 'q', thumbnail: null };
const item = (list: string, index: number): Payload => ({ kind: 'item', list, index, path: `/p/${index}.milk`, name: `${index}`, thumbnail: null });

describe('dropAction', () => {
  it('adds a library preset to the end of a playlist dropped on its name', () => {
    expect(dropAction(preset, listTarget('b'), lists)).toEqual({ kind: 'add', list: 'b', path: '/p/q.milk', at: null });
  });

  it('puts a library preset at the place it is dropped in a strip', () => {
    expect(dropAction(preset, itemTarget('a', 1), lists)).toEqual({ kind: 'add', list: 'a', path: '/p/q.milk', at: 1 });
  });

  it('moves an item dropped on another place in its own playlist', () => {
    expect(dropAction(item('a', 0), itemTarget('a', 2), lists)).toEqual({ kind: 'move', list: 'a', from: 0, to: 2 });
    expect(dropAction(item('a', 2), itemTarget('a', 0), lists)).toEqual({ kind: 'move', list: 'a', from: 2, to: 0 });
  });

  it('copies an item dropped on another playlist, and does nothing on its own name or its own place', () => {
    expect(dropAction(item('a', 1), listTarget('b'), lists)).toEqual({ kind: 'add', list: 'b', path: '/p/1.milk', at: null });
    expect(dropAction(item('a', 1), listTarget('a'), lists)).toBeNull();
    expect(dropAction(item('a', 1), itemTarget('a', 1), lists)).toBeNull();
  });

  it('refuses smart playlists, unknown ones, places past the end and nonsense', () => {
    expect(dropAction(preset, listTarget('s'), lists)).toBeNull();
    expect(dropAction(preset, listTarget('gone'), lists)).toBeNull();
    expect(dropAction(preset, itemTarget('a', 4), lists)).toBeNull();
    expect(dropAction(preset, 'item:a:-1', lists)).toBeNull();
    expect(dropAction(preset, 'item:a:x', lists)).toBeNull();
    expect(dropAction(preset, 'what:a', lists)).toBeNull();
  });
});

describe('nudge', () => {
  it('moves one place, and not past either end', () => {
    expect(nudge(1, -1, 3)).toBe(0);
    expect(nudge(1, 1, 3)).toBe(2);
    expect(nudge(0, -1, 3)).toBeNull();
    expect(nudge(2, 1, 3)).toBeNull();
    expect(nudge(1, 0, 3)).toBeNull();
  });
});

describe('movedEnough', () => {
  it(`takes ${THRESHOLD} px of movement to start a drag`, () => {
    expect(movedEnough({ x: 0, y: 0 }, { x: THRESHOLD - 1, y: 0 })).toBe(false);
    expect(movedEnough({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(true);
  });
});

describe('DragStore', () => {
  /** Targets laid out along x: `list:b` from 100, `list:s` from 200; nothing before 100. */
  const hit = (x: number) => (x >= 200 ? listTarget('s') : x >= 100 ? listTarget('b') : null);
  const handlers = () => {
    const drops: [string, Payload][] = [];
    const h: DragHandlers = { accepts: (t, p) => dropAction(p, t, lists) !== null, onDrop: (t, p) => void drops.push([t, p]) };
    return { h, drops };
  };

  it('a press released without moving is a click, not a drag', () => {
    const s = new DragStore(hit);
    const { h, drops } = handlers();
    s.press(10, 10, preset, h);
    expect(s.move(12, 11)).toBe(false);
    expect(s.get()).toBeNull();
    expect(s.release(12, 11)).toBe(false);
    expect(drops).toEqual([]);
  });

  it('follows the pointer once it moves far enough, naming only a target that takes it, and drops there', () => {
    const s = new DragStore(hit);
    const { h, drops } = handlers();
    const seen: (string | null)[] = [];
    s.subscribe(() => seen.push(s.get()?.target ?? null));
    s.press(10, 10, preset, h);
    expect(s.move(50, 10)).toBe(true);
    expect(s.get()).toMatchObject({ x: 50, y: 10, target: null });
    s.move(150, 10);
    expect(isOver(s.get(), listTarget('b'))).toBe(true);
    s.move(250, 10);
    // A smart playlist takes no presets, so it is no target.
    expect(s.get()?.target).toBeNull();
    s.move(150, 10);
    expect(s.release(150, 10)).toBe(true);
    expect(s.get()).toBeNull();
    expect(drops).toEqual([[listTarget('b'), preset]]);
    expect(seen.at(-1)).toBeNull();
  });

  it('drops nothing when let go where nothing takes it', () => {
    const s = new DragStore(hit);
    const { h, drops } = handlers();
    s.press(10, 10, preset, h);
    s.move(150, 10);
    expect(s.release(250, 10)).toBe(true);
    expect(drops).toEqual([]);
  });

  it('cancelled (Escape, the pointer lost), drops nothing and the next move is no drag', () => {
    const s = new DragStore(hit);
    const { h, drops } = handlers();
    s.press(10, 10, preset, h);
    s.move(150, 10);
    s.cancel();
    expect(s.get()).toBeNull();
    expect(s.move(160, 10)).toBe(false);
    expect(s.release(160, 10)).toBe(false);
    expect(drops).toEqual([]);
  });
});
