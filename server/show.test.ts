import { describe, expect, it } from 'vitest';
import type { Scheme } from '../protocol.ts';
import { emptySet, type SetState } from './bridge.ts';
import type { LinkFrame } from './link.ts';
import { merge, type SchemeSource } from './scheme.ts';
import { buildShow, noTurning, type Turning } from './show.ts';
import { atOne, atTurn, nextFlow, poolsOf, reOne, turnsAt, whatIsUp } from '../resolve.ts';

/**
 * What is on screen, and why.
 *
 * The cascade this file used to guard is gone: what a track draws is wired in a
 * graph now, so there is no per-track resolution left to get wrong. What
 * replaced it is a **wheel**, and the bugs a wheel has are the ones worth being
 * sure about — a pool that reads empty as "nothing", a cycle that repeats across
 * a lap, a trigger that fires on every scene launch, and an override that black
 * screens a song because it names a flow somebody deleted. Every one of those
 * looks like a rendering fault from the front of house and none of them is.
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
  }) as unknown as OpenFlow.Track;

const scene = (i: number, name: string) =>
  ({
    i,
    name,
    color: 0,
    colorIndex: -1,
    tempo: -1,
    timeSignature: '',
  }) as unknown as OpenFlow.Scene;

const clip = (t: number, s: number, name: string) =>
  ({
    t,
    s,
    name,
    colorIndex: 0,
    color: 0,
    length: 4,
    isMidi: true,
  }) as unknown as OpenFlow.Clip;

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
  return { current: () => scheme, error: () => null };
}

/** A two-track set with one scene playing, which is the smallest real show. */
function setOf(names: string[], sceneName: string, clips: Record<number, string> = {}): SetState {
  const state = emptySet();
  state.connected = true;
  state.lomReady = true;
  state.playing = true;
  state.tracks = names.map((name, i) => track(i, name));
  state.scenes = [scene(0, sceneName)];
  state.play = names.map(() => ({ playing: 0, fired: -1 }) as OpenFlow.TrackPlayState);
  for (const [t, name] of Object.entries(clips)) {
    state.clips.set(`${t}:0`, clip(Number(t), 0, name));
  }
  state.model = {
    rev: 1,
    songs: [],
    songByScene: { '0': 'sandstorm' },
  } as unknown as OpenFlow.SetModel;
  return state;
}


const show = (state: SetState, scheme: Scheme, turning = noTurning()) =>
  buildShow(state, LINK, sourceOf(scheme), turning);

/** The same, at some point on Link's clock rather than at its zero. */
const at = (
  state: SetState,
  scheme: Scheme,
  turning: Turning,
  link: Partial<LinkFrame>,
) => buildShow(state, { ...LINK, ...link }, sourceOf(scheme), turning);

/** A scheme with two named flows and two colourways, and nothing else said. */
const twoOf = (over: Partial<Scheme> = {}): Scheme =>
  merge({
    flows: {
      a: { name: 'A', circuit: { nodes: [], cords: [] } },
      b: { name: 'B', circuit: { nodes: [], cords: [] } },
    },
    colorways: { one: ['#111111'], two: ['#222222'] },
    rotation: { flows: ['a', 'b'], colorways: ['one', 'two'], bars: 4, onClip: true, colorEvery: 4 },
    ...over,
  });

describe('what is up', () => {
  it('turns through the pool rather than picking each time', () => {
    // A shuffled cycle, not independent picks. Independent picks feel random and
    // read as broken: the same flow twice in a row looks like the change failed,
    // and one of five never appearing looks like it is unwired.
    const scheme = twoOf();
    const seen = new Set<string>();
    for (let turn = 0; turn < 6; turn++) {
      seen.add(atTurn(['a', 'b', 'c'], turn) ?? '');
    }
    expect(seen).toEqual(new Set(['a', 'b', 'c']));
    // And it is the same answer every time it is asked, so the server and the
    // editor cannot disagree about what is on screen.
    expect(atTurn(['a', 'b', 'c'], 4)).toBe(atTurn(['a', 'b', 'c'], 4));
    expect(whatIsUp(scheme, null, { flow: 0, color: 0 }).flow).toBeTruthy();
  });

  it('shows all of them before it shows any of them twice', () => {
    const pool = ['a', 'b', 'c', 'd', 'e'];
    const lap = [0, 1, 2, 3, 4].map((turn) => atTurn(pool, turn));
    expect(new Set(lap).size).toBe(5);
  });

  it('never repeats across the join between two laps', () => {
    // The one repeat a shuffled cycle can still make, and the one that reads as
    // the wheel having jammed rather than as chance.
    const pool = ['a', 'b', 'c', 'd'];
    for (let lap = 0; lap < 6; lap++) {
      const last = atTurn(pool, lap * 4 + 3);
      const first = atTurn(pool, lap * 4 + 4);
      expect(first).not.toBe(last);
    }
  });

  it('treats an empty pool as everything rather than as nothing', () => {
    // The state a fresh install is in. Reading a blank field as "draw nothing"
    // would be a black screen for the thing nobody filled in.
    const scheme = twoOf({ rotation: { flows: [], colorways: [], bars: 4, onClip: true, colorEvery: 4 } });
    const pools = poolsOf(scheme, undefined);
    expect(pools.flows.length).toBeGreaterThan(1);
    expect(pools.colorways.length).toBeGreaterThan(1);
  });

  it('lets a song pin one flow and stop the wheel', () => {
    const scheme = twoOf({ songs: { sandstorm: { flows: ['b'], colorway: 'two' } } });
    const drawn = show(setOf(['Bass'], '[VERSE] one'), scheme);
    expect(drawn.flow).toBe('b');
    expect(drawn.colorway).toBe('two');
    expect(drawn.pinned).toBe(true);
  });

  it('lets a song name three and still turn through those three', () => {
    // A shorter rotation is still a rotation. That is what makes the override
    // cheap to reach for: "these three, for this song" should not need a second
    // concept to express.
    const scheme = twoOf({ songs: { sandstorm: { flows: ['a', 'b'] } } });
    const pools = poolsOf(scheme, scheme.songs.sandstorm);
    expect(pools.flows).toEqual(['a', 'b']);
    expect(whatIsUp(scheme, 'sandstorm', { flow: 0, color: 0 }).pinned).toBe(false);
  });

  it('drops a song pin that names a flow nobody has any more', () => {
    // A stale id must not black the screen for a whole song.
    const scheme = twoOf({ songs: { sandstorm: { flows: ['gone'] } } });
    const drawn = show(setOf(['Bass'], '[VERSE] one'), scheme);
    expect(drawn.flow).toBeTruthy();
    expect(scheme.flows[drawn.flow!]).toBeDefined();
  });
});

describe('turning on musical time', () => {
  it('counts bars, not seconds', () => {
    const rotation = twoOf().rotation;
    expect(turnsAt(rotation, 0, 4, atOne()).flow).toBe(0);
    expect(turnsAt(rotation, 15.9, 4, atOne()).flow).toBe(0);
    expect(turnsAt(rotation, 16, 4, atOne()).flow).toBe(1);
  });

  it('holds whatever is up when the wheel is stopped', () => {
    const rotation = { ...twoOf().rotation, bars: 0, colorEvery: 0 };
    expect(turnsAt(rotation, 400, 4, atOne()).flow).toBe(0);
  });

  it('turns when a clip is fired out of band, and not when a scene is', () => {
    // A scene launch moves every track at once; a clip launch moves one. Scenes
    // fire constantly, so a picture that changed with every one would never
    // settle — and reaching past the grid for one clip is already the "and now
    // something else" gesture of a live set.
    const turning = noTurning();
    const scheme = twoOf();
    const set = setOf(['Drums', 'Bass', 'Keys'], '[VERSE] one');
    show(set, scheme, turning);
    expect(turning.wheel.turned.flow).toBe(0);

    // Everything moves to scene 1: a scene launch.
    set.scenes = [set.scenes[0], scene(1, '[CHORUS] one')];
    set.play = set.play.map(() => ({ playing: 1, fired: -1 }) as OpenFlow.TrackPlayState);
    show(set, scheme, turning);
    expect(turning.wheel.turned.flow).toBe(0);

    // One track departs: a clip launch.
    set.play[2] = { playing: 0, fired: -1 } as OpenFlow.TrackPlayState;
    show(set, scheme, turning);
    expect(turning.wheel.turned.flow).toBe(1);
  });

  it('turns only the flow when asked for the next one by hand', () => {
    const before = { one: 12, turned: { flow: 4, color: 2 } };
    expect(nextFlow(before)).toEqual({ one: 12, turned: { flow: 5, color: 2 } });
    expect(before.turned).toEqual({ flow: 4, color: 2 });
  });

  it('does not count the first read as a change', () => {
    // Otherwise the wheel would advance every time a browser connected, which
    // is the sort of thing that looks like a haunted rig.
    const turning = noTurning();
    const set = setOf(['Drums', 'Bass'], '[VERSE] one');
    set.play[1] = { playing: 3, fired: -1 } as OpenFlow.TrackPlayState;
    show(set, twoOf(), turning);
    expect(turning.wheel.turned.flow).toBe(0);
  });

  it('counts the phrase from the one, not from Link\'s zero', () => {
    // Link's beat is one session timeline that started whenever the first peer
    // in the building opened a laptop, so a 32-bar wheel counted from its zero
    // turns on a boundary with nothing to do with the music — and stays there.
    const rotation = twoOf().rotation;
    const wheel = { one: 8, turned: { flow: 0, color: 0 } };
    // 16 beats is four bars, so the first turn is now at 24 rather than at 16.
    expect(turnsAt(rotation, 23.9, 4, wheel).flow).toBe(0);
    expect(turnsAt(rotation, 24, 4, wheel).flow).toBe(1);
  });

  it('re-phases without turning, so saying "here is the one" changes nothing', () => {
    // The gesture is made when the picture is right and the timing is not. A
    // reset lands on a downbeat, which is exactly where a naive count snaps the
    // wheel back to the start of its cycle — so it would change the flow every
    // single time, which is the opposite of what was asked for.
    const rotation = twoOf().rotation;
    const before = turnsAt(rotation, 100, 4, atOne());
    const moved = reOne(rotation, { beat: 100, phase: 0, quantum: 4 }, atOne());
    expect(moved.one).toBe(100);
    expect(turnsAt(rotation, 100, 4, moved)).toEqual(before);
    // What *does* change is when the next one happens: sixteen beats from here
    // rather than from wherever Link happened to start.
    expect(turnsAt(rotation, 115.9, 4, moved).flow).toBe(before.flow);
    expect(turnsAt(rotation, 116, 4, moved).flow).toBe(before.flow + 1);
  });

  it('takes the one off the bar line Link draws, not off a whole beat', () => {
    // Link's beat has no bar 1 in it — it started whenever the first peer did —
    // so a whole beat of it is not a downbeat. `phase` is the part that is
    // musical, and the line it points at is the line Live's own grid is on.
    const rotation = twoOf().rotation;
    const at = (beat: number, phase: number) => reOne(rotation, { beat, phase, quantum: 4 }, atOne());
    // Two beats into the bar: the line was at 98.4, and rounding the beat would
    // have said 100.
    expect(at(100.4, 2).one).toBeCloseTo(98.4);
    // Three quarters of the way through: the downbeat meant is the coming one.
    expect(at(100.4, 3).one).toBeCloseTo(101.4);
  });

  it('takes the one from Live starting, and only from it starting', () => {
    const turning = noTurning();
    const scheme = twoOf();
    const set = setOf(['Drums', 'Bass'], '[VERSE] one');
    set.playing = false;
    expect(at(set, scheme, turning, { beat: 8, phase: 0 }).one).toBe(0);

    // Rolling the transport is the clearest statement of where a phrase begins
    // that this rig will ever get, and it costs nobody a gesture. No peers, so
    // no wait: with nobody to start together with, Live rolls immediately.
    set.playing = true;
    expect(at(set, scheme, turning, { beat: 8, phase: 0 }).one).toBe(8);

    // Still playing is not starting. Re-phasing every second would leave the
    // wheel unable to reach a boundary at all.
    turning.wheel = { ...turning.wheel, one: 40 };
    expect(at(set, scheme, turning, { beat: 20, phase: 0 }).one).toBe(40);
  });

  it('waits for the bar line Live is going to start on', () => {
    // With a session up, pressing play does not start playback — it arms it,
    // and Live waits for the next bar so every machine starts together. The
    // transport flag goes true at the *press*, which is up to a whole bar
    // early, so taking the one from that moment puts the phrase a bar out for
    // the rest of the night.
    const turning = noTurning();
    const scheme = twoOf();
    const set = setOf(['Drums', 'Bass'], '[VERSE] one');
    set.playing = false;
    at(set, scheme, turning, { beat: 100, phase: 0, peers: 1 });

    // Play, pressed a beat and a half into the bar. Nothing happens yet.
    set.playing = true;
    expect(at(set, scheme, turning, { beat: 101.5, phase: 1.5, peers: 1 }).one).toBe(0);
    expect(at(set, scheme, turning, { beat: 103.5, phase: 3.5, peers: 1 }).one).toBe(0);

    // The phase drops: the bar line has arrived and so has the music.
    expect(at(set, scheme, turning, { beat: 104.1, phase: 0.1, peers: 1 }).one).toBeCloseTo(104);
  });

  it('ignores an out-of-band clip when the rotation was told to', () => {
    const scheme = twoOf({
      rotation: { flows: [], colorways: [], bars: 4, onClip: false, colorEvery: 4 },
    });
    const turning = noTurning();
    const set = setOf(['Drums', 'Bass'], '[VERSE] one');
    show(set, scheme, turning);
    set.play[1] = { playing: 5, fired: -1 } as OpenFlow.TrackPlayState;
    show(set, scheme, turning);
    expect(turning.wheel.turned.flow).toBe(0);
  });
});

describe('the tracks', () => {
  it('takes colour from the colourway and never from the clip', () => {
    // Clip colour is navigation — how you find your place in the grid during a
    // show — and driving the picture from it would force a choice between a set
    // you can read and a set that looks right.
    const scheme = twoOf({ songs: { sandstorm: { colorway: 'one' } } });
    const drawn = show(setOf(['Bass', 'Lead'], '[VERSE] one', { 0: 'red one' }), scheme);
    expect(drawn.tracks[0].color).toBe(0x111111);
    expect(drawn.colors[0]).toBe(0x111111);
  });

  it('does not make a track out of a group track', () => {
    // A group carries no clips of its own, so drawing one would double
    // everything inside it.
    const set = setOf(['Drums', 'Bass'], '[VERSE] one');
    set.tracks = [track(0, 'Drums'), track(1, 'Group', true), track(2, 'Bass')];
    set.play = [0, 1, 2].map(() => ({ playing: 0, fired: -1 }) as OpenFlow.TrackPlayState);
    expect(show(set, twoOf()).tracks.map((t) => t.name)).toEqual(['Drums', 'Bass']);
  });

  it('offers the set its own roles and songs, for an editor to pick from', () => {
    const drawn = show(setOf(['Bass'], '[VERSE] one'), twoOf());
    expect(drawn.roles).toEqual(['VERSE']);
    expect(drawn.songs).toEqual(['sandstorm']);
  });
});
