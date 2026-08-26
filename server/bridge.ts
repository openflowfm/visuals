import { WebSocket } from 'ws';

/**
 * A client of the Session Bridge, and nothing more than a client.
 *
 * This is the second kind of client `CONTRIBUTING.md` anticipated — "a stage
 * display, a CLI — should cost nothing and perturb nothing" — so it obeys rule
 * 5 exactly. It asks for `snapshot` without `fresh`, which the device answers
 * from what it already holds, and it never sends `observe` or `watchSelection`,
 * which are the device's own. Connecting, dropping and reconnecting therefore
 * leave the bridge's knowledge of the set untouched, and no browser has to be
 * open for any of it.
 *
 * The four watches it *does* install are viewport watches, which are a client's
 * to hold, and it drops them by disconnecting.
 */
export interface SetState {
  connected: boolean;
  lomReady: boolean;
  rev: number;
  tempo: number;
  tracks: OpenFlow.Track[];
  scenes: OpenFlow.Scene[];
  /** Keyed `t:s`, because the renderer only ever asks about one cell at a time. */
  clips: Map<string, OpenFlow.Clip>;
  model: OpenFlow.SetModel | null;
  /** Live's own transport, which is the answer Link cannot give on joining. */
  playing: boolean;
  play: OpenFlow.TrackPlayState[];
  levels: Map<number, number>;
  masterLevel: number;
  /**
   * The mixer, which is also the visual mixer.
   *
   * A track's volume is its layer's opacity and its Track Activator is whether
   * the layer draws at all — not an analogy but the same control, because a
   * layer stack composited with a level per layer is what a mixer is. It
   * arrives on `watchMeters` alongside the levels.
   */
  mixer: OpenFlow.MixerState | null;
}

export function emptySet(): SetState {
  return {
    connected: false,
    lomReady: false,
    rev: -1,
    tempo: 120,
    tracks: [],
    scenes: [],
    clips: new Map(),
    model: null,
    playing: false,
    play: [],
    levels: new Map(),
    masterLevel: 0,
    mixer: null,
  };
}

export interface BridgeLink {
  state: SetState;
  close(): void;
}

/**
 * Follows the bridge, reconnecting forever.
 *
 * Forever is deliberate and is the difference between a tool and a show rig:
 * the visuals machine may well be powered on before the one running Live, and
 * a rack that needed starting in the right order is a rack that fails at the
 * worst moment. There is no error to surface and no retry limit — it is either
 * connected or it is trying.
 */
export function followBridge(url: string, onChange: () => void): BridgeLink {
  const state = emptySet();
  let socket: WebSocket | null = null;
  let timer: NodeJS.Timeout | null = null;
  let asking: NodeJS.Timeout | null = null;
  let closed = false;

  const connect = () => {
    if (closed) return;
    socket = new WebSocket(url);

    socket.on('open', () => {
      state.connected = true;
      send({ type: 'snapshot' });
      send({ type: 'watchPlay', on: true });
      send({ type: 'watchMeters', on: true });
      send({ type: 'watchTransport', on: true });
      onChange();
    });

    // Both halves guarded. `take` reads `event.data.rev`, `snap.clips.map` and
    // `event.frame.tracks.map` bare, so a peer sending the right `type` with the
    // wrong shape — a version-skewed device, something else answering on 17800 —
    // used to be the visuals process gone. An event that cannot be read is
    // ignored: the next snapshot re-establishes everything this one carried.
    socket.on('message', (raw) => {
      let event: OpenFlow.Event;
      try {
        event = JSON.parse(String(raw)) as OpenFlow.Event;
      } catch {
        return;
      }
      let moved = false;
      try {
        moved = take(event);
      } catch (err) {
        console.warn(`visuals: bridge sent a ${event?.type} it could not read — ${String(err)}`);
        return;
      }
      if (moved) onChange();
    });

    socket.on('close', () => {
      state.connected = false;
      state.lomReady = false;
      state.rev = -1;
      if (asking) {
        clearTimeout(asking);
        asking = null;
      }
      onChange();
      retry();
    });

    // Without this, a refused connection is an unhandled 'error' that takes the
    // whole process down — which on a visuals machine means a black screen.
    socket.on('error', () => {});
  };

  const retry = () => {
    if (closed || timer) return;
    timer = setTimeout(() => {
      timer = null;
      connect();
    }, 1000);
  };

  const send = (request: OpenFlow.Request) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(request));
  };

  /**
   * Ask again, later, until the set actually arrives.
   *
   * A connected bridge is not the same as a bridge that can answer. The device
   * refuses every request with `device not ready` until `init()` has run in
   * `lom.ts`, which happens on `live.thisdevice` — so a bridge whose device is
   * still coming up, or whose script was recompiled under a loaded device, is
   * reachable and unhelpful.
   *
   * That is the ordinary case on a show rig rather than an edge one: the
   * visuals machine has no reason to be started after the one running Live, and
   * a rack that had to be powered on in the right order is a rack that fails at
   * the worst moment. So this asks once a second until it is answered, and stops
   * the moment `rev` says a set landed.
   */
  const askAgain = () => {
    if (closed || asking || state.rev >= 0) return;
    asking = setTimeout(() => {
      asking = null;
      if (closed || state.rev >= 0) return;
      send({ type: 'snapshot' });
      askAgain();
    }, 1000);
  };

  /** Returns whether anything a renderer cares about actually moved. */
  const take = (event: OpenFlow.Event): boolean => {
    switch (event.type) {
      case 'status':
        state.lomReady = event.lomReady;
        // The LOM going ready is the signal that an earlier refusal is worth
        // retrying, and it arrives unprompted.
        if (event.lomReady && state.rev < 0) send({ type: 'snapshot' });
        askAgain();
        return true;
      case 'snapshot': {
        const snap = event.data;
        // Checked before the first assignment rather than caught after it: a
        // half-applied snapshot is a set with a new `rev` and the old clips,
        // which is worse than no snapshot at all.
        if (!snap || !Array.isArray(snap.clips) || !Array.isArray(snap.tracks)) return false;
        state.rev = snap.rev;
        state.tempo = snap.tempo;
        state.tracks = snap.tracks;
        state.scenes = snap.scenes;
        state.clips = new Map(snap.clips.map((clip) => [`${clip.t}:${clip.s}`, clip]));
        state.model = event.model;
        return true;
      }
      case 'delta':
        // A delta is a partial re-read. Rather than patching a copy of the set
        // here — which is the bridge's job and it already does it — ask for the
        // set again. It costs the device nothing: `snapshot` with no `fresh` is
        // answered from what it holds.
        if (event.model) state.model = event.model;
        send({ type: 'snapshot' });
        return true;
      case 'playState':
        if (!Array.isArray(event.tracks)) return false;
        state.playing = event.isPlaying;
        state.play = event.tracks;
        return true;
      case 'transportState':
        state.tempo = event.state.tempo;
        return true;
      case 'mixerState':
        state.mixer = event.state;
        // Not a change, for the same reason levels aren't: everything a
        // renderer reads off the mixer is a layer's opacity, and opacity rides
        // the anchor. Someone riding a fader would otherwise turn every push
        // into a full one, which is the traffic this split exists to avoid.
        return false;
      case 'meterLevels':
        if (!event.frame || !Array.isArray(event.frame.tracks)) return false;
        state.masterLevel = event.frame.master;
        state.levels = new Map(event.frame.tracks.map((row) => [row.t, row.level]));
        // Levels move 30 times a second and are read, never diffed against.
        // Saying "nothing changed" keeps them out of the push scheduler.
        return false;
      case 'error':
        // Never fatal here. The device refuses everything until it is ready,
        // and the only useful response is to ask again rather than to give up
        // or to take the process down with an unhandled rejection.
        askAgain();
        return false;
      default:
        return false;
    }
  };

  connect();

  return {
    state,
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      if (asking) clearTimeout(asking);
      socket?.close();
    },
  };
}
