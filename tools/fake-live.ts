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
 * OPENFLOW_BRIDGE_WS=ws://127.0.0.1:17801/ws npm run dev:visuals
 * ```
 *
 * Port 17801 and not 17800, deliberately: the real device may well be running,
 * and a harness that fought it for a port would be a confusing five minutes
 * every time.
 */

const PORT = Number(process.env.OPENFLOW_FAKE_PORT) || 17801;
const BPM = Number(process.env.OPENFLOW_FAKE_BPM) || 120;

const ROLES = ['INTRO', 'VERSE', 'CHORUS', 'VERSE', 'CHORUS', 'JAM1', 'JAM2', 'ENDING'];
const TRACKS = ['Drums', 'Bass', 'Keys', 'Lead', 'Pads'];
/** Slots in Live's palette, spread far enough apart to be told apart on screen. */
const COLORS = [0xff5a3c, 0x3cc8ff, 0xffd23c, 0x9b5aff, 0x3cff9b];

const scenes: OpenFlow.Scene[] = ROLES.map((role, i) => ({
  i,
  name: `[${role}] @${BPM}-Am NIGHTFALL - THE AVIATORS`,
  color: COLORS[i % COLORS.length],
  colorIndex: 10 + i,
  isEmpty: false,
  tempo: -1,
}));

const tracks: OpenFlow.Track[] = TRACKS.map((name, i) => ({
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

const clips: OpenFlow.Clip[] = [];
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

// Written out in full rather than cast into shape. The obvious version is
// `buildSetModel(derive(scenes, SCENE_PATTERNS))`, and it cannot be: `core/`
// spells its internal imports the TypeScript way (`./derive.js`), which Node's
// type stripping resolves literally and does not find. So a harness run
// straight by Node states the model itself — and states **all** of it, because
// the fields a cast used to paper over are exactly the ones a client would then
// be written against wrongly. `bpm` really is a rendered string, and a song
// really does carry a tag whether or not this one has anything to say in it.
const song: OpenFlow.SongEntry = {
  songKey: 'nightfall',
  name: 'NIGHTFALL',
  scenes: scenes.map((s) => s.i),
  blocks: [{ from: 0, to: scenes.length - 1 }],
  bpm: String(BPM),
  key: 'Am',
  artist: 'THE AVIATORS',
  tag: 'ORIGINAL',
  bpmClash: false,
  keyClash: false,
  artistClash: false,
  tagClash: false,
  colorIndex: 10,
  colorClash: false,
  firstSceneTempo: null,
  tempoScenes: [],
};

const model: OpenFlow.SetModel = {
  rev: 1,
  songs: [song],
  songByScene: Object.fromEntries(scenes.map((s) => [String(s.i), song.songKey])),
  factsByScene: Object.fromEntries(
    scenes.map((s, i) => [String(s.i), { role: ROLES[i], key: 'Am', bpm: String(BPM) }]),
  ),
  unmapped: [],
};

const snapshot: OpenFlow.Snapshot = {
  rev: 1,
  ms: 0,
  timings: { tracks: 0, scenes: 0, slots: 0, clips: 0, slotsScanned: 0, elapsed: 0 } as OpenFlow.SnapshotTimings,
  tempo: BPM,
  masterColor: 0x2c2c31,
  trackCount: tracks.length,
  sceneCount: scenes.length,
  clipCount: clips.length,
  tracks,
  scenes,
  clips,
};

const parameter = (value: number, min = 0, max = 1): OpenFlow.MixerParameterState => ({
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
    let request: OpenFlow.Request;
    try {
      request = JSON.parse(String(raw)) as OpenFlow.Request;
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
    if (request.type === 'clipNotes') {
      socket.send(
        JSON.stringify({
          type: 'clipNotes',
          id: request.id,
          clips: request.clips.map((clip) => notesFor(clip.t, clip.s)),
        }),
      );
    }
  });
});

/**
 * Notes for one clip, invented so the roll can be worked on with no Ableton.
 *
 * The point of the fixture is the *shape* of a real set rather than a tune. The
 * one the chart draws is **Bass**, and it is written to exercise what a roll has
 * to survive: notes off the downbeat, one that is not a whole beat long, and an
 * octave jump — the gesture a pitch-class roll used to flatten and the reason
 * this one draws real pitches.
 *
 * The other tracks are here because a fixture that is only a bass line tests
 * nothing about picking a track out of a set: a drum track that must not be
 * mistaken for it, keys and pads carrying the harmony, and a lead that spells
 * nothing.
 */
const PROGRESSION = [
  [57, 60, 64],
  [53, 57, 60],
  [48, 52, 55],
  [55, 59, 62],
];

function notesFor(t: number, s: number): OpenFlow.ClipNotes {
  const name = TRACKS[t % TRACKS.length] ?? '';
  const notes: OpenFlow.ClipNote[] = [];

  if (name === 'Drums') {
    for (let beat = 0; beat < 16; beat++) {
      notes.push({ pitch: 36, start: beat, duration: 0.25 });
      if (beat % 2 === 1) notes.push({ pitch: 38, start: beat, duration: 0.25 });
    }
    return { t, s, instrument: 'DrumGroupDevice', notes };
  }

  if (name === 'Bass') {
    PROGRESSION.forEach((triad, bar) => {
      // An octave below the keys rather than two: the roll's keyboard is where
      // the low B of a real set's clips sounds, and a fixture written a further
      // octave down would arrive folded and test the wrong thing.
      const root = triad[0]! - 12;
      notes.push({ pitch: root, start: bar * 4, duration: 1.5 });
      notes.push({ pitch: root, start: bar * 4 + 2, duration: 0.5 });
      notes.push({ pitch: root + 12, start: bar * 4 + 3, duration: 0.5 });
    });
    return { t, s, instrument: 'Operator', notes };
  }

  if (name === 'Keys' || name === 'Pads') {
    PROGRESSION.forEach((triad, bar) => {
      // Keys arpeggiate and pads hold, which is the pair the half-bar window
      // exists to cope with.
      if (name === 'Pads') {
        for (const pitch of triad) notes.push({ pitch, start: bar * 4, duration: 4 });
      } else {
        for (let i = 0; i < 8; i++) {
          notes.push({ pitch: triad[i % 3]! + 12, start: bar * 4 + i * 0.5, duration: 0.5 });
        }
      }
    });
    return { t, s, instrument: 'Operator', notes };
  }

  // A melody, in key, over the top. Deliberately **not** a chromatic run: a
  // line that touches all twelve pitch classes is not a lead, and a fixture
  // like that tests only whether the analysis can be broken rather than whether
  // it works. What this does exercise is the real case — a monophonic part
  // whose passing tones are not the chord, which must not rename it.
  const LINE = [76, 79, 77, 76, 74, 72, 74, 76];
  for (let i = 0; i < 16; i++) {
    notes.push({ pitch: LINE[i % LINE.length]!, start: i, duration: 0.5 });
  }
  return { t, s, instrument: 'Operator', notes };
}

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

/**
 * Where every playing clip's playhead is, at the 20 Hz the device pushes it.
 *
 * Without this the loop wheels and the roll cannot be worked on with no Ableton
 * at all — both are driven by `clipStatus`, and a harness that answers
 * `snapshot` and `playState` but not this one leaves them permanently empty and
 * looking broken rather than unimplemented.
 *
 * Loop lengths differ per track on purpose. A one-bar loop beside an eight-bar
 * one is what the wheels are read for, and the bass is four so the roll draws a
 * full four-bar line rather than the front half of one — a clip whose loop
 * bracket is shorter than its notes is a real case, and it should be a case
 * somebody chooses to test rather than the only thing the harness can show.
 */
const LOOP_BARS = [4, 4, 8, 1, 2];
const started = Date.now();
setInterval(() => {
  if (!playing) return;
  const beats = ((Date.now() - started) / 60_000) * BPM;
  all({
    type: 'clipStatus',
    frame: {
      tracks: tracks
        .filter((track) => (track.i + scene) % 7 !== 3)
        .map((track) => {
          const bars = LOOP_BARS[track.i % LOOP_BARS.length] ?? 4;
          const span = bars * 4;
          return {
            t: track.i,
            position: beats % span,
            loopStart: 0,
            loopEnd: span,
            looping: true,
            recording: false,
            inSeconds: false,
            signatureNumerator: 4,
            signatureDenominator: 4,
          };
        }),
    },
  });
}, 50);

// One fader riding, so opacity is visibly a live value and not a constant.
setInterval(() => {
  volumes[2] = 0.5 + 0.45 * Math.sin(Date.now() / 4000);
  sendMixer();
}, 200);

console.log(`fake-live: ws://127.0.0.1:${PORT}/ws — ${tracks.length} tracks, ${scenes.length} scenes, ${BPM} bpm`);
console.log('fake-live: not a Link peer, deliberately. See the note at the top of this file.');
