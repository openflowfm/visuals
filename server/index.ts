import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  VISUALS_PORT,
  VISUALS_WS_PATH,
  type CalibrationState,
  type LabState,
  type Up,
} from '../protocol.ts';
import { nextColorway, nextFlow, reOne } from '../resolve.ts';
import { newSeed } from '../randomize.ts';
import { bundleOf } from '../lab.ts';
import { CALIBRATION_TRIALS } from '../calibration.ts';
import { followBridge } from './bridge.ts';
import { lineageMethod } from './lineage.ts';
import { calibrationFile, labPlace } from './home.ts';
import { labSearchEngine, openLab, type LabEngine } from './lab.ts';
import { openCalibration, type CalibrationStore } from './calibration.ts';
import { openLink } from './link.ts';
import { openLibrary } from './library.ts';
import { buildShow, noTurning } from './show.ts';
import { buildGrid } from './grid.ts';
import { listMedia, mediaRoot, serveMedia } from './media.ts';
import { readUp } from './up.ts';

/**
 * The visuals server: a Link peer, a bridge client, and an HTTP host for the
 * renderer.
 *
 * It is a separate process from the device on purpose, and the reason is not
 * tidiness. Link is a native addon compiled against a particular Node ABI, and
 * the bridge's Node lives *inside* Max — upgrading Live would break it. Beyond
 * that, this is meant to run on a different machine entirely, so that a GPU
 * drawing sixty frames a second is never on the same box as Live's audio
 * thread. Both of those force it out of the device, and once it is out, being
 * an ordinary client of the bridge is free.
 *
 * ```
 * Live ─ SessionBridge :17800 ─WS─> visuals backend :17900 ─WS─> renderer (WebGL2)
 *                    (same LAN)            |
 *                                     Ableton Link  <──── Live's Link session
 * ```
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.OPENFLOW_VISUALS_HOST ?? '0.0.0.0';
const PORT = Number(process.env.OPENFLOW_VISUALS_PORT) || VISUALS_PORT;
const BRIDGE = process.env.OPENFLOW_BRIDGE_WS ?? 'ws://127.0.0.1:17800/ws';
// Beside the source in the repo, and wherever the packaged app put it
// otherwise — a bundled server does not sit one directory up from the renderer.
const ROOT = process.env.OPENFLOW_VISUALS_DIST ?? path.resolve(here, '../dist');
const MEDIA_ROOT = mediaRoot();
/** Internal tooling is absent unless the server was deliberately started with it. */
const CALIBRATION_ENABLED = process.env.OPENFLOW_CALIBRATION === '1';

/**
 * Binding to every interface rather than to loopback, unlike the device.
 *
 * The device binds `127.0.0.1` because its client is a browser on the same
 * machine. This one's client is a renderer on another machine by design, so
 * loopback would defeat the point. It is still a deliberate exposure: the
 * server has no authentication and answers anyone who can reach the port, so
 * it belongs on a show LAN and not on a hotel network. `OPENFLOW_VISUALS_HOST`
 * takes it back to `127.0.0.1` for anyone who wants that.
 */

const link = openLink(120, 4);
const scheme = openLibrary();
let dirty = true;
const bridge = followBridge(BRIDGE, () => {
  dirty = true;
});

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

/**
 * Every request in one try, because this port is on a LAN.
 *
 * `new URL(…, \`http://${host}\`)` throws on a Host header that is not a host —
 * `Host: [` and `Host: a b` both do it — and a throw in this callback is the
 * process, which is the wall going black because something scanned the network.
 * Binding `0.0.0.0` is deliberate (see below), so hostile-shaped traffic is
 * background noise here rather than an event, and the answer to all of it is
 * 400.
 */
const server = http.createServer((req, res) => {
  try {
    serve(req, res);
  } catch (err) {
    console.warn(`visuals: request refused — ${(err as Error).message}`);
    if (res.headersSent) res.destroy();
    else {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('bad request');
    }
  }
});

function serve(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname === '/calibration/export') {
    serveCalibrationExport(res);
    return;
  }
  if (url.pathname.startsWith('/media/')) {
    if (serveMedia(req, res, MEDIA_ROOT, url.pathname.slice('/media/'.length))) return;
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('media not found');
    return;
  }
  let rel = url.pathname === '/' ? '/index.html' : url.pathname;

  // Every unknown path is the app, because the renderer is a single page.
  const file = path.join(ROOT, rel);
  const inside = file.startsWith(ROOT + path.sep) || file === path.join(ROOT, 'index.html');
  if (!inside || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    rel = '/index.html';
  }

  const target = path.join(ROOT, rel);
  if (!fs.existsSync(target)) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('The renderer is not built. Run: npm run build:visuals\nOr use the dev server.');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(target)] ?? 'application/octet-stream' });
  res.end(fs.readFileSync(target));
}

const sockets = new WebSocketServer({ server, path: VISUALS_WS_PATH });
const clients = new Set<WebSocket>();

const sendScheme = (socket: WebSocket) => {
  socket.send(JSON.stringify({ kind: 'scheme', scheme: scheme.current() }));
};

const sendLibrary = (socket: WebSocket) => {
  socket.send(JSON.stringify({ kind: 'library', ...scheme.library() }));
};

const sendMedia = (socket: WebSocket) => {
  socket.send(JSON.stringify({ kind: 'media', assets: listMedia(MEDIA_ROOT) }));
};

/**
 * A cheap stand-in for "the set changed shape".
 *
 * Stringifying the grid to compare it would mean building tens of kilobytes ten
 * times a second to discover that nothing moved. These four numbers move
 * whenever a track, a scene or a clip does, which is every way the grid can
 * change, and reading them is free.
 */
const gridStamp = () =>
  `${bridge.state.rev}|${bridge.state.tracks.length}|${bridge.state.scenes.length}|${bridge.state.clips.size}`;

let lastGrid = '';

/**
 * What the rotation remembers between ticks.
 *
 * One per server rather than per client, because the wheel is a property of the
 * show rather than of who is watching it — two browsers open on the same rig
 * have to be looking at the same picture.
 */
const turning = noTurning();

const sendGrid = (socket: WebSocket) => {
  socket.send(JSON.stringify({ kind: 'grid', grid: buildGrid(bridge.state) }));
};

/**
 * The lab, opened the first time a review view asks and never before.
 *
 * Lazy because of a rule the lab doc spells: no evaluation work happens merely
 * because a server is running. A rig that never opens the review view never
 * opens the database, never deals a candidate, and never learns the lab exists.
 */
let lab: LabEngine | null = null;
/**
 * Why there is no lab, once opening one has failed.
 *
 * Remembered rather than retried, because the cause is a file: a corrupt or
 * locked `lab.sqlite3`, or a migration that will not run. Retrying it on every
 * click would relitigate the same failure all night.
 */
let labClosed: string | null = null;

const ensureLab = (): LabEngine | null => {
  if (lab) return lab;
  if (labClosed) return null;
  try {
    const store = openLab(labPlace().file);
    const method = lineageMethod();
    // Resuming the newest experiment rather than opening one per boot: the seed
    // is the deck, and a restart should keep dealing from where it stood.
    const seed = store.experimentSeed(method.id, method.version) ?? newSeed();
    lab = labSearchEngine(store, method, seed);
  } catch (err) {
    labClosed = `the lab is unavailable — ${(err as Error).message}`;
    console.warn(`visuals: ${labClosed}`);
    return null;
  }
  return lab;
};

/** The queue's state as "there is no queue", so the review view says why. */
const noLab = (why: string): LabState => ({
  encounter: null,
  explore: null,
  develop: null,
  archive: null,
  finals: null,
  candidate: null,
  room: null,
  method: '',
  liked: 0,
  rejected: 0,
  reviewed: 0,
  skipped: 0,
  pending: 0,
  comparisons: 0,
  explores: 0,
  refines: 0,
  frontier: 0,
  maxGeneration: 0,
  notice: why,
});

/**
 * One lab gesture, or the reason it did not happen.
 *
 * The database is opened the first time a review view asks and never before, so
 * **pressing the review tab is what touches the disk** — and a store that will
 * not open used to take the process with it, from a rig that was drawing fine a
 * moment earlier. A show with no lab is a show; a show with no server is a black
 * wall. Every path in here answers the asker either way, so the view says what
 * happened rather than waiting on a reply that is not coming.
 */
const onLab = (socket: WebSocket, run: (engine: LabEngine) => void) => {
  const engine = ensureLab();
  if (!engine) {
    socket.send(JSON.stringify({ kind: 'lab', ...noLab(labClosed ?? 'the lab is unavailable') }));
    return;
  }
  try {
    run(engine);
  } catch (err) {
    const why = `the lab refused that — ${(err as Error).message}`;
    console.warn(`visuals: ${why}`);
    socket.send(JSON.stringify({ kind: 'lab', ...noLab(why) }));
  }
};

const sendLab = (state: LabState) => {
  const wire = JSON.stringify({ kind: 'lab', ...state });
  for (const socket of clients) if (socket.readyState === socket.OPEN) socket.send(wire);
};

/** Development evidence has its own database and can never disable the user lab. */
let calibration: CalibrationStore | null = null;
let calibrationClosed: string | null = null;

const noCalibration = (why: string): CalibrationState => ({
  trial: null,
  decision: null,
  trials: [],
  decided: 0,
  total: 0,
  history: [],
  notice: why,
});

const ensureCalibration = (): CalibrationStore | null => {
  if (!CALIBRATION_ENABLED || calibrationClosed) return null;
  if (calibration) return calibration;
  try {
    calibration = openCalibration(calibrationFile(), CALIBRATION_TRIALS);
  } catch (error) {
    calibrationClosed = `calibration is unavailable — ${(error as Error).message}`;
    console.warn(`visuals: ${calibrationClosed}`);
  }
  return calibration;
};

const sendCalibration = (socket: WebSocket, state: CalibrationState) => {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify({ kind: 'calibration', ...state }));
  }
};

const onCalibration = (socket: WebSocket, run: (store: CalibrationStore) => void) => {
  const store = ensureCalibration();
  if (!store) {
    socket.send(
      JSON.stringify({
        kind: 'calibration',
        ...noCalibration(
          CALIBRATION_ENABLED
            ? (calibrationClosed ?? 'calibration is unavailable')
            : 'calibration was not enabled for this server',
        ),
      }),
    );
    return;
  }
  try {
    run(store);
  } catch (error) {
    const why = `calibration refused that — ${(error as Error).message}`;
    console.warn(`visuals: ${why}`);
    socket.send(JSON.stringify({ kind: 'calibration', ...noCalibration(why) }));
  }
};

function serveCalibrationExport(res: http.ServerResponse): void {
  if (!CALIBRATION_ENABLED) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  const store = ensureCalibration();
  if (!store) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`${calibrationClosed ?? 'calibration is unavailable'}\n`);
    return;
  }
  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'content-disposition': 'attachment; filename="calibration-results.jsonl"',
  });
  res.end(store.exportJsonl());
}

sockets.on('connection', (socket) => {
  clients.add(socket);
  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
  // The opening burst, guarded like the tick: everything in it is sent again on
  // the heartbeat, so a client that arrived while something was wrong catches up
  // within a tick rather than costing the server.
  try {
    sendScheme(socket);
    sendLibrary(socket);
    sendMedia(socket);
    sendGrid(socket);
    socket.send(
      JSON.stringify({ kind: 'calibration-available', available: CALIBRATION_ENABLED }),
    );
    socket.send(
      JSON.stringify({ kind: 'show', ...buildShow(bridge.state, link.sample(), scheme, turning) }),
    );
  } catch (err) {
    console.warn(`visuals: could not answer a new client — ${(err as Error).message}`);
  }

  socket.on('message', (raw) => {
    const read = readUp(String(raw));
    if (!read.ok) {
      console.warn(`visuals: dropped a message — ${read.why}`);
      return;
    }
    // The second belt. Every handler below is guarded on its own, and this is
    // what says that one that is not, or one guarded wrongly, still cannot be
    // the end of the show.
    try {
      dispatch(socket, read.up);
    } catch (err) {
      console.warn(`visuals: ${read.up.kind} failed — ${(err as Error).message}`);
    }
  });
});

function dispatch(socket: WebSocket, message: Up): void {
  // "Here is the one." Nothing to carry — *when* it arrives is the message,
  // and it lands on the server because the wheel belongs to the show rather
  // than to whoever pressed the key. `dirty` so the re-phased show goes out
  // on the next tick rather than at the heartbeat, since the point of the
  // gesture is that it happened just now.
  if (message.kind === 'downbeat') {
    turning.wheel = reOne(scheme.current().rotation, link.sample(), turning.wheel);
    dirty = true;
    return;
  }
  // A flow-only turn, owned by the server for the same reason the one is:
  // the console and the wall are two views of one show, not two wheels that
  // happen to start together. The colourway deliberately stays where it is.
  if (message.kind === 'next-flow') {
    turning.wheel = nextFlow(turning.wheel);
    dirty = true;
    return;
  }
  // The mirror gesture: the colourway moves, the flow holds.
  if (message.kind === 'next-colorway') {
    turning.wheel = nextColorway(turning.wheel);
    dirty = true;
    return;
  }
  // The lab's queue gestures. Answered inline rather than on the heartbeat,
  // because advancing the question is the answer the reviewer is waiting on,
  // and broadcast because every attached console sees the same queue.
  if (message.kind === 'lab-open') {
    onLab(socket, (engine) => sendLab(engine.open()));
    return;
  }
  if (message.kind === 'lab-compare') {
    onLab(socket, (engine) => sendLab(engine.compare(message.comparison)));
    return;
  }
  if (message.kind === 'lab-skip-encounter') {
    onLab(socket, (engine) => sendLab(engine.skipEncounter(message.encounterId)));
    return;
  }
  if (message.kind === 'lab-archive-open') {
    onLab(socket, (engine) => sendLab(engine.archiveOpen()));
    return;
  }
  if (message.kind === 'lab-archive-select') {
    onLab(socket, (engine) => sendLab(engine.archiveSelect(message.candidateId)));
    return;
  }
  if (message.kind === 'lab-archive-decide') {
    onLab(socket, (engine) => sendLab(engine.archiveDecide(message.decision)));
    return;
  }
  if (message.kind === 'lab-lineage-finalist') {
    onLab(socket, (engine) => sendLab(engine.lineageFinalist(message.decision)));
    return;
  }
  if (message.kind === 'lab-explore-open') {
    onLab(socket, (engine) => sendLab(engine.exploreOpen()));
    return;
  }
  if (message.kind === 'lab-explore-judge') {
    onLab(socket, (engine) => sendLab(engine.exploreJudge(message.submission)));
    return;
  }
  if (message.kind === 'lab-explore-skip') {
    onLab(socket, (engine) => sendLab(engine.exploreSkip(message.encounterId)));
    return;
  }
  if (message.kind === 'lab-bookmark') {
    onLab(socket, (engine) => sendLab(engine.bookmark(message.decision)));
    return;
  }
  if (message.kind === 'lab-develop-open') {
    onLab(socket, (engine) => sendLab(engine.developOpen(message.candidateId)));
    return;
  }
  if (message.kind === 'lab-develop-deal') {
    onLab(socket, (engine) => sendLab(engine.developDeal(message.request)));
    return;
  }
  if (message.kind === 'lab-develop-compare') {
    onLab(socket, (engine) => sendLab(engine.developCompare(message.comparison)));
    return;
  }
  if (message.kind === 'lab-develop-skip') {
    onLab(socket, (engine) => sendLab(engine.developSkip(message.encounterId)));
    return;
  }
  if (message.kind === 'lab-develop-close') {
    onLab(socket, (engine) => sendLab(engine.developClose()));
    return;
  }
  if (message.kind === 'lab-finals-open') {
    onLab(socket, (engine) => sendLab(engine.finalsOpen()));
    return;
  }
  if (message.kind === 'lab-finals-new') {
    onLab(socket, (engine) => sendLab(engine.finalsNew()));
    return;
  }
  if (message.kind === 'lab-finals-compare') {
    onLab(socket, (engine) => sendLab(engine.finalsCompare(message.comparison)));
    return;
  }
  if (message.kind === 'lab-finals-skip') {
    onLab(socket, (engine) => sendLab(engine.finalsSkip(message.encounterId)));
    return;
  }
  if (message.kind === 'lab-select') {
    onLab(socket, (engine) => sendLab(engine.select(message.selection)));
    return;
  }
  if (message.kind === 'lab-review') {
    onLab(socket, (engine) => sendLab(engine.submit(message.review)));
    return;
  }
  if (message.kind === 'lab-skip') {
    onLab(socket, (engine) => sendLab(engine.skip(message.candidateId)));
    return;
  }
  // A hand-built flow, frozen from the scheme as it is *now* — the graph and
  // its whole bundle by value, so editing the library afterwards cannot
  // change what gets judged. The scheme itself is never touched.
  //
  // `hasOwn` rather than a truthiness check: `flowId: 'constructor'` finds a
  // function on the prototype, which passes `if (flow)` and throws downstream.
  if (message.kind === 'lab-offer') {
    const flows = scheme.current().flows;
    if (!Object.hasOwn(flows, message.flowId)) return;
    const flow = flows[message.flowId];
    onLab(socket, (engine) => sendLab(engine.offer(flow, bundleOf(flows, flow))));
    return;
  }
  // The review tab. The log and a candidate's graph answer only the asker;
  // a changed row goes to everyone, because an edited description is show
  // state the way the queue is. The judgment itself has no message here.
  if (message.kind === 'lab-log') {
    onLab(socket, (engine) => {
      socket.send(JSON.stringify({ kind: 'lab-log', ...engine.log(message.before) }));
    });
    return;
  }
  if (
    message.kind === 'lab-retag' ||
    message.kind === 'lab-renote' ||
    message.kind === 'lab-rescore'
  ) {
    onLab(socket, (engine) => {
      const answer =
        message.kind === 'lab-retag'
          ? engine.retag(message.reviewId, message.tags)
          : message.kind === 'lab-renote'
            ? engine.renote(message.reviewId, message.note)
            : engine.rescore(message.reviewId, message.score);
      if (!answer.ok) return;
      const wire = JSON.stringify({ kind: 'lab-review-changed', review: answer.review });
      for (const other of clients) if (other.readyState === other.OPEN) other.send(wire);
    });
    return;
  }
  if (message.kind === 'lab-candidate') {
    onLab(socket, (engine) => {
      const held = engine.candidate(message.candidateId);
      if (held) {
        socket.send(
          JSON.stringify({ kind: 'lab-candidate', id: held.id, flow: held.flow, bundle: held.bundle }),
        );
      }
    });
    return;
  }
  if (message.kind === 'calibration-open') {
    onCalibration(socket, (store) =>
      sendCalibration(
        socket,
        store.state(
          message.trialId !== undefined && message.trialVersion !== undefined
            ? { trialId: message.trialId, trialVersion: message.trialVersion }
            : undefined,
        ),
      ),
    );
    return;
  }
  if (message.kind === 'calibration-decide') {
    onCalibration(socket, (store) => sendCalibration(socket, store.decide(message.decision)));
    return;
  }
  // Persistence is its own gesture now. An edit changes what every screen
  // draws; only these three touch the library on disk. None of them answer
  // inline — the heartbeat notices the revision and the library move within
  // a tick, which is faster than a finger leaves a button.
  if (message.kind === 'save-scheme') {
    scheme.save();
    return;
  }
  if (message.kind === 'save-scheme-as') {
    scheme.saveAs(message.id);
    return;
  }
  if (message.kind === 'load-scheme') {
    scheme.load(message.id);
    dirty = true;
    return;
  }
  if (message.kind !== 'scheme') return;
  // A shape `merge` refuses leaves the working scheme where it was and puts the
  // message in the panel, exactly as a file with a trailing comma does — so the
  // broadcast below carries what the server actually holds either way.
  scheme.replace(message.scheme);
  dirty = true;
  // Back to everyone, including the editor that sent it: the server repairs
  // and carries schemes at this one door, so what it now holds need not be
  // byte-identical to what was sent, and an editor showing its own guess rather
  // than the resolved truth is an editor that drifts.
  for (const other of clients) if (other.readyState === other.OPEN) sendScheme(other);
  // The broadcast above already carried this revision; without this the
  // heartbeat would send every gesture a second time, one tick late.
  lastRevision = scheme.revision();
}

/**
 * Two rates, and the split is the whole reason the renderer looks smooth.
 *
 * The **anchor** goes out ten times a second whether anything changed or not,
 * carrying the tempo and one beat position stamped with the time it was read.
 * The browser extrapolates between anchors, so its beat advances every frame at
 * whatever rate the display runs. Pushing the *position* at 10 Hz instead would
 * step visibly; pushing it at 60 Hz would put the network in the render loop.
 *
 * The **show** goes out only when something *structural* moved — a clip fired,
 * a track was renamed, the set changed shape. The two things that move
 * continuously and only ever land in a shader uniform, **meter levels and layer
 * opacity**, ride the anchor instead. Letting either wake a diff would make a
 * riding fader push the whole set thirty times a second, which is the traffic
 * this split exists to avoid.
 */
const ANCHOR_MS = 100;
const SHOW_MS = 1000;

// A scheme can change without any client sending one — a file edited with the
// picture on screen beside it, a flow saved by the MCP server, a load. The
// revision is the store saying "what I hold moved"; the heartbeat carries it to
// every screen without a reconnect. The library line moves for less — a dirty
// flag, a save-as — so it is stamped separately and costs a readdir per tick.
let lastRevision = -1;
let lastShown = '';
let lastLibrary = '';
let lastMedia = '';

let sinceShow = 0;
setInterval(() => {
  // The fix is that `merge` refuses a scheme it cannot build a show from, so a
  // poisoned value never reaches here. This is the floor under that: a throw
  // inside a `setInterval` body is the process, and losing the show to one bad
  // tick — when the next one would very likely be fine — is the wrong trade at
  // any point in a set.
  try {
    tick();
  } catch (err) {
    console.warn(`visuals: the show tick failed — ${(err as Error).message}`);
  }
}, ANCHOR_MS);

function tick(): void {
  sinceShow += ANCHOR_MS;
  const due = dirty || sinceShow >= SHOW_MS;
  if (due) {
    dirty = false;
    sinceShow = 0;
  }
  if (clients.size === 0) return;
  // Before the show, because a browser that drew a matrix against a stale grid
  // would show gaps for tracks that had just been recorded into.
  const stamp = gridStamp();
  if (stamp !== lastGrid) {
    lastGrid = stamp;
    const gridWire = JSON.stringify({ kind: 'grid', grid: buildGrid(bridge.state) });
    for (const socket of clients) {
      if (socket.readyState === socket.OPEN) socket.send(gridWire);
    }
  }
  const show = buildShow(bridge.state, link.sample(), scheme, turning);
  show.clock = link.live;
  // The flow and the colourway are in it because the rotation moves them, and a
  // wheel that turned without the renderer being told would be a wheel that
  // never turned: the anchor carries meters, not decisions.
  const showStamp = `${show.flow}|${show.colorway}|${show.song}|${show.schemeError}`;
  const moved = showStamp !== lastShown;
  lastShown = showStamp;
  const reloaded = scheme.revision() !== lastRevision;
  lastRevision = scheme.revision();
  const wire = JSON.stringify(
    due || moved || reloaded ? { kind: 'show' as const, ...show } : anchorOf(show),
  );
  // A scheme that moved without a client sending it — a file edited on disk, a
  // load — has to reach the editor too, not just the renderer.
  const schemeWire = reloaded ? JSON.stringify({ kind: 'scheme', scheme: scheme.current() }) : null;
  const libraryWire = JSON.stringify({ kind: 'library', ...scheme.library() });
  const shelf = libraryWire !== lastLibrary ? libraryWire : null;
  lastLibrary = libraryWire;
  // Disk discovery is structural, so it belongs at the one-second show rate,
  // not on the 100ms clock anchor. A dropped file appears without a restart.
  const mediaWire = due
    ? JSON.stringify({ kind: 'media' as const, assets: listMedia(MEDIA_ROOT) })
    : lastMedia;
  const mediaMoved = due && mediaWire !== lastMedia ? mediaWire : null;
  if (due) lastMedia = mediaWire;
  for (const socket of clients) {
    if (socket.readyState !== socket.OPEN) continue;
    if (schemeWire) socket.send(schemeWire);
    if (shelf) socket.send(shelf);
    if (mediaMoved) socket.send(mediaMoved);
    socket.send(wire);
  }
}

/** The subset that moves every tick, so a quiet show sends ~200 bytes. */
function anchorOf(show: ReturnType<typeof buildShow>) {
  return {
    kind: 'anchor' as const,
    tempo: show.tempo,
    beat: show.beat,
    at: show.at,
    since: show.since,
    playing: show.playing,
    master: show.master,
    levels: show.tracks.map((track) => track.level),
    opacity: show.tracks.map((track) => track.opacity),
  };
}

/**
 * A port already taken says so, rather than throwing a stack trace.
 *
 * `npm run dev` runs eight things under `concurrently -k`, so **one of them
 * dying takes the session down with it** — which is right, and which makes the
 * message that death produces the only thing anyone reads. An unhandled
 * `EADDRINUSE` is fourteen lines of Node internals ending in `listenInCluster`,
 * printed in the middle of seven other processes' startup output, and it does
 * not mention this file, this port, or the visuals server at all.
 *
 * The usual cause is the one thing worth naming: a `dev:visuals` left running
 * from an earlier session, holding 17900 while the rest of the rig comes up.
 */
let dying = false;
const cannotListen = (err: NodeJS.ErrnoException) => {
  // Both the HTTP server and the socket server emit this one: `ws` attaches to
  // the HTTP server and re-emits, so a handler on only one of them still leaves
  // the other throwing. Whichever arrives first says it, and the second is
  // ignored rather than printing the same thing twice on the way out.
  if (dying) return;
  dying = true;
  if (err.code === 'EADDRINUSE') {
    console.error(
      `visuals: port ${PORT} is already in use — something else is on it.\n` +
        `visuals: usually a dev:visuals or npm run dev left running from an earlier session.\n` +
        `visuals: find it with  lsof -nP -iTCP:${PORT} -sTCP:LISTEN\n` +
        `visuals: or run this one elsewhere with  OPENFLOW_VISUALS_PORT=17901 npm run dev:visuals`,
    );
  } else {
    console.error(`visuals: could not listen on ${HOST}:${PORT} — ${err.message}`);
  }
  link.stop();
  scheme.stop();
  bridge.close();
  // 2 rather than 1, so `npm run visuals` can tell a failure that waiting fixes
  // from one that it never will. Nothing frees a port by trying again.
  process.exit(2);
};

server.on('error', cannotListen);
sockets.on('error', cannotListen);

/**
 * Whether what is being served is older than what it was built from.
 *
 * The bundle in `dist/` is not in git, so it is exactly as fresh as the last
 * `build:visuals` on this machine — and a stale one is the *client/server skew*
 * the renderer's unknown-kind guard exists to survive, running for real. It is
 * also invisible: the page loads, the wall draws, and one field is missing.
 *
 * Timestamps rather than hashes because this has to be free at startup, and the
 * only wrong answer it can give is a warning nobody needed after a git checkout
 * touched a file.
 */
function staleBundle(): string | null {
  let built: number;
  try {
    built = fs.statSync(path.join(ROOT, 'index.html')).mtimeMs;
  } catch {
    return null; // Not built at all, which the 503 above already says plainly.
  }
  const newest = (at: string): number => {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(at);
    } catch {
      return 0;
    }
    if (!stat.isDirectory()) return stat.mtimeMs;
    let seen = stat.mtimeMs;
    for (const entry of fs.readdirSync(at)) seen = Math.max(seen, newest(path.join(at, entry)));
    return seen;
  };
  const sources = ['src', 'protocol.ts', 'resolve.ts'].map((rel) =>
    newest(path.resolve(here, '..', rel)),
  );
  const moved = Math.max(...sources);
  return moved > built ? `${Math.round((moved - built) / 60000)} minutes` : null;
}

server.listen(PORT, HOST, () => {
  console.log(`visuals: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`visuals: bridge ${BRIDGE}`);
  console.log(`visuals: media ${MEDIA_ROOT}`);
  console.log(`visuals: link ${link.live ? 'on' : 'MISSING — running on the wall clock'}`);
  if (CALIBRATION_ENABLED) console.log(`visuals: calibration ${calibrationFile()}`);
  const stale = staleBundle();
  if (stale) {
    console.warn(
      `visuals: ⚠ the renderer in dist/ is ${stale} older than its source.\n` +
        `visuals: ⚠ what the browser gets is that build, not this code — run: npm run build:visuals`,
    );
  }
});

/**
 * The last resort, and not the fix.
 *
 * Every throw this file used to take exited the process, and this process is the
 * only thing between a Live set and a wall — so the failure mode was always the
 * same one, whatever caused it: black, mid-song, with nothing on screen to say
 * why. Every guard above is the fix. This is what makes a missed one a line in a
 * log instead, and a device that reaches it has a bug to find.
 */
process.on('uncaughtException', (err) => {
  console.error(`visuals: uncaught — ${(err as Error).message} · still running`);
});
process.on('unhandledRejection', (reason) => {
  console.error(`visuals: unhandled rejection — ${String(reason)} · still running`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    link.stop();
    scheme.stop();
    bridge.close();
    lab?.close();
    calibration?.close();
    server.close();
    process.exit(0);
  });
}
