# The desktop app

`visuals/electron/main.ts`, `visuals/electron/preload.ts`, `visuals/client/state/useWall.ts`.

`npm run visuals` builds the renderer, starts the server, and opens the rig in a window it
owns. It is the show-night command. `npm run dev` opens the same shell automatically, but
points it at vite so renderer edits arrive through HMR.

## The server is a child, not this process

Electron's main process is a Node process, so hosting `server/index.ts` inside it would work
and would save a socket hop. It stays a child anyway, for three reasons that outlast any one
of them: **the server remains a program you can run**, bare, with `npm run dev:visuals`, in
a test, or on a second machine with no app at all; a renderer crash cannot take the clock
with it, and a server crash gets restarted rather than ending the evening; and the thing the
app supervises is byte-for-byte the thing everything else runs.

**The reason it was originally split out turned out not to be one.** The worry was the
Ableton Link native addon: `tools/build-link.ts` compiles it after three source repairs, and
an addon built for Node's ABI has no business loading under Electron's. Except that it does
— the package wraps Link with **node-addon-api**, which is N-API, whose entire purpose is an
ABI that holds across Node *and* Electron versions. That was checked by loading it rather
than assumed, and it is why nothing is rebuilt per Electron upgrade and why the packaged app
can run the server under `ELECTRON_RUN_AS_NODE` with no system Node anywhere.

Worth knowing, because it means hosting the server in-process is available if a reason for
it ever appears. The three above are why it has not.

**Supervision is lifted from `tools/visuals.ts`** and keeps its contract: restart after a
second, but **not** on a clean exit and **not** on status **2**, which the server emits
specifically so a supervisor can tell "the port is taken" from "it fell over". Nothing
frees a port by trying again, so the app quits and lets the server's own message stand.

Three things it must do, and all three are the kind that bite at the worst time:

- **`before-quit` kills the child.** An orphan holding 17900 makes the *next* launch die of
  `EADDRINUSE`, which is the most likely bug in this file.
- **`requestSingleInstanceLock`.** A second instance spawns a second server that dies on the
  spot, leaving a window with nothing behind it. Focus the first one instead.
- **Wait for the port before opening a window**, with a settle before the first poll — a port
  already in use answers *immediately*, from whatever is on it, so without the settle the
  window opens onto somebody else's server a moment before ours dies.

## Windows, and the one that matters

In production the console window loads `http://localhost:17900`. There is no custom scheme
here, unlike set[flow], because the server is already serving `visuals/dist` at a stable
origin — `location.host` works, `/media/*` works, and the `localStorage` that holds the
keystone corners is on the same origin a browser would have used. In development it loads
vite on `:5473`; vite owns HMR and proxies socket and media requests to the app's child.

An app-owned server binds `127.0.0.1` by default. Its console and wall are on the same
machine, so advertising an unauthenticated write socket to the LAN buys nothing. An explicit
`OPENFLOW_VISUALS_HOST` still wins, and the standalone browser command keeps the server's
ordinary LAN default for the second-machine path.

**The wall is still `window.open`.** The renderer calls it with a features string carrying a
position, exactly as it does in a browser. Electron refuses that unless something says what
to do with it — and it parses the features for us — so `setWindowOpenHandler` is where a
popup becomes a frameless fullscreen window on a projector, and `useWall.send()` needed no
change at all. `BroadcastChannel`, `requestFullscreen`, `window.close()` and the `?wall`
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
the same thing. So the three switches `tools/visuals.ts` passes to Chrome are passed here
too, **and** every window sets `backgroundThrottling: false`, which is the precise version
of the same instruction.

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
`OPENFLOW_PORT_BASE` + 300, or `OPENFLOW_VISUALS_UI_PORT` outright — the same two the vite
config reads, so a worktree moves the app along with its servers. The readiness poll watches
whichever port the window is actually opening onto, and the settle before its first look is
skipped: it exists to avoid attaching to a server that is not ours, and in dev attaching to
exactly that is the point.

## Packaging

`npm run pack:visuals` builds the renderer, the shell, an icon, and a `.app` plus a `.dmg`
under `release/visuals/`. `npm run pack` does both apps.

`npm run install:apps` copies what that produced into `/Applications`, or `install:apps
visuals` for this one alone. It replaces rather than merges, refuses while the app is open,
and takes `OPENFLOW_APPS` for a machine where `/Applications` is not yours to write — see
[`set/docs/desktop.md`](../../set/docs/desktop.md) for why each of those is the case. The
`.node` addon and `server.mjs` ride along inside the bundle, so an installed copy needs
nothing from the repo it was built in.

**What packaging is for here, and it is not distribution.** Unpackaged, both apps report
themselves as *Electron*: the menu bar says it, the Dock shows Electron's icon for both, and
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

`asar: false`, deliberately. The archive is a packaging optimisation that buys nothing for
an app nobody downloads, and it costs a whole class of path problem — `app.asar.unpacked`,
and fs calls that only work through Electron's patched fs.

**Signing is off and switching it on needs no file edit:**

```sh
npm run pack:visuals -- -c.mac.identity="Developer ID Application: NAME (TEAM)"
```

Notarising as well wants `hardenedRuntime: true`, an entitlements plist with
`com.apple.security.cs.allow-jit`, and a `notarize:` block with an app-specific password or
an API key. It does not stop the app opening here — quarantine is set by whatever downloads
a file, and a bundle you built never had one; `npm run install:apps` strips it anyway and
verifies the strip. A copy that travelled is the case that bites, and not in the way you can
right-click past — see [`set/docs/desktop.md`](../../set/docs/desktop.md).

The payload is 4 MB: the renderer, three bundles, and the Link addon. Everything else the
server needs is already inside `server.mjs`, so `!node_modules/**` drops the dependency tree
electron-builder would otherwise copy in — the MCP server's express tree alone was 46 MB of
code this app never runs, and the addon's vendored copy of Ableton's Link library another 26
MB of C++ that was compiled into the binary at install time and is never read again.

## What has no tests

Nothing under `electron/` is reachable from vitest; a main process is not somewhere a test
runner can go. Zero coverage here is the honest picture rather than a gap to fill with a
fake test. What is testable is what the
renderer decides, and `survey()`'s branch is one `if` over an object that either exists or
does not.
