import { beforeEach, describe, expect, it } from 'vitest';
import { liveMapScope, resetLiveMapScope, setLiveMapScope } from './scope';

describe("the map's session scope", () => {
  beforeEach(() => resetLiveMapScope());

  it('starts on this set', () => {
    expect(liveMapScope()).toBe('set');
  });

  it('remembers the scope picked last', () => {
    setLiveMapScope('library');
    expect(liveMapScope()).toBe('library');
  });

  it('starts over on this set when reset', () => {
    setLiveMapScope('library');
    resetLiveMapScope();
    expect(liveMapScope()).toBe('set');
  });
});
