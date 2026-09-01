# The desktop app

`visuals/electron/main.ts`, `visuals/electron/preload.ts`, `visuals/client/state/useWall.ts`,
and — for the window, the state directory, the updater and the supervision itself —
[`@openflow/desktop`](../../desktop/README.md).

Three things are only true of this app, and they are what is left in its `main.ts`: it owns
a server, it must not be throttled, and it opens second windows onto projectors. Everything
else is shared with set[flow] and with every app after it.

`npm run visuals` builds the renderer, starts the server, and opens the rig in a window it
owns. It is the show-night command. `npm run dev` opens the same shell automatically, but
points it at vite so renderer edits arrive through HMR.

## The server is a child, not this process

The whole argument, the restart policy, the readiness wait and the three things that bite at
the worst time are [`desktop/docs/server.md`](../../desktop/docs/server.md) — this is the app
the code was lifted from, and it is still the only one with a backend of its own.

Two things it says that are worth repeating here. **The reason the server was originally
split out turned out not to be one**: the worry was the Ableton Link native addon, and an
addon built for Node's ABI has no business loading under Electron's — except that the
package wraps Link with node-addon-api, which is N-API, whose entire purpose is an ABI that
holds across both. So hosting it in-process is available if a reason ever appears; the three
reasons in that doc are why it has not. And **`OPENFLOW_VISUALS_DIST` is how the bundled
server finds the renderer**, because it otherwise works its own location out from
`import.meta.url`, which no longer sits one hop from `visuals/dist` once it is bundled.

`OPENFLOW_VISUALS_HOST` defaults to `127.0.0.1` here: an app-owned backend serves this app,
not the LAN, and its console and wall are on the same machine, so advertising an
unauthenticated write socket buys nothing. An explicit override still wins, and the
standalone browser command keeps the server's ordinary LAN default for the second-machine
path.

## Windows, and the one that matters

In production the console window loads `http://localhost:17900`. There is no custom scheme
here, unlike set[flow], because the server is already serving `visuals/dist` at a stable
origin — `location.host` works, `/media/*` works, and the `localStorage` that holds the
keystone corners is on the same origin a browser would have used. In development it loads
vite on `:5473`; vite owns HMR and proxies socket and media requests to the app's child.

**The wall is still `window.open`.** The renderer calls it with a features string carrying a
position, exactly as it does in a browser. Electron refuses that unless something says what
to do with it — and it parses the features for us — so `open()`'s `popup` hook is where a
popup becomes a frameless fullscreen window on a projector, and `useWall.send()` needed no
change at all. Anything the hook declines still opens in a browser, which is the shared
default. `BroadcastChannel`, `requestFullscreen`, `window.close()` and the `?wall`
search param all work as they are.

## Displays, without a permission

`getScreenDetails` does not exist in an Electron renderer, and neither does the permission
prompt in front of it. The main process asks `screen.getAllDisplays()` and hands the answer
over the context bridge in the shape `useWall.ts` already declares — dropping the console's
own display, and numbering *before* it drops it, which is the same rule the browser path
keeps so the third of three is not called "display 2".

`screen.on('display-added' | 'display-removed' | 'display-metrics-changed')` replaces the
`screenschange` listener, and needs no first answer to have something to listen on.

**This retires a real papercut**: the wiki used to have to tell you to answer the display
permission once, in the show browser, before you were standing in front of a projector.
There is no question to answer now.

`survey()` branches on the presence of the bridge and falls through to the browser path
otherwise. **The browser path is not deprecated** — it is what a second machine runs, which
is the arrangement `README.md` says this rig was always meant for, and it is still reachable
as `npm run visuals:browser`.

## Throttling, which is the easiest thing to get wrong

Chrome slows and eventually freezes a renderer it decides nobody is looking at, and a wall
window sitting behind the console is exactly that. Electron is the same Chromium and does
the same thing. So this app says it twice — `switches(app)` for the three process-wide
command line switches, and `throttle: false` on every window — and it is the only app here
that says either. Both halves are needed;
[`desktop/docs/window.md`](../../desktop/docs/window.md) has the mechanism.

Forget them and the symptom is a projector that stutters whenever somebody brings another
window to the front — which is a thing that happens constantly, and reads as a bug in the
renderer.

## The dev loop, in this window

`npm run dev` starts vite and opens this shell on `:5473`, so an edit to a shader, node or
component lands in the real Electron window with React Fast Refresh intact. `npm run
dev:visuals-app` remains the narrower command when vite is already running. `npm run
visuals` is a rebuild and relaunch, which is right for checking what ships and wrong for the
twenty edits before it.

**The app starts and supervises the backend in dev too.** The old stack started
`server/index.ts` as one `concurrently` process, then required the Electron shell to attach
to that process. Now the shell owns the backend in both modes and vite merely proxies `/ws`
and `/media` to it. Closing the app kills its child; a backend crash is supervised by the
same code used on a show night; and a second standalone process cannot race it for the port.

That makes this the better place to develop the wall, not just an equal one: `window.open`
becomes a real frameless window on a real projector through `setWindowOpenHandler`, and the
display list arrives over IPC from `screen.getAllDisplays()` instead of from Chrome's window
management API behind a permission prompt. Both of those paths only exist here.

**17900 is still a backend port, not a second dev UI.** The sandboxed renderer and every
wall window share Link, bridge, scheme, lab and wheel state over its WebSocket, and media
files are streamed over its HTTP side. Removing the listener altogether would mean replacing
both with Electron IPC plus a custom media protocol, and would also make the browser/remote
wall path a separate transport. The app-owned listener is therefore kept local rather than
pretending the backend disappeared; the page being developed is only vite's `:5473` page.

`OPENFLOW_DEV=1` is the switch and `OPENFLOW_DEV_URL` overrides the address. The port is
`OPENFLOW_PORT_BASE` plus this app's offset in `desktop/src/apps.ts`, or
`OPENFLOW_VISUALS_UI_PORT` outright — and the vite config now reads the same registry rather
than restating the offset, so the two have no way of disagreeing quietly. The readiness poll watches
whichever port the window is actually opening onto, and the settle before its first look is
skipped: it exists to avoid attaching to a server that is not ours, and in dev attaching to
exactly that is the point.

## Packaging

`npm run pack:visuals` builds the renderer, the shell, an icon, and a `.app` plus a `.dmg`
under `release/visuals/`. `npm run pack` does every app.

`npm run install:apps` copies what that produced into `/Applications`, or `install:apps
visuals` for this one alone. It replaces rather than merges, refuses while the app is open,
and takes `OPENFLOW_APPS` for a machine where `/Applications` is not yours to write — see
[`set/docs/desktop.md`](../../set/docs/desktop.md) for why each of those is the case. The
`.node` addon and `server.mjs` ride along inside the bundle, so an installed copy needs
nothing from the repo it was built in.

**What packaging is for here, and it is not distribution.** Unpackaged, every app reports
itself as *Electron*: the menu bar says it, the Dock shows Electron's icon, and
⌘-Tab cannot tell them apart — a small thing until you are reaching for one of them mid-set.
A bundle gives each a real identifier, a real name and an icon, and only an `Info.plist` can.

The icons are generated rather than committed: `tools/build-icons.ts` rasterises
`visuals/public/mark.svg` with `sips` and packs it with `iconutil`. Each app has a mark of
its own and they are the same disc — one thing split down the middle, a dot on each side of
the divide — differing in hue and in what the dots do: this one throws rays out of its node,
set[flow] runs rows of clips into it. The shapes are for the 512 and the **colour** is for
the 32, because at Dock size hue is the only thing anyone actually reads. See
[`set/docs/desktop.md`](../../set/docs/desktop.md) for the grid the marks are padded onto
and why editing one wants care.

Everything else about the bundle — `asar: false`, signing, notarisation, and what this app's
own `electron-builder.yml` still has to say for itself — is
[`desktop/docs/packaging.md`](../../desktop/docs/packaging.md). This app's config adds three
things to the shared base: `server.mjs`, the addon and the two packages that resolve it, and
the `NSLocalNetworkUsageDescription` string macOS puts in front of Link's UDP multicast.
Without that string the prompt still appears, worded by the system and explaining nothing —
and a refusal is silent afterwards: the clock simply never finds Live.

The payload is 4 MB: the renderer, three bundles, and the Link addon. Everything else the
server needs is already inside `server.mjs`, so `!node_modules/**` drops the dependency tree
electron-builder would otherwise copy in — the MCP server's express tree alone was 46 MB of
code this app never runs, and the addon's vendored copy of Ableton's Link library another 26
MB of C++ that was compiled into the binary at install time and is never read again.

## What has no tests

Nothing under `electron/` is reachable from vitest, and that is as true of
`@openflow/desktop` as it is of this file; a main process is not somewhere a test runner can
go. Zero coverage here is the honest picture rather than a gap to fill with a
fake test. What is testable is what the
renderer decides, and `survey()`'s branch is one `if` over an object that either exists or
does not.
