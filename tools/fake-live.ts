import { WebSocketServer, type WebSocket } from 'ws';

/**
 * A Session Bridge that isn't one, so the renderer can be worked on with no
 * Ableton, no device, and no set.
 *
 * It speaks enough of the real protocol to be indistinguishable from the device
 * as far as `server/bridge.ts` is concerned: it answers `snapshot` from a set it
 * invents, accepts the watch requests, and then behaves like a band — firing a
 * scene every eight bars, moving meters, riding a fader.
 *
 * **It is not a Link peer, and that is a safety decision rather than a
 * simplification.** Link has no private session: it is every machine on the
 * local network at once. A harness that set the tempo to prove the clock works
 * would set the tempo of any Live on the LAN, including the one someone is
 * working in. The clock needs no fake anyway — Link's timeline advances with
 * zero peers, so the renderer can be driven by the server's own peer running at
 * its default tempo, and a real Live with Link enabled simply takes over as the
 * authority when it appears.
 *
 * ```sh
 * npm run dev:fake-live                     # :17801
 * BSV_BRIDGE_WS=ws://127.0.0.1:17801/ws npm run dev:visuals
 * ```
 *
 * Port 17801 and not 17800, deliberately: the real device may well be running,
 * and a harness that fought it for a port would be a confusing five minutes
 * every time.
 */

const PORT = Number(process.env.BSV_FAKE_PORT) || 17801;
const BPM = Number(process.env.BSV_FAKE_BPM) || 120;

const ROLES = ['INTRO', 'VERSE', 'CHORUS', 'VERSE', 'CHORUS', 'JAM1', 'JAM2', 'ENDING'];
const TRACKS = ['Drums', 'Bass', 'Keys', 'Lead', 'Pads'];
/** Slots in Live's palette, spread far enough apart to be told apart on screen. */
const COLORS = [0xff5a3c, 0x3cc8ff, 0xffd23c, 0x9b5aff, 0x3cff9b];

const scenes: BSV.Scene[] = ROLES.map((role, i) => ({
  i,
  name: `[${role}] @${BPM}-Am NIGHTFALL - THE AVIATORS`,
  color: COLORS[i % COLORS.length],
  colorIndex: 10 + i,
  isEmpty: false,
  tempo: -1,
}));

const tracks: BSV.Track[] = TRACKS.map((name, i) => ({
  i,
  name,
  color: COLORS[i % COLORS.length],
  colorIndex: 10 + i,
  isMidi: true,
  isGroup: false,
  isGrouped: false,
  groupIndex: -1,
  isFolded: false,
}));

const clips: BSV.Clip[] = [];
for (const track of tracks) {
  for (const scene of scenes) {
    // A few holes, because a real set has them and a layer with nothing playing
    // is a case the renderer has to handle.
    if ((track.i + scene.i) % 7 === 3) continue;
    clips.push({
      t: track.i,
      s: scene.i,
      name: `${track.name} ${ROLES[scene.i]}`,
      colorIndex: scene.colorIndex,
      color: scene.color,
      length: 16,
      isMidi: true,
    });
  }
}

const model: BSV.SetModel = {
  rev: 1,
  songs: [{ songKey: 'NIGHTFALL', name: 'NIGHTFALL', artist: 'THE AVIATORS', bpm: BPM, key: 'Am', scenes: scenes.map((s) => s.i) }] as unknown as BSV.SongEntry[],
  songByScene: Object.fromEntries(scenes.map((s) => [String(s.i), 'NIGHTFALL'])),
  unmapped: [],
};

const snapshot: BSV.Snapshot = {
  rev: 1,
  ms: 0,
  timings: { tracks: 0, scenes: 0, slots: 0, clips: 0, slotsScanned: 0, elapsed: 0 } as BSV.SnapshotTimings,
  tempo: BPM,
  masterColor: 0x2c2c31,
  trackCount: tracks.length,
  sceneCount: scenes.length,
  clipCount: clips.length,
  tracks,
  scenes,
  clips,
};

const parameter = (value: number, min = 0, max = 1): BSV.MixerParameterState => ({
  value,
  min,
  max,
  defaultValue: 0.85,
  display: `${value.toFixed(2)}`,
  enabled: true,
});

let scene = 0;
let playing = true;
const volumes = tracks.map(() => 0.85);

const server = new WebSocketServer({ port: PORT, path: '/ws' });
const clients = new Set<WebSocket>();

server.on('connection', (socket) => {
  clients.add(socket);
  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
  socket.send(JSON.stringify({ type: 'status', lomReady: true }));

  socket.on('message', (raw) => {
    let request: BSV.Request;
    try {
      request = JSON.parse(String(raw)) as BSV.Request;
    } catch {
      return;
    }
    if (request.type === 'snapshot') {
      socket.send(
        JSON.stringify({
          type: 'snapshot',
          id: request.id,
          dictMs: 0,
          hostMs: 0,
          data: snapshot,
          model,
          cached: true,
        }),
      );
      sendPlay();
      sendMixer();
    }
  });
});

const all = (payload: unknown) => {
  const wire = JSON.stringify(payload);
  for (const socket of clients) if (socket.readyState === socket.OPEN) socket.send(wire);
};

const sendPlay = () =>
  all({
    type: 'playState',
    isPlaying: playing,
    tracks: tracks.map((track) => ({
      // One hole in the grid means one silent layer, which is the case worth
      // exercising: it must draw nothing rather than draw the last thing.
      playing: playing && (track.i + scene) % 7 !== 3 ? scene : -1,
      fired: -1,
      armed: false,
    })),
  });

const sendMixer = () =>
  all({
    type: 'mixerState',
    state: {
      sendCount: 0,
      tracks: tracks.map((track) => ({
        t: track.i,
        active: true,
        solo: false,
        armed: false,
        canArm: true,
        volume: parameter(volumes[track.i]),
        pan: parameter(0, -1, 1),
        sends: [],
      })),
      masterVolume: parameter(0.9),
      masterPan: parameter(0, -1, 1),
    },
  });

// A scene every eight bars at the nominal tempo, which is what a set does.
const barMs = (60_000 / BPM) * 4;
setInterval(() => {
  scene = (scene + 1) % scenes.length;
  sendPlay();
  console.log(`fake-live: scene ${scene} [${ROLES[scene]}]`);
}, barMs * 8);

// Meters at 30 Hz, the rate the device actually pushes them.
let frame = 0;
setInterval(() => {
  frame += 1;
  const beat = (frame / 30) * (BPM / 60);
  all({
    type: 'meterLevels',
    frame: {
      master: playing ? 0.4 + 0.35 * Math.abs(Math.sin(beat * Math.PI)) : 0,
      tracks: tracks.map((track) => ({
        t: track.i,
        // Each track hits on its own subdivision, so the layers don't all
        // pulse together and a per-layer reaction is visibly per-layer.
        level: playing
          ? Math.max(0, Math.sin((beat * Math.PI) / (track.i % 2 ? 1 : 2) + track.i)) ** 3
          : 0,
      })),
    },
  });
}, 1000 / 30);

// One fader riding, so opacity is visibly a live value and not a constant.
setInterval(() => {
  volumes[2] = 0.5 + 0.45 * Math.sin(Date.now() / 4000);
  sendMixer();
}, 200);

console.log(`fake-live: ws://127.0.0.1:${PORT}/ws — ${tracks.length} tracks, ${scenes.length} scenes, ${BPM} bpm`);
console.log('fake-live: not a Link peer, deliberately. See the note at the top of this file.');
