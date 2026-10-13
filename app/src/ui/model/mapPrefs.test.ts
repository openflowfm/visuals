// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AXES } from './field';
import { MAP_AXES_KEY, readAxes, setMapAxes, useMapAxes } from './mapPrefs';

describe('readAxes', () => {
  it('reads a whole choice', () => {
    expect(readAxes('{"across":"intensity","up":"hue","colour":"style"}')).toEqual({ across: 'intensity', up: 'hue', colour: 'style' });
  });

  it('takes the default for nothing, bad JSON or not an object', () => {
    expect(readAxes(null)).toEqual(DEFAULT_AXES);
    expect(readAxes('')).toEqual(DEFAULT_AXES);
    expect(readAxes('{across')).toEqual(DEFAULT_AXES);
    expect(readAxes('"speed"')).toEqual(DEFAULT_AXES);
    expect(readAxes('[1,2]')).toEqual(DEFAULT_AXES);
    expect(readAxes('null')).toEqual(DEFAULT_AXES);
  });

  it('fills a partial choice from the default, field by field', () => {
    expect(readAxes('{"across":"rating"}')).toEqual({ across: 'rating', up: 'brightness', colour: 'hue' });
    expect(readAxes('{"colour":"rating"}')).toEqual({ ...DEFAULT_AXES, colour: 'rating' });
  });

  it('drops unknown ids', () => {
    expect(readAxes('{"across":"loudness","up":"style","colour":"mood"}')).toEqual({ across: 'speed', up: 'style', colour: 'hue' });
    expect(readAxes('{"across":3,"up":true,"colour":null}')).toEqual(DEFAULT_AXES);
  });

  it('never keeps the same axis both ways', () => {
    expect(readAxes('{"across":"hue","up":"hue"}')).toEqual({ across: 'hue', up: 'brightness', colour: 'hue' });
    expect(readAxes('{"across":"brightness","up":"brightness"}')).toEqual({ across: 'brightness', up: 'speed', colour: 'hue' });
  });
});

describe('the axes kept', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  afterEach(() => {
    setMapAxes(DEFAULT_AXES);
    vi.unstubAllGlobals();
  });

  /** Another window keeping `value` under `key`, as the page hears it. */
  const elsewhere = (key: string | null, value: string | null) =>
    act(() => {
      if (key !== null && value !== null) store.set(key, value);
      window.dispatchEvent(new StorageEvent('storage', { key, newValue: value }));
    });

  it('follows a choice another window keeps', () => {
    const { result } = renderHook(() => useMapAxes());
    expect(result.current[0]).toEqual(DEFAULT_AXES);
    elsewhere(MAP_AXES_KEY, '{"across":"intensity","up":"hue","colour":"style"}');
    expect(result.current[0]).toEqual({ across: 'intensity', up: 'hue', colour: 'style' });
  });

  it("reads storage again when it's cleared, and leaves other keys alone", () => {
    const { result } = renderHook(() => useMapAxes());
    act(() => result.current[1]({ across: 'rating', up: 'hue', colour: 'style' }));
    // Another key changing elsewhere: the choice held stands, though storage now says otherwise.
    store.set(MAP_AXES_KEY, '{"across":"intensity"}');
    elsewhere('visuals.other', '1');
    expect(result.current[0]).toEqual({ across: 'rating', up: 'hue', colour: 'style' });
    // Storage cleared elsewhere (`key` null): what it holds now, nothing, is the default.
    store.clear();
    elsewhere(null, null);
    expect(result.current[0]).toEqual(DEFAULT_AXES);
  });
});
