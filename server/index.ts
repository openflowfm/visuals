import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { VISUALS_PORT, VISUALS_WS_PATH, type Up } from '../protocol.ts';
import { nextFlow, reOne } from '../resolve.ts';
import { followBridge } from './bridge.ts';
import { openLink } from './link.ts';
import { openLibrary } from './library.ts';
import { buildShow, noTurning } from './show.ts';
import { buildGrid } from './grid.ts';
import { listMedia, mediaRoot, serveMedia } from './media.ts';

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
 * Live ─ SessionBridge :17800 ─WS─> visuals server :17900 ─WS─> browser (WebGL2)
 *                    (same LAN)            |
 *                                     Ableton Link  <──── Live's Link session
 * ```
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.OPENFLOW_VISUALS_HOST ?? '0.0.0.0';
const PORT = Number(process.env.OPENFLOW_VISUALS_PORT) || VISUALS_PORT;
const BRIDGE = process.env.OPENFLOW_BRIDGE_WS ?? 'ws://127.0.0.1:17800/ws';
const ROOT = path.resolve(here, '../dist');
const MEDIA_ROOT = mediaRoot();

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

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname.startsWith('/media/')) {
    if (serveMedia(req, res, MEDIA_ROOT, url.pathname.slice('/media/'.length))) return;
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('video not found');
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
});

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

sockets.on('connection', (socket) => {
  clients.add(socket);
  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
  sendScheme(socket);
  sendLibrary(socket);
  sendMedia(socket);
  sendGrid(socket);
  socket.send(
    JSON.stringify({ kind: 'show', ...buildShow(bridge.state, link.sample(), scheme, turning) }),
  );

  socket.on('message', (raw) => {
    let message: Up;
    try {
      message = JSON.parse(String(raw)) as Up;
    } catch {
      return;
    }
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
    if (message.kind !== 'scheme' || !message.scheme) return;
    scheme.replace(message.scheme);
    dirty = true;
    // Back to everyone, including the editor that sent it: the server merges
    // against the built-in scheme, so what it now holds is not byte-identical
    // to what was sent, and an editor showing its own guess rather than the
    // resolved truth is an editor that drifts.
    for (const other of clients) if (other.readyState === other.OPEN) sendScheme(other);
    // The broadcast above already carried this revision; without this the
    // heartbeat would send every gesture a second time, one tick late.
    lastRevision = scheme.revision();
  });
});

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
}, ANCHOR_MS);

/** The subset that moves every tick, so a quiet show sends ~200 bytes. */
function anchorOf(show: ReturnType<typeof buildShow>) {
  return {
    kind: 'anchor' as const,
    tempo: show.tempo,
    beat: show.beat,
    at: show.at,
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
  process.exit(1);
};

server.on('error', cannotListen);
sockets.on('error', cannotListen);

server.listen(PORT, HOST, () => {
  console.log(`visuals: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`visuals: bridge ${BRIDGE}`);
  console.log(`visuals: media ${MEDIA_ROOT}`);
  console.log(`visuals: link ${link.live ? 'on' : 'MISSING — running on the wall clock'}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    link.stop();
    scheme.stop();
    bridge.close();
    server.close();
    process.exit(0);
  });
}
