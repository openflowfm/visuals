# The desktop app

`visuals/electron/main.ts`, `visuals/electron/preload.ts`, `visuals/src/state/useWall.ts`.

`npm run visuals` builds the renderer, starts the server, and opens the rig in a window it
owns. It is the show-night command, and it replaced a `concurrently -k` over ten dev
processes where any one exiting killed the other nine.

## The server is a child, not this process

Electron's main process is a Node process, so hosting `server/index.ts` inside it would
work and would save a socket hop. It is not worth it. The server owns the **Ableton Link
native addon**, which `tools/build-link.ts` compiles against plain Node's ABI after three
separate source repairs — a C++14 flag that has to become C++17, a macOS define the package
applies on every OS, and an unquoted include path that breaks under a directory with a space
in it. Running it under Electron means redoing that against Electron's ABI, and again on
every Electron upgrade, on the one native dependency in the project.

So the app spawns it, and everything in `server/` stays exactly as runnable and as testable
as it was.

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

The console window loads `http://localhost:17900`. There is no custom scheme here, unlike
set[flow], because the server is already serving `visuals/dist` at a stable origin —
`location.host` works, `/media/*` works, and the `localStorage` that holds the keystone
corners is on the same origin a browser would have used.

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

## What has no tests

Nothing under `electron/` is reachable from vitest; a main process is not somewhere a test
runner can go. The gnosis graph shows these files with no observed edges, which is the
honest picture rather than a gap to fill with a fake test. What is testable is what the
renderer decides, and `survey()`'s branch is one `if` over an object that either exists or
does not.
