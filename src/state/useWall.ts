import { useCallback, useEffect, useRef, useState } from 'react';
import type { Output } from './useOutput.ts';

/**
 * The wall: the picture on the projector, in a window nobody has to manage.
 *
 * **Nothing renders to an HDMI port.** The port is a display, and the only way
 * pixels reach it is a window on that desktop — so the question was never
 * whether there is a second window, it is whether anyone has to *touch* one.
 * Dragging a browser onto a projector and fullscreening it is a thing you do in
 * the dark with a band waiting, every single time.
 *
 * Chrome's window management API answers exactly that: with the permission
 * granted a page can enumerate the displays and open a window on the one it
 * names. So this window keeps the panel, the console and the picture it already
 * had, and the wall is a chrome-less window that opens on the projector and is
 * never looked at again.
 *
 * **It is an ordinary second client**, which costs nothing — rule 5 in
 * `AGENTS.md` — so it opens its own socket and extrapolates its own clock, and
 * would draw the same show if it were a second machine. Which is the point:
 * this is the one-machine case of a rig that was always meant to be two.
 *
 * **What the two ends have to agree about does not go through the server.** The
 * keystone, the brightness and whether the test grid is up all describe *this
 * projector in this room*, which is the one class of thing the show is
 * deliberately not told — see [the renderer](../../docs/render.md). They ride a
 * `BroadcastChannel` instead, which is one origin talking to itself.
 */

/** A display we could put the wall on. */
export interface Display {
  /** Stable enough to remember, which is why it is the identity and not the index. */
  name: string;
  /** Where to open, in the coordinates `window.open` places into. */
  left: number;
  top: number;
  width: number;
  height: number;
}

/** What the two ends say to each other. */
type Word =
  | { kind: 'ask' }
  | { kind: 'wall' }
  | { kind: 'gone' }
  | { kind: 'shut' }
  | { kind: 'output'; output: Output; aligning: boolean };

/**
 * Chrome's window management API, which `lib.dom` does not describe yet.
 *
 * Only the members used here, and only as far as they are relied on: this is a
 * shape assertion about somebody else's browser, so the less of it there is the
 * less of it can be wrong.
 */
interface ScreenDetailed {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
  label: string;
}
interface ScreenDetails extends EventTarget {
  screens: ScreenDetailed[];
  currentScreen: ScreenDetailed;
}
type WithScreens = Window & { getScreenDetails?: () => Promise<ScreenDetails> };

const CHANNEL = 'bsv.visuals.wall';

/** The display the wall went to last. Per machine, like everything else here. */
const KEY = 'bsv.visuals.wall';

let channel: BroadcastChannel | null = null;

/** The last answer the browser gave, kept so the change event has something to hang on. */
let seen: ScreenDetails | null = null;

function wire(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  channel ??= new BroadcastChannel(CHANNEL);
  return channel;
}

/** Say something to the other end. Free when there isn't one. */
export function say(word: Word): void {
  wire()?.postMessage(word);
}

/** Listen to the other end. A channel never delivers to its own sender. */
export function hear(on: (word: Word) => void): () => void {
  const open = wire();
  if (!open) return () => {};
  const listener = (e: MessageEvent) => on(e.data as Word);
  open.addEventListener('message', listener);
  return () => open.removeEventListener('message', listener);
}

/**
 * Every display but this one.
 *
 * **Never this one.** A wall over the console is a wall you cannot reach the
 * console to move, and on a single-screen machine the right answer is an empty
 * list and a plain popup you place yourself.
 *
 * `gesture` says whether a permission prompt is allowed to appear. Asking
 * without one gets nothing until the permission has been granted once, which is
 * why the first `w` of a browser's life may take two presses and none of the
 * rest do.
 */
async function survey(gesture: boolean): Promise<Display[]> {
  const api = (window as WithScreens).getScreenDetails;
  if (!api) return [];
  if (!gesture) {
    let state: PermissionState | null = null;
    try {
      state = (await navigator.permissions.query({ name: 'window-management' as PermissionName }))
        .state;
    } catch {
      // An older Chrome that has the API under a different permission name, or
      // no permissions API at all. A gesture will still get there.
      return [];
    }
    if (state !== 'granted') return [];
  }
  let found: ScreenDetails;
  try {
    found = await api.call(window);
  } catch {
    // Refused, or dismissed. The plain popup is still there.
    return [];
  }
  seen = found;
  // Numbered before this one is dropped, or the third of three is called
  // "display 2" whenever the console is on the middle one.
  return found.screens.flatMap((screen, i) =>
    screen === found.currentScreen
      ? []
      : [
          {
            name: screen.label || `display ${i + 1}`,
            left: screen.availLeft,
            top: screen.availTop,
            width: screen.availWidth,
            height: screen.availHeight,
          },
        ],
  );
}

/** The display to send to: the one you used last, or the first that is not this one. */
function chooseDisplay(displays: Display[], last: string | null): Display | null {
  return displays.find((display) => display.name === last) ?? displays[0] ?? null;
}

/**
 * This window's end of it: which displays there are, and the wall on one of them.
 *
 * `open` survives a reload of *this* window, because the wall is asked rather
 * than counted — a console that refreshed mid-set and forgot there was a
 * projector would offer to open a second one.
 */
export function useWall(active: boolean): {
  /** Where the wall could go. Empty when the browser will not say. */
  displays: Display[];
  /** Whether one is open, and the display it went to. */
  open: boolean;
  where: string | null;
  /** Why the last attempt did not work. */
  trouble: string | null;
  send(display?: Display): void;
  shut(): void;
} {
  const [displays, setDisplays] = useState<Display[]>([]);
  const [open, setOpen] = useState(false);
  const [where, setWhere] = useState<string | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const held = useRef<Window | null>(null);
  const known = useRef<Display[]>([]);
  known.current = displays;

  useEffect(() => {
    if (!active) return;
    let gone = false;
    let watched: ScreenDetails | null = null;
    const flow = () => {
      void survey(false).then((found) => {
        if (gone) return;
        setDisplays(found);
        // A projector plugged in after the page loaded is the ordinary case
        // rather than the exotic one: the rig is left running and the wall
        // arrives later. Only the browser knows, and only once it has told us
        // anything at all is there an object to hear it on.
        if (seen && seen !== watched) {
          watched?.removeEventListener('screenschange', flow);
          watched = seen;
          watched.addEventListener('screenschange', flow);
        }
      });
    };
    flow();
    return () => {
      gone = true;
      watched?.removeEventListener('screenschange', flow);
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    // A wall that is already up answers this; one that is closing says so. Both
    // are how this window learns something it did not do itself.
    say({ kind: 'ask' });
    return hear((word) => {
      if (word.kind === 'wall') {
        setOpen(true);
        setWhere((was) => was ?? localStorage.getItem(KEY));
      }
      if (word.kind === 'gone') setOpen(false);
    });
  }, [active]);

  const send = useCallback((display?: Display) => {
    void (async () => {
      setTrouble(null);
      let list = known.current;
      if (!list.length) {
        // The press is the gesture, so this is the call that may prompt.
        list = await survey(true);
        setDisplays(list);
      }
      const to = display ?? chooseDisplay(list, localStorage.getItem(KEY));
      const url = new URL(location.pathname, location.origin);
      url.searchParams.set('wall', '');
      // `popup` is what drops the tab strip and the address bar; the wall asks
      // for fullscreen itself once it is there, which is what takes the last
      // strip of desktop and the title bar with it.
      const place = to
        ? `popup=1,left=${to.left},top=${to.top},width=${to.width},height=${to.height}`
        : 'popup=1,width=1280,height=720';
      const child = window.open(url.toString(), 'bsvWall', place);
      if (!child) {
        setTrouble('the browser blocked the window — allow pop-ups for this page');
        return;
      }
      held.current = child;
      setOpen(true);
      setWhere(to?.name ?? null);
      if (to) localStorage.setItem(KEY, to.name);
    })();
  }, []);

  const shut = useCallback(() => {
    // Both, because the reference is lost whenever this window reloaded after
    // opening it, and the wall closes itself on the word either way.
    held.current?.close();
    held.current = null;
    say({ kind: 'shut' });
    setOpen(false);
  }, []);

  return { displays, open, where, trouble, send, shut };
}

/**
 * The wall's own end: announce yourself, fill the screen, and do as you are told.
 *
 * Filling the screen is asked for rather than assumed. A popup opened from a
 * keypress inherits that activation and usually goes fullscreen on its own; when
 * it does not, the next click on it does — which is one click on a window you
 * were already about to click on, and is the whole of the fallback.
 */
export function useOnWall(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    say({ kind: 'wall' });
    // A pointer on a projector is somebody's mouse, three metres wide.
    document.documentElement.dataset.wall = '';
    const leaving = () => say({ kind: 'gone' });
    window.addEventListener('pagehide', leaving);
    const stop = hear((word) => {
      if (word.kind === 'ask') say({ kind: 'wall' });
      if (word.kind === 'shut') window.close();
    });

    const fill = () => {
      if (document.fullscreenElement) return;
      void document.documentElement.requestFullscreen?.().catch(() => {});
    };
    fill();
    window.addEventListener('pointerdown', fill);

    return () => {
      window.removeEventListener('pagehide', leaving);
      window.removeEventListener('pointerdown', fill);
      delete document.documentElement.dataset.wall;
      stop();
      leaving();
    };
  }, [active]);
}

/** Whether this window *is* the wall. Decided by the URL, once, for its lifetime. */
export const ON_WALL =
  typeof location !== 'undefined' && new URLSearchParams(location.search).has('wall');
