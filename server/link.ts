import { createRequire } from 'node:module';

/**
 * The Ableton Link peer, and the only thing here that knows what time it is.
 *
 * **Visuals follow; they never drive.** Nothing in this file sets the tempo or
 * the transport, and there is no method to. Link has no private session — it is
 * the whole local network — so a peer that could set the tempo is a peer that
 * can yank the tempo of every machine at the show, including the one playing
 * the set. Following is also simply what a visuals rig is for.
 *
 * The division of labour with the bridge is the load-bearing part of the
 * design. **Link says *when*: tempo, and a continuous beat position shared
 * across machines to within a few milliseconds. The bridge says *what*: which
 * song, which scene, which clip, which track, how loud.** Neither can answer
 * the other's question — Link has no idea a clip exists, and the bridge's
 * `songPosition` is quantised to sixteenths and only crosses the network on a
 * change.
 *
 * One consequence worth knowing, because it looks like a bug: **a peer joining
 * a session that is already playing is not told so.** Link shares start/stop
 * transitions, not the standing state, so starting this server while Live is
 * already rolling leaves `playing` false until the next stop or start. That is
 * why `Show.playing` is answered from the bridge and not from here.
 */
export interface LinkFrame {
  tempo: number;
  /** Link's session beat. Continuous, shared, and not aligned to anything musical. */
  beat: number;
  /** Position within the quantum, in beats. */
  phase: number;
  quantum: number;
  peers: number;
  /** Link's own start/stop state. See the caveat above before trusting it. */
  playing: boolean;
  /**
   * `Date.now()` when the three above were sampled.
   *
   * The browser extrapolates from this rather than being pushed a beat per
   * frame: a 10 Hz push of the anchor plus local extrapolation is smooth at any
   * refresh rate, where a 10 Hz push of the *position* would visibly step. See
   * `docs/link.md`.
   */
  at: number;
}

interface Addon {
  enable(on: boolean): void;
  isEnabled(): boolean;
  getTempo(): number;
  getBeat(): number;
  getPhase(quantum: number): number;
  getNumPeers(): number;
  isPlaying(): boolean;
  enableStartStopSync(on: boolean): void;
  setTempoCallback(fn: (tempo: number) => void): void;
  setNumPeersCallback(fn: (peers: number) => void): void;
  setStartStopCallback(fn: (playing: boolean) => void): void;
}

export interface LinkPeer {
  sample(): LinkFrame;
  /** False when the native addon is missing; every field then reads as a resting clock. */
  readonly live: boolean;
  stop(): void;
}

/**
 * A peer that always answers, so the renderer has one code path.
 *
 * The addon is native and has to compile, which is the one part of this module
 * that can fail on a machine we have never seen. When it does, the show still
 * runs at a fixed tempo off the wall clock rather than not running at all —
 * the failure mode a stage rig wants, and the same instinct as the bridge
 * preferring an empty snapshot to a broken one.
 */
export function openLink(bpm = 120, quantum = 4): LinkPeer {
  let addon: Addon | null = null;
  try {
    const require = createRequire(import.meta.url);
    const { AbletonLink } = require('@ktamas77/abletonlink');
    addon = new AbletonLink(bpm) as Addon;
    addon.enableStartStopSync(true);
    addon.enable(true);
  } catch (err) {
    console.warn(
      `link: running without a clock — ${(err as Error).message}\n` +
        '      build it with: cd visuals && npm run build:link',
    );
    addon = null;
  }

  const held = addon;
  const from = Date.now();

  return {
    live: held !== null,
    sample(): LinkFrame {
      if (!held) {
        const beat = ((Date.now() - from) / 1000) * (bpm / 60);
        return {
          tempo: bpm,
          beat,
          phase: ((beat % quantum) + quantum) % quantum,
          quantum,
          peers: 0,
          playing: false,
          at: Date.now(),
        };
      }
      return {
        tempo: held.getTempo(),
        beat: held.getBeat(),
        phase: held.getPhase(quantum),
        quantum,
        peers: held.getNumPeers(),
        playing: held.isPlaying(),
        at: Date.now(),
      };
    },
    stop() {
      held?.enable(false);
    },
  };
}
