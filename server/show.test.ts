import { describe, expect, it } from 'vitest';
import type { Scheme } from '../protocol.ts';
import { emptySet, type SetState } from './bridge.ts';
import type { LinkFrame } from './link.ts';
import { BUILT_IN, merge, type SchemeSource } from './scheme.ts';
import { buildShow } from './show.ts';

/**
 * The cascade, which is the part of this that is worth being sure about.
 *
 * Every bug this file guards against looked like a rendering fault from the
 * front of house: a layer missing for a whole verse, a pad drawing as a drum, a
 * chorus that never got louder. None of them were in a shader.
 */

const track = (i: number, name: string, isGroup = false) =>
  ({
    i,
    name,
    color: 0,
    colorIndex: 0,
    isMidi: true,
    isGroup,
    isGrouped: false,
    group: -1,
  }) as unknown as BSV.Track;

const scene = (i: number, name: string) =>
  ({
    i,
    name,
    color: 0,
    colorIndex: -1,
    tempo: -1,
    timeSignature: '',
  }) as unknown as BSV.Scene;

const clip = (t: number, s: number, name: string) =>
  ({
    t,
    s,
    name,
    colorIndex: 0,
    color: 0,
    length: 4,
    isMidi: true,
  }) as unknown as BSV.Clip;

const LINK: LinkFrame = {
  tempo: 120,
  beat: 0,
  phase: 0,
  quantum: 4,
  peers: 0,
  playing: true,
  at: 0,
};

function sourceOf(scheme: Scheme): SchemeSource {
  return { current: () => scheme, replace() {}, error: () => null, stop() {} };
}

/** A two-track set with one scene playing, which is the smallest real show. */
function setOf(names: string[], sceneName: string, clips: Record<number, string> = {}): SetState {
  const state = emptySet();
  state.connected = true;
  state.lomReady = true;
  state.playing = true;
  state.tracks = names.map((name, i) => track(i, name));
  state.scenes = [scene(0, sceneName)];
  state.play = names.map(() => ({ playing: 0, fired: -1 }) as BSV.TrackPlayState);
  for (const [t, name] of Object.entries(clips)) {
    state.clips.set(`${t}:0`, clip(Number(t), 0, name));
  }
  state.model = {
    rev: 1,
    songs: [],
    songByScene: { '0': 'sandstorm' },
  } as unknown as BSV.SetModel;
  return state;
}

const show = (state: SetState, scheme: Scheme) => buildShow(state, LINK, sourceOf(scheme));

describe('the cascade', () => {
  it('takes colour from the song and never from the clip', () => {
    // The rule Ryan set: clip colours are how you find your place in the grid
    // during a show, and driving the picture from them would force a choice
    // between a set you can navigate and a set that looks right.
    const scheme = merge({ songs: { sandstorm: { colorway: 'ember' } } });
    const drawn = show(setOf(['Bass'], '[VERSE] one', { 0: 'anything' }), scheme);
    expect(drawn.colorway).toBe('ember');
    expect(drawn.layers[0].color).toBe(0xff5a3c);
  });

  it('falls back rather than going dark for a song nobody assigned', () => {
    const drawn = show(setOf(['Bass'], '[VERSE] one'), BUILT_IN);
    expect(drawn.colorway).toBe(BUILT_IN.defaults.colorway);
  });

  it('lets a song say how hard it plays its own sections', () => {
    const plain = show(setOf(['Bass'], '[VERSE] one'), BUILT_IN);
    const harder = show(
      setOf(['Bass'], '[VERSE] one'),
      merge({ songs: { sandstorm: { bias: 0.3 } } }),
    );
    expect(harder.energy).toBeCloseTo(plain.energy + 0.3);
  });

  it('guesses an unbound track from its name', () => {
    const drawn = show(setOf(['Drums', 'Sparkle Pad'], '[VERSE] one'), BUILT_IN);
    expect(drawn.layers[0].looks[0].id).toBe('strobe');
    expect(drawn.layers[1].looks[0].id).toBe('noise');
  });

  it('lets a binding change one field and leave the hint the rest', () => {
    // The reason bindings are field-by-field. Saying "this drum track is calmer"
    // must not also throw away "this drum track is a drum".
    const drawn = show(
      setOf(['Drums'], '[VERSE] one'),
      merge({ layers: { Drums: { bias: -0.2 } } }),
    );
    expect(drawn.layers[0].looks[0].id).toBe('strobe');
    expect(drawn.layers[0].energy).toBeCloseTo(0.35 - 0.2);
  });

  it("lets a clip be the exception, and adds its bias to the track's", () => {
    const scheme = merge({
      layers: { Lead: { bias: 0.1, looks: ['rings'] } },
      clips: { 'quiet one': { bias: -0.3, looks: ['noise'] } },
    });
    const drawn = show(setOf(['Lead'], '[VERSE] one', { 0: 'quiet one' }), scheme);
    expect(drawn.layers[0].looks[0].id).toBe('noise');
    expect(drawn.layers[0].energy).toBeCloseTo(0.35 + 0.1 - 0.3);
  });

  it('adds effects across the levels rather than replacing them', () => {
    // "The chorus should mix in more frenetic effects" is additive by
    // construction: the section contributes its character, the track its own,
    // and both survive.
    const scheme = merge({
      layers: { Lead: { looks: ['shift'] } },
      defaults: { ...BUILT_IN.defaults, maxLooks: 3 },
    });
    const drawn = show(setOf(['Lead'], '[CHORUS] one'), scheme);
    // The base leads, because a stack has to start with something that draws.
    // Everything after it is what the levels contributed, in the order they did.
    expect(drawn.layers[0].offers).toEqual(['rings', 'kaleido', 'ripple', 'shift']);
  });

  it('caps the pile and dials the survivors in by energy', () => {
    const loud = show(setOf(['Lead'], '[CHORUS] one'), BUILT_IN).layers[0];
    const quiet = show(setOf(['Lead'], '[INTRO] one'), BUILT_IN).layers[0];
    // A base and two on top of it, which is what `maxLooks: 3` means now that
    // the base counts toward the cap.
    expect(loud.looks).toHaveLength(3);
    // The base always draws at full. Energy thins the stack above it and the
    // floor gate decides whether the layer is in at all — dimming the base as
    // well would be dimming the same thing twice.
    expect(loud.looks[0].amount).toBeCloseTo(1);
    expect(loud.looks[1].amount).toBeGreaterThan(0.5);
    // An intro keeps its base and barely opens anything over it.
    expect(quiet.looks.length).toBeLessThanOrEqual(2);
    expect(quiet.looks[0].amount).toBeCloseTo(1);
  });

  it('drops an id naming a look that no longer exists', () => {
    // Deleting a look strips its references, but a hand-edited file can still
    // name one. A missing look must cost that pass and not the show — and the
    // base survives it, so the layer still draws something.
    const scheme = merge({
      archetypes: { VERSE: { energy: 0.9, looks: ['ghost'] } },
    });
    expect(show(setOf(['Lead'], '[VERSE] one'), scheme).layers[0].offers).toEqual(['rings']);
  });

  it('gates presence on the section, not on the layer', () => {
    // The bug this assertion exists for. A pad carrying a negative bias is
    // asking to be *calmer*; tested against its own biased energy it went
    // *absent* for the whole of every verse instead.
    const scheme = merge({ layers: { Pad: { bias: -0.3, floor: 0.3 } } });
    const drawn = show(setOf(['Bass', 'Pad'], '[VERSE] one'), scheme);
    const pad = drawn.layers[1];
    expect(pad.energy).toBeLessThan(drawn.energy);
    expect(pad.opacity).toBeGreaterThan(0);
  });

  it('hides a layer that asked to be hidden, and still lists it', () => {
    // Listed because it is still a track, and a layer you cannot see in the
    // editor is a layer you cannot turn back on.
    const drawn = show(
      setOf(['Bass', 'Click'], '[VERSE] one'),
      merge({ layers: { Click: { hide: true } } }),
    );
    expect(drawn.layers).toHaveLength(2);
    expect(drawn.layers[1].hidden).toBe(true);
    expect(drawn.layers[1].opacity).toBe(0);
    expect(drawn.layers[1].looks).toEqual([]);
  });

  it('does not make a layer out of a group track', () => {
    // A group carries no clips of its own, so drawing one would double every
    // layer inside it.
    const state = setOf(['Bass', 'Drums'], '[VERSE] one');
    state.tracks = [track(0, 'Bass'), track(1, 'Band', true), track(2, 'Drums')];
    expect(show(state, BUILT_IN).layers.map((l) => l.name)).toEqual(['Bass', 'Drums']);
  });

  it('offers the set its own roles and songs, for an editor to pick from', () => {
    const state = setOf(['Bass'], '[CHORUS] one');
    state.scenes = [scene(0, '[CHORUS] one'), scene(1, '[VERSE] two'), scene(2, 'untitled')];
    const drawn = show(state, BUILT_IN);
    expect(drawn.roles).toEqual(['CHORUS', 'VERSE']);
    expect(drawn.songs).toEqual(['sandstorm']);
  });
});
