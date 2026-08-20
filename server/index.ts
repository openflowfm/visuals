import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { VISUALS_PORT, VISUALS_WS_PATH, type Up } from '../protocol.ts';
import { followBridge } from './bridge.ts';
import { openLink } from './link.ts';
import { openScheme } from './scheme.ts';
import { buildShow } from './show.ts';
import { buildGrid } from './grid.ts';

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
const HOST = process.env.BSV_VISUALS_HOST ?? '0.0.0.0';
const PORT = Number(process.env.BSV_VISUALS_PORT) || VISUALS_PORT;
const BRIDGE = process.env.BSV_BRIDGE_WS ?? 'ws://127.0.0.1:17800/ws';
const ROOT = path.resolve(here, '../dist');

/**
 * Binding to every interface rather than to loopback, unlike the device.
 *
 * The device binds `127.0.0.1` because its client is a browser on the same
 * machine. This one's client is a renderer on another machine by design, so
 * loopback would defeat the point. It is still a deliberate exposure: the
 * server has no authentication and answers anyone who can reach the port, so
 * it belongs on a show LAN and not on a hotel network. `BSV_VISUALS_HOST`
 * takes it back to `127.0.0.1` for anyone who wants that.
 */

const link = openLink(120, 4);
const scheme = openScheme();
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

const sendGrid = (socket: WebSocket) => {
  socket.send(JSON.stringify({ kind: 'grid', grid: buildGrid(bridge.state) }));
};

sockets.on('connection', (socket) => {
  clients.add(socket);
  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
  sendScheme(socket);
  sendGrid(socket);
  socket.send(JSON.stringify({ kind: 'show', ...buildShow(bridge.state, link.sample(), scheme) }));

  socket.on('message', (raw) => {
    let message: Up;
    try {
      message = JSON.parse(String(raw)) as Up;
    } catch {
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

// The scheme is a file someone edits with the picture on screen beside them, so
// a save has to reach the renderer without a reconnect. Nothing here diffs it —
// the heartbeat is a second away at worst, and the whole show is ~2 kB.
let lastScheme = '';

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
  const show = buildShow(bridge.state, link.sample(), scheme);
  show.clock = link.live;
  const schemeStamp = `${show.colorway}|${show.archetype}|${show.energy}|${show.schemeError}`;
  const reloaded = schemeStamp !== lastScheme;
  lastScheme = schemeStamp;
  const wire = JSON.stringify(
    due || reloaded ? { kind: 'show' as const, ...show } : anchorOf(show),
  );
  // A file edited on disk has to reach the editor too, not just the renderer.
  const schemeWire = reloaded ? JSON.stringify({ kind: 'scheme', scheme: scheme.current() }) : null;
  for (const socket of clients) {
    if (socket.readyState !== socket.OPEN) continue;
    if (schemeWire) socket.send(schemeWire);
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
    levels: show.layers.map((layer) => layer.level),
    opacity: show.layers.map((layer) => layer.opacity),
  };
}

server.listen(PORT, HOST, () => {
  console.log(`visuals: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`visuals: bridge ${BRIDGE}`);
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
