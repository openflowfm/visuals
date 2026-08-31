import { describe, expect, it } from 'vitest';
import {
  budgetPictures,
  LIVE_PICTURE_LIMIT,
  LIVE_PICTURE_ZOOM_FLOOR,
} from './pictureBudget.ts';

const ids = Array.from({ length: 14 }, (_, at) => `node-${at + 1}`);

function budget(
  change: Partial<Parameters<typeof budgetPictures>[0]> = {},
): ReturnType<typeof budgetPictures> {
  return budgetPictures({
    ids,
    visible: new Set(ids),
    promoted: null,
    out: 'node-14',
    enabled: true,
    scale: 1,
    ...change,
  });
}

describe('the live node-picture budget', () => {
  it('culls faces outside the graph viewport before spending the budget', () => {
    const result = budget({ visible: new Set(['node-2', 'node-5', 'node-14']) });

    expect(result.live).toEqual(['node-2', 'node-5', 'node-14']);
    expect(result.paused).toEqual([]);
    expect(result.culled).toEqual(ids.filter((id) => !['node-2', 'node-5', 'node-14'].includes(id)));
    expect(result.counts).toEqual({ mounted: 14, visible: 3, live: 3, paused: 0, culled: 11 });
  });

  it('caps live faces at ten and freezes the rest', () => {
    const result = budget();

    expect(result.live).toHaveLength(LIVE_PICTURE_LIMIT);
    expect(result.paused).toHaveLength(4);
    expect(result.counts).toEqual({ mounted: 14, visible: 14, live: 10, paused: 4, culled: 0 });
  });

  it('reserves slots for the promoted face and out', () => {
    const result = budget({ promoted: 'node-13' });

    expect(result.live).toEqual([
      'node-1',
      'node-2',
      'node-3',
      'node-4',
      'node-5',
      'node-6',
      'node-7',
      'node-8',
      'node-13',
      'node-14',
    ]);
    expect(result.paused).toEqual(['node-9', 'node-10', 'node-11', 'node-12']);
  });

  it('does not let invisible priorities consume live slots', () => {
    const visible = new Set(ids.slice(0, 12));
    const result = budget({ visible, promoted: 'node-13', out: 'node-14' });

    expect(result.live).toEqual(ids.slice(0, LIVE_PICTURE_LIMIT));
    expect(result.paused).toEqual(['node-11', 'node-12']);
    expect(result.culled).toEqual(['node-13', 'node-14']);
  });

  it('pauses every visible face when pictures are turned off', () => {
    const result = budget({ enabled: false });

    expect(result.live).toEqual([]);
    expect(result.paused).toEqual(ids);
    expect(result.counts.live).toBe(0);
    expect(result.counts.paused).toBe(14);
  });

  it('pauses below the zoom floor and draws at the boundary', () => {
    expect(budget({ scale: LIVE_PICTURE_ZOOM_FLOOR - 0.001 }).live).toEqual([]);
    expect(budget({ scale: LIVE_PICTURE_ZOOM_FLOOR }).live).toHaveLength(LIVE_PICTURE_LIMIT);
  });

  it('keeps every output in circuit order across repeated schedules', () => {
    const input = {
      visible: new Set(['node-2', 'node-4', 'node-6', 'node-8', 'node-10', 'node-12', 'node-14']),
      promoted: 'node-12',
      out: 'node-14',
      limit: 4,
    };

    const first = budget(input);
    const second = budget(input);
    expect(first).toEqual(second);
    expect(first.live).toEqual(['node-2', 'node-4', 'node-12', 'node-14']);
    expect(first.paused).toEqual(['node-6', 'node-8', 'node-10']);
    expect(first.culled).toEqual(ids.filter((id) => !input.visible.has(id)));
  });
});
