import { useEffect, useRef, useState } from 'react';
import type {
  Down,
  FlowDef,
  LabReviewRow,
  LabScore,
  LabState,
  LabSubmission,
  Library,
  MediaAsset,
  Scheme,
  SetGrid,
  Show,
} from '../../protocol.ts';

/**
 * The connection to the visuals server, and the clock the renderer runs on.
 *
 * **The beat is computed here, not received here.** The server sends an anchor
 * ten times a second — a tempo and one beat position stamped with when it was
 * read — and this free-runs a local clock between them, correcting toward each
 * new anchor by a fraction of the error. Receiving a beat *position* at 10 Hz
 * and drawing it would step visibly; receiving one at 60 Hz would put the
 * network in the render loop and make the picture stutter whenever a packet was
 * late. Extrapolating is what makes the clock smooth at any refresh rate while
 * still being Link's clock rather than a local one.
 *
 * The correction is a fraction rather than a jump for the same reason a
 * parameter readback is: the true value wins, but it does not get to yank.
 */
export interface Clock {
  /** Continuous Link beats, advanced every frame. */
  beat(): number;
  /** Seconds since the page loaded, for anything that should *not* be in time. */
  seconds(): number;
  /** Called once per frame, before reading. */
  advance(dtSeconds: number): void;
}

const RESTING: Show = {
  connected: false,
  lomReady: false,
  playing: false,
  peers: 0,
  clock: false,
  tempo: 120,
  quantum: 4,
  beat: 0,
  at: 0,
  master: 0,
  tracks: [],
  groups: [],
  flow: null,
  pinned: false,
  colorway: null,
  colors: [0xffffff],
  song: null,
  key: null,
  role: null,
  one: 0,
  schemeError: null,
  roles: [],
  songs: [],
};

export function useShow(): {
  /** React state: re-renders the overlay when the set changes. Not per frame. */
  show: Show;
  /** The same value, read by the render loop every frame without re-rendering. */
  showRef: { readonly current: Show };
  /** What the editor edits. Null until the server has sent one. */
  scheme: Scheme | null;
  /**
   * The set's shape — every song against every track. Null until it arrives.
   *
   * Apart from the show because it is large and still: it changes when someone
   * records a clip, not when one fires.
   */
  grid: SetGrid | null;
  /** The library: every saved scheme, the open one, and whether it is dirty. */
  library: Library | null;
  /** Server-approved video files below the configured media root. */
  media: MediaAsset[];
  /**
   * Publish an edit. Every screen follows it immediately; nothing reaches
   * disk — that is `saveScheme`'s job, and the distance between the two is
   * what the library's dirty flag shows.
   */
  edit(next: Scheme): void;
  /** Write the open scheme to its file. */
  saveScheme(): void;
  /** Write the open scheme under a new id and be on that id from now on. */
  saveSchemeAs(id: string): void;
  /** Open a saved scheme, dropping unsaved edits. Ask before calling. */
  loadScheme(id: string): void;
  /** "The one is here." Nothing to carry: when it arrives is the message. */
  downbeat(): void;
  /** Turn only the flow wheel once, for every screen attached to the server. */
  nextFlow(): void;
  /** The review queue, or null until the review view has asked for it. */
  lab: LabState | null;
  /** Ask for the queue's state. The one thing that makes the server deal. */
  labOpen(): void;
  /** One judgment, whole. The server answers with the advanced queue. */
  labReview(review: LabSubmission): void;
  /** "I did not judge this." Never a score. */
  labSkip(candidateId: string): void;
  /** Offer a flow from the open scheme to the queue, frozen as it is now. */
  labOffer(flowId: string): void;
  /** Past judgments, newest first, or null until the review tab has asked. */
  labLog: { reviews: LabReviewRow[]; more: boolean } | null;
  /** Ask for a page of the log; `before` pages past the oldest row held. */
  labLogOpen(before?: number): void;
  /** Replace one review's score. Every console sees the changed row. */
  labRescore(reviewId: number, score: LabScore): void;
  /** Replace one review's tag set. Every console sees the changed row. */
  labRetag(reviewId: number, tags: string[]): void;
  /** Replace one review's note, blank meaning none. */
  labRenote(reviewId: number, note: string): void;
  /** The last candidate graph fetched for re-staging, or null. */
  labStage: { id: string; flow: FlowDef; bundle: Record<string, FlowDef> } | null;
  /** Ask for a frozen candidate's graph. */
  labCandidate(candidateId: string): void;
  clock: Clock;
  online: boolean;
} {
  const [show, setShow] = useState<Show>(RESTING);
  const [scheme, setScheme] = useState<Scheme | null>(null);
  const [library, setLibrary] = useState<Library | null>(null);
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [grid, setGrid] = useState<SetGrid | null>(null);
  const [lab, setLab] = useState<LabState | null>(null);
  const [labLog, setLabLog] = useState<{ reviews: LabReviewRow[]; more: boolean } | null>(null);
  const [labStage, setLabStage] = useState<{
    id: string;
    flow: FlowDef;
    bundle: Record<string, FlowDef>;
  } | null>(null);
  const [online, setOnline] = useState(false);
  const live = useRef<WebSocket | null>(null);

  // The show is also held in a ref because the render loop reads it every frame
  // and must not be re-created when React re-renders for the overlay.
  const held = useRef<Show>(RESTING);
  const timing = useRef({ tempo: 120, anchorBeat: 0, anchorAt: 0, beat: 0, seconds: 0 });

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry: number | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
      socket = new WebSocket(url);
      live.current = socket;

      socket.onopen = () => setOnline(true);
      socket.onclose = () => {
        setOnline(false);
        // Forever, like the server's own reconnect: a visuals machine is left
        // running and must recover from the other end restarting.
        if (!closed && retry === null) {
          retry = window.setTimeout(() => {
            retry = null;
            connect();
          }, 1000);
        }
      };
      socket.onerror = () => socket?.close();

      socket.onmessage = (event) => {
        const message = JSON.parse(event.data as string) as Down;
        const t = timing.current;
        if (message.kind === 'scheme') {
          setScheme(message.scheme);
          return;
        }
        if (message.kind === 'library') {
          const { kind: _, ...state } = message;
          setLibrary(state);
          return;
        }
        if (message.kind === 'grid') {
          setGrid(message.grid);
          return;
        }
        if (message.kind === 'media') {
          setMedia(message.assets);
          return;
        }
        if (message.kind === 'lab') {
          const { kind: _, ...state } = message;
          setLab(state);
          return;
        }
        // A page merges rather than replaces: paging asks for older rows while
        // the newest are already on screen, and a changed row lands the same
        // way. Sorted by id descending, which is newest-first.
        if (message.kind === 'lab-log' || message.kind === 'lab-review-changed') {
          const arrived = message.kind === 'lab-log' ? message.reviews : [message.review];
          const grew = message.kind === 'lab-log' ? message.more : null;
          setLabLog((was) => {
            const byId = new Map((was?.reviews ?? []).map((row) => [row.id, row]));
            for (const row of arrived) byId.set(row.id, row);
            return {
              reviews: [...byId.values()].sort((a, b) => b.id - a.id),
              more: grew ?? was?.more ?? false,
            };
          });
          return;
        }
        if (message.kind === 'lab-candidate') {
          setLabStage({ id: message.id, flow: message.flow, bundle: message.bundle });
          return;
        }
        if (message.kind === 'anchor') {
          t.tempo = message.tempo;
          t.anchorBeat = message.beat;
          t.anchorAt = performance.now();
          // Levels and faders ride the anchor rather than waking a full push,
          // so patch them into the held show in place. Nothing re-renders.
          const next: Show = { ...held.current, playing: message.playing, master: message.master };
          next.tracks = next.tracks.map((track, i) => ({
            ...track,
            level: message.levels[i] ?? track.level,
            opacity: message.opacity[i] ?? track.opacity,
          }));
          held.current = next;
          return;
        }
        t.tempo = message.tempo;
        t.anchorBeat = message.beat;
        t.anchorAt = performance.now();
        held.current = message;
        setShow(message);
      };
    };

    connect();
    return () => {
      closed = true;
      if (retry !== null) window.clearTimeout(retry);
      socket?.close();
    };
  }, []);

  const clock = useRef<Clock>({
    advance(dt) {
      const t = timing.current;
      t.seconds += dt;
      t.beat += dt * (t.tempo / 60);
      const target = t.anchorBeat + ((performance.now() - t.anchorAt) / 1000) * (t.tempo / 60);
      const error = target - t.beat;
      // The free run above is what makes the steady-state error zero. Easing
      // *without* it would leave a constant lag — the correction only ever
      // supplies a fraction of the error, so it settles where that fraction
      // equals a frame's worth of travel, which at 132 bpm is a tenth of a
      // second behind the music and audible as being behind it.
      t.beat += error * 0.15;
      // Anything past half a beat is a discontinuity rather than drift: the
      // transport jumped, this is the first anchor, or the tab was throttled
      // in the background and the free run has been clamped for a while.
      // Easing across one of those would be seconds of visibly wrong picture.
      if (Math.abs(error) > 0.5) t.beat = target;
    },
    beat: () => timing.current.beat,
    seconds: () => timing.current.seconds,
  }).current;

  // Two readers at two rates: the overlay re-renders on a real change, and the
  // render loop reads the ref sixty times a second without involving React at
  // all. A meter arriving on an anchor updates the ref and nothing re-renders,
  // which is the whole reason levels don't wake a diff on the server either.
  const edit = useRef((next: Scheme) => {
    // Optimistic, so a control follows the pointer rather than the round trip.
    // The server answers with what it resolved, which is what finally sticks.
    setScheme(next);
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: 'scheme', scheme: next }));
    }
  }).current;

  const saveScheme = useRef(() => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ kind: 'save-scheme' }));
  }).current;

  const saveSchemeAs = useRef((id: string) => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: 'save-scheme-as', id }));
    }
  }).current;

  const loadScheme = useRef((id: string) => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: 'load-scheme', id }));
    }
  }).current;

  const downbeat = useRef(() => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ kind: 'downbeat' }));
  }).current;

  const nextFlow = useRef(() => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ kind: 'next-flow' }));
  }).current;

  const labOpen = useRef(() => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ kind: 'lab-open' }));
  }).current;

  const labReview = useRef((review: LabSubmission) => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: 'lab-review', review }));
    }
  }).current;

  const labSkip = useRef((candidateId: string) => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: 'lab-skip', candidateId }));
    }
  }).current;

  const labOffer = useRef((flowId: string) => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: 'lab-offer', flowId }));
    }
  }).current;

  const labRescore = useRef((reviewId: number, score: LabScore) => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: 'lab-rescore', reviewId, score }));
    }
  }).current;

  const labLogOpen = useRef((before?: number) => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: 'lab-log', ...(before === undefined ? {} : { before }) }));
    }
  }).current;

  const labRetag = useRef((reviewId: number, tags: string[]) => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: 'lab-retag', reviewId, tags }));
    }
  }).current;

  const labRenote = useRef((reviewId: number, note: string) => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: 'lab-renote', reviewId, note }));
    }
  }).current;

  const labCandidate = useRef((candidateId: string) => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: 'lab-candidate', candidateId }));
    }
  }).current;

  return {
    show,
    showRef: held,
    scheme,
    library,
    media,
    grid,
    edit,
    saveScheme,
    saveSchemeAs,
    loadScheme,
    downbeat,
    nextFlow,
    lab,
    labOpen,
    labReview,
    labSkip,
    labOffer,
    labLog,
    labLogOpen,
    labRescore,
    labRetag,
    labRenote,
    labStage,
    labCandidate,
    clock,
    online,
  };
}

export { RESTING };
