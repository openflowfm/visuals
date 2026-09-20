import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { APPS, serverPort } from '@openflow/desktop/apps.ts';
import { devUrl } from '@openflow/desktop/dev.ts';
import { state } from '@openflow/desktop/state.ts';
import { rendererDist, supervise, waitFor } from '@openflow/desktop/supervise.ts';
import { updates } from '@openflow/desktop/update.ts';
import { lifecycle, only, open, preload, switches } from '@openflow/desktop/window.ts';

/**
 * visual[flow]: the rig, the server it needs, and the wall.
 *
 * This replaces `npm run dev` as the way to run a show, and the reason is in
 * `tools/README.md`: `concurrently -k` over ten dev processes means any one of
 * them exiting kills the other nine, which is right for a dev loop and wrong for
 * a gig. What is here instead is the one process that matters, supervised, with
 * the windows it draws into.
 *
 * Three things are only true of this app, and they are what is left in this
 * file: it owns a server, it must not be throttled, and it opens second windows
 * onto projectors. The supervision itself, the window, the updater and the state
 * directory are `@openflow/desktop` — see `desktop/README.md` and
 * `docs/desktop.md`.
 */

const VISUALS = APPS.visuals;

/**
 * **In dev the server is `watch`'s, not this shell's.** `npm run watch` starts
 * the server first, learns the port it took, and hands it to vite — which
 * proxies `/ws` and `/media` to it — and to this shell in the environment. So
 * a dev shell owns no server and opens onto vite; two of them, in two
 * worktrees, are two servers on two free ports with nothing to race for.
 */
const DEV = devUrl(VISUALS);
/**
 * The port the packaged app's own server takes: the one named in the
 * environment, or 0 — any free one, reported back by the child. A packaged app
 * serves its own window over loopback and nothing else dials it, so a fixed
 * number would only be something for a second copy to collide on.
 */
const PORT = process.env.OPENFLOW_VISUALS_PORT ? String(serverPort(VISUALS)) : '0';

// Before anything can read it — the keystone corners and the last display live
// there.
state(VISUALS);

/**
 * Chrome slows and eventually freezes a renderer it decides nobody is looking
 * at, and **a wall window sitting behind the console is exactly that**. Electron
 * is the same Chromium and throttles identically, so this app says so twice:
 * here, process-wide, and per window with `throttle: false`.
 */
switches(app);

/**
 * One window per display the wall goes to, plus this one.
 *
 * The renderer opens the wall with `window.open` and a features string carrying
 * a position — the same call it makes in a browser. Electron parses those
 * features for us, so this is where a popup becomes a real frameless window on a
 * projector and the renderer needs no branch at all.
 */
const wall = (features: string): Electron.BrowserWindowConstructorOptions => {
  const of = (key: string): number | undefined => {
    const found = new RegExp(`(?:^|,)${key}=(-?\\d+)`).exec(features);
    return found ? Number(found[1]) : undefined;
  };
  return {
    x: of('left'),
    y: of('top'),
    width: of('width') ?? 1280,
    height: of('height') ?? 720,
    frame: false,
    fullscreen: true,
    backgroundColor: VISUALS.background,
    webPreferences: {
      preload: preload(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  };
};

/** Where the window opens: vite in dev, else the port the child reported. */
let home = DEV;

const window = (): void => {
  open({ app: VISUALS, home, dev: DEV, bounds: true, throttle: false, popup: wall });
};

if (only(app, DEV)) {
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

  void app.whenReady().then(async () => {
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

    if (DEV) {
      // vite is somebody else's — `watch`'s, along with the server it proxies
      // to — and opening onto what is already there is the entire point.
      const target = new URL(DEV);
      if (!(await waitFor(Number(target.port), target.hostname))) {
        console.error(`visuals: nothing answered on ${DEV} — is the dev server up? (npm run watch)`);
        app.quit();
        return;
      }
    } else {
      // The app's own child, on whatever port it reports. Opening onto the
      // reported port rather than an assumed one is what stops the window
      // attaching to whatever else already held a number.
      const server = supervise({
        app: VISUALS,
        env: {
          OPENFLOW_VISUALS_DIST: rendererDist(),
          OPENFLOW_VISUALS_PORT: PORT,
          // An app-owned backend serves this app, not the LAN. The standalone
          // browser command may still bind broadly, and an explicit override wins.
          OPENFLOW_VISUALS_HOST: process.env.OPENFLOW_VISUALS_HOST ?? '127.0.0.1',
        },
      });
      try {
        home = `http://127.0.0.1:${await server.port}`;
      } catch (why) {
        // Gone before it ever listened. Its own exit handler has already decided
        // whether that was a restart or a quit; it is not ours to open onto.
        console.error(`visuals: ${(why as Error).message} — nothing to show`);
        return;
      }
    }
    window();
    updates(VISUALS);
  });
}

lifecycle(app, window);
