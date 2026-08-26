import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { VISUALS_PORT } from '../protocol.ts';

/**
 * visual[flow]: the rig, the server it needs, and the wall.
 *
 * This replaces `npm run dev` as the way to run a show, and the reason is in
 * `tools/README.md`: `concurrently -k` over ten dev processes means any one of
 * them exiting kills the other nine, which is right for a dev loop and wrong for
 * a gig. What is here instead is the one process that matters, supervised, with
 * the windows it draws into.
 *
 * **The server is a child, not this process.** It owns the Ableton Link native
 * addon, which `visuals/tools/build-link.ts` compiles against plain Node's ABI
 * after three source repairs. Hosting it here would mean rebuilding that addon
 * for every Electron version — a standing liability on the one native dependency
 * in the project, in exchange for saving a socket hop that costs nothing.
 */

const PORT = Number(process.env.OPENFLOW_VISUALS_PORT) || VISUALS_PORT;
const RIG = `http://localhost:${PORT}`;

/**
 * The server, bundled, run by **Electron's own Node** rather than the one on
 * your PATH.
 *
 * A packaged `.app` has no source tree to run `server/index.ts` from — and,
 * launched from Finder, no `node` either: a GUI process inherits
 * `/usr/bin:/bin`, not whatever a shell profile added. `ELECTRON_RUN_AS_NODE`
 * turns this same binary into that Node, so the app carries its own.
 *
 * It works because the one native dependency is **node-addon-api** — N-API,
 * whose whole point is an ABI that holds across Node and Electron alike. That
 * was checked by loading it rather than assumed, and it is why nothing has to be
 * rebuilt per Electron upgrade. `link.ts` fails soft anyway: a rig that cannot
 * find the addon runs on the wall clock and says so.
 *
 * Both paths are laid out the same — `electron/dist/server.mjs` beside a
 * `dist/` two levels up — so the repo and the bundle need no branch.
 */
const server = path.join(__dirname, 'server.mjs');
const renderer = path.resolve(__dirname, '..', '..', 'dist');

/** How long to wait before bringing the server back, so a hard failure cannot spin. */
const RESTART_MS = 1000;
/** How long to wait for the port to answer before giving up on the window. */
const READY_MS = 20_000;
/** Long enough for a port already in use to have failed. */
const SETTLE_MS = 400;

// Its own state directory, before anything can read it. An unpackaged Electron
// app otherwise shares `~/Library/Application Support/Electron` with set[flow]
// and with every other unpackaged Electron app on the machine — and that is
// where the keystone corners and the last display live.
const home = process.env.OPENFLOW_HOME ?? path.join(os.homedir(), '.openflow');
app.setPath('userData', path.join(home, 'visuals', 'electron'));

/**
 * Chrome slows and eventually freezes a renderer it decides nobody is looking
 * at, and **a wall window sitting behind the console is exactly that**. Electron
 * is the same Chromium and throttles identically, so the three switches
 * `tools/visuals.ts` passes to Chrome are passed here too — with
 * `backgroundThrottling: false` on each window as the precise version of the
 * same thing. Without them, bringing the console to the front drops the
 * projector to a stutter.
 */
for (const flag of [
  'disable-background-timer-throttling',
  'disable-backgrounding-occluded-windows',
  'disable-renderer-backgrounding',
]) {
  app.commandLine.appendSwitch(flag);
}

let child: ChildProcess | null = null;
let stopping = false;

const start = (): void => {
  child = spawn(process.execPath, [server], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      // The server works its own location out from `import.meta.url`, which no
      // longer sits one hop from the renderer once it is bundled.
      OPENFLOW_VISUALS_DIST: renderer,
    },
  });
  child.on('exit', (code, signal) => {
    child = null;
    // A clean exit is the server's own shutdown path, and a port already taken
    // (2) never resolves by waiting — the server has already said which port and
    // how to find what is on it. Neither is worth relaunching into.
    const done =
      stopping || signal === 'SIGINT' || signal === 'SIGTERM' || code === 0 || code === 2;
    if (done) {
      if (!stopping) app.quit();
      return;
    }
    console.error(`visuals: the server exited (${signal ?? code}) — restarting in ${RESTART_MS}ms`);
    setTimeout(start, RESTART_MS);
  });
};

/** Whether anything is listening yet. The window must not open on a refusal. */
const answering = () =>
  new Promise<boolean>((resolve) => {
    const socket = net.connect({ port: PORT, host: '127.0.0.1' });
    const done = (yes: boolean) => {
      socket.destroy();
      resolve(yes);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(500, () => done(false));
  });

/**
 * One window per display the wall goes to, plus this one.
 *
 * The renderer opens the wall with `window.open` and a features string carrying
 * a position — the same call it makes in a browser. Electron refuses that unless
 * something says what to do with it, and it parses the features for us, so the
 * handler is where a popup becomes a real frameless window on a projector and
 * the renderer needs no branch at all.
 */
const shell = (win: BrowserWindow): void => {
  win.webContents.setWindowOpenHandler(({ features }) => {
    const of = (key: string): number | undefined => {
      const found = new RegExp(`(?:^|,)${key}=(-?\\d+)`).exec(features);
      return found ? Number(found[1]) : undefined;
    };
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        x: of('left'),
        y: of('top'),
        width: of('width') ?? 1280,
        height: of('height') ?? 720,
        frame: false,
        fullscreen: true,
        backgroundColor: '#000000',
        webPreferences: {
          preload: path.join(__dirname, 'preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          backgroundThrottling: false,
        },
      },
    };
  });
};

const open = (): void => {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'visual[flow]',
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  shell(win);
  win.webContents.on('did-fail-load', (_event, code, why, url) => {
    console.error(`visuals: could not load ${url} — ${why} (${code})`);
  });
  void win.loadURL(RIG);
};

const openWhenReady = async (): Promise<void> => {
  // A beat before the first look. If something else is already on the port, the
  // very first poll succeeds — against *that* — and a window opens onto somebody
  // else's server a moment before ours dies of EADDRINUSE.
  await new Promise((wake) => setTimeout(wake, SETTLE_MS));
  const waited = Date.now() + READY_MS;
  while (child && Date.now() < waited) {
    if (await answering()) break;
    await new Promise((wake) => setTimeout(wake, 150));
  }
  if (!child) return; // Gone before it ever listened. Not ours to open onto.
  if (!(await answering())) {
    console.error(`visuals: the server never answered on ${PORT} — nothing to show`);
    app.quit();
    return;
  }
  open();
};

/**
 * A second instance would spawn a second server that dies of EADDRINUSE on the
 * spot, leaving a window with nothing behind it. Focus the one that works.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  ipcMain.handle('openflow:displays', () => {
    const console_ = BrowserWindow.getAllWindows()[0];
    const mine = console_ ? screen.getDisplayMatching(console_.getBounds()).id : -1;
    // Numbered before this one is dropped, or the third of three is called
    // "display 2" whenever the console is on the middle one — the same rule the
    // browser path keeps.
    return screen.getAllDisplays().flatMap((display, i) =>
      display.id === mine
        ? []
        : [
            {
              name: display.label || `display ${i + 1}`,
              left: display.workArea.x,
              top: display.workArea.y,
              width: display.workArea.width,
              height: display.workArea.height,
            },
          ],
    );
  });

  void app.whenReady().then(() => {
    // Each listener written out, because `screen.on` is overloaded per event and
    // a loop over the three collapses to whichever overload TypeScript picks.
    const moved = () => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('openflow:displays-changed');
      }
    };
    screen.on('display-added', moved);
    screen.on('display-removed', moved);
    screen.on('display-metrics-changed', moved);
    start();
    void openWhenReady();
  });
}

app.on('window-all-closed', () => app.quit());

/**
 * The server must not outlive the app.
 *
 * An orphan holding 17900 makes the *next* launch die with exit 2, which is the
 * most likely bug in this file and the one that bites at the worst time.
 */
app.on('before-quit', () => {
  stopping = true;
  child?.kill('SIGTERM');
});
