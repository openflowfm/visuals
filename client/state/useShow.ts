import { useEffect, useRef, useState } from 'react';
import type {
  CalibrationState,
  CalibrationSubmission,
  Down,
  FlowDef,
  LabArchiveSubmission,
  LabComparisonSubmission,
  LabFinalsSubmission,
  LabBatchSubmission,
  LabBookmarkSubmission,
  LabDevelopRequest,
  LabLineageFinalistSubmission,
  LabSeedSubmission,
  LabReviewRow,
  LabScore,
  LabSelection,
  LabState,
  LabSubmission,
  Library,
  MediaAsset,
  Scheme,
  SetGrid,
  Show,
} from '../../protocol.ts';
import type {
  ModelLibrary,
  ModelRevisionDecision,
  ModelSetupDraft,
} from '../../model.ts';

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
  since: 0,
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
  /** Immutable GLBs and reusable OpenFlow-owned setup metadata. */
  models: ModelLibrary;
  importModel(file: File): Promise<void>;
  importModelTexture(file: File): Promise<void>;
  saveModelSetup(setup: ModelSetupDraft): void;
  reconcileModel(
    setupId: string,
    assetHash: string,
    decision: ModelRevisionDecision,
  ): void;
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
  /** The mirror gesture: turn only the colourway wheel once. */
  nextColorway(): void;
  /** The active lab search, or null until Train has asked for it. */
  lab: LabState | null;
  /** Ask for the queue's state. The one thing that makes the server deal. */
  labOpen(): void;
  /** One historical binary preference, retained for old method clients. */
  labSelect(selection: LabSelection): void;
  /** One explicit Explore or Refine comparison. */
  labCompare(comparison: LabComparisonSubmission): void;
  /** No preference was formed for this pair. */
  labSkipEncounter(encounterId: number): void;
  /** Open historical preservation replay without generating anything. */
  labArchiveOpen(): void;
  /** Focus one historical candidate from the lineage forest. */
  labArchiveSelect(candidateId: string): void;
  /** Preserve, pass, or clear one absolute finished-work judgment. */
  labArchiveDecide(decision: LabArchiveSubmission): void;
  /** Set or clear the representative chosen for one lineage. */
  labLineageFinalist(decision: LabLineageFinalistSubmission): void;
  /** Stage the first fresh root, and keep exactly one waiting after that. */
  labExploreOpen(): void;
  /** Admit or decline one root on its own merits. */
  labExploreJudge(submission: LabSeedSubmission): void;
  /** No judgment was formed about this root. */
  labExploreSkip(encounterId: number): void;
  /** Mark or unmark one work to come back to. */
  labBookmark(decision: LabBookmarkSubmission): void;
  /** Select one node of the forest to develop. */
  labDevelopOpen(candidateId: string): void;
  /** Generate a batch of children on one node and start its tournament. */
  labDevelopDeal(request: LabDevelopRequest): void;
  /** One preference inside the open batch. */
  labDevelopCompare(comparison: LabBatchSubmission): void;
  /** No preference was formed for this match. */
  labDevelopSkip(encounterId: number): void;
  /** Abandon the open batch without answering the rest of it. */
  labDevelopClose(): void;
  /** Freeze/open the diverse playoff for this search experiment. */
  labFinalsOpen(): void;
  /** Freeze a new playoff edition from the current archive. */
  labFinalsNew(): void;
  /** One Finals preference plus independent show-readiness marks. */
  labFinalsCompare(comparison: LabFinalsSubmission): void;
  /** No Finals comparison was formed for this pair. */
  labFinalsSkip(encounterId: number): void;
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
  /** True only when this server was deliberately started with internal calibration enabled. */
  calibrationAvailable: boolean;
  /** Current development calibration queue, unopened until its tab asks. */
  calibration: CalibrationState | null;
  calibrationOpen(trialId?: string, trialVersion?: number): void;
  calibrationDecide(decision: CalibrationSubmission): void;
  clock: Clock;
  online: boolean;
} {
  const [show, setShow] = useState<Show>(RESTING);
  const [scheme, setScheme] = useState<Scheme | null>(null);
  const [library, setLibrary] = useState<Library | null>(null);
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [models, setModels] = useState<ModelLibrary>({ assets: [], setups: [], textures: [], notice: null });
  const [grid, setGrid] = useState<SetGrid | null>(null);
  const [lab, setLab] = useState<LabState | null>(null);
  const [labLog, setLabLog] = useState<{ reviews: LabReviewRow[]; more: boolean } | null>(null);
  const [labStage, setLabStage] = useState<{
    id: string;
    flow: FlowDef;
    bundle: Record<string, FlowDef>;
  } | null>(null);
  const [calibrationAvailable, setCalibrationAvailable] = useState(false);
  const [calibration, setCalibration] = useState<CalibrationState | null>(null);
  const [online, setOnline] = useState(false);
  const live = useRef<WebSocket | null>(null);

  // The show is also held in a ref because the render loop reads it every frame
  // and must not be re-created when React re-renders for the overlay.
  const held = useRef<Show>(RESTING);
  const timing = useRef({
    tempo: 120,
    anchorBeat: 0,
    anchorAt: 0,
    anchorSince: 0,
    beat: 0,
    seconds: 0,
  });
  /** Kinds already complained about, so a skewed server is one line and not a flood. */
  const unknown = useRef(new Set<string>());

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
        let message: Down;
        try {
          message = JSON.parse(event.data as string) as Down;
        } catch {
          return;
        }
        // Read before the chain narrows the union away, because the case worth
        // naming is the one the union does not have a member for.
        const kind = String((message as { kind?: unknown })?.kind);
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
        if (message.kind === 'models') {
          setModels(message.library);
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
        if (message.kind === 'calibration-available') {
          setCalibrationAvailable(message.available);
          if (!message.available) setCalibration(null);
          return;
        }
        if (message.kind === 'calibration') {
          const { kind: _, ...state } = message;
          setCalibration(state);
          return;
        }
        if (message.kind === 'anchor') {
          t.tempo = message.tempo;
          t.anchorBeat = message.beat;
          t.anchorSince = message.since;
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
        // Named rather than assumed. This used to be the fallthrough, so
        // *anything* unrecognised was treated as a full `Show`: a tab left open
        // across a server that gained a message kind read `message.tempo` as
        // undefined, which is a NaN clock, a throw per frame in `drawSet`, and
        // a React unmount to a blank page. A wall skewed from its server should
        // keep drawing the last show it was sent.
        if (message.kind !== 'show') {
          if (!unknown.current.has(kind)) {
            unknown.current.add(kind);
            console.warn(`visuals: ignoring an unknown message kind — ${kind}`);
          }
          return;
        }
        t.tempo = message.tempo;
        t.anchorBeat = message.beat;
        t.anchorSince = message.since;
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
      // Seconds get exactly what the beat gets below, and for the same reason
      // one step out. This used to be the line above and nothing else, so
      // `uTime` counted from whenever *this* window opened — which made every
      // drift, haze and sway a fact about a boot time. Two render boxes started
      // a minute apart were a minute out of phase on all of them.
      //
      // The server is the shared reference, not Link: Link shares a beat
      // timeline and each peer maps it to its own host clock, and deriving
      // seconds from the beat would put drift back in tempo, which is the one
      // thing `uTime` exists not to be.
      const sinceTarget = t.anchorSince + (performance.now() - t.anchorAt) / 1000;
      const sinceError = sinceTarget - t.seconds;
      t.seconds += sinceError * 0.15;
      if (Math.abs(sinceError) > 0.5) t.seconds = sinceTarget;
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

  const nextColorway = useRef(() => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: 'next-colorway' }));
    }
  }).current;

  const importModel = useRef(async (file: File) => {
    const response = await fetch('/models/import', {
      method: 'POST',
      headers: {
        'content-type': 'model/gltf-binary',
        'x-openflow-name': encodeURIComponent(file.name),
      },
      body: file,
    });
    if (!response.ok) {
      throw new Error((await response.text()) || `model import failed (${response.status})`);
    }
  }).current;

  const importModelTexture = useRef(async (file: File) => {
    const response = await fetch('/models/textures/import', {
      method: 'POST',
      headers: {
        'content-type': file.type || 'application/octet-stream',
        'x-openflow-name': encodeURIComponent(file.name),
      },
      body: file,
    });
    if (!response.ok) {
      throw new Error((await response.text()) || `texture import failed (${response.status})`);
    }
  }).current;

  const saveModelSetup = useRef((setup: ModelSetupDraft) => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: 'model-save', setup }));
    }
  }).current;

  const reconcileModel = useRef((
    setupId: string,
    assetHash: string,
    decision: ModelRevisionDecision,
  ) => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: 'model-reconcile', setupId, assetHash, decision }));
    }
  }).current;

  const labOpen = useRef(() => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ kind: 'lab-open' }));
  }).current;

  const labSelect = useRef((selection: LabSelection) => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: 'lab-select', selection }));
    }
  }).current;

  const labCompare = useRef((comparison: LabComparisonSubmission) => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: 'lab-compare', comparison }));
    }
  }).current;

  const labSkipEncounter = useRef((encounterId: number) => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: 'lab-skip-encounter', encounterId }));
    }
  }).current;

  const labArchiveOpen = useRef(() => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: 'lab-archive-open' }));
    }
  }).current;

  const labArchiveSelect = useRef((candidateId: string) => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: 'lab-archive-select', candidateId }));
    }
  }).current;

  const labArchiveDecide = useRef((decision: LabArchiveSubmission) => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: 'lab-archive-decide', decision }));
    }
  }).current;

  const labLineageFinalist = useRef((decision: LabLineageFinalistSubmission) => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: 'lab-lineage-finalist', decision }));
    }
  }).current;

  const labExploreOpen = useRef(() => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: 'lab-explore-open' }));
    }
  }).current;

  const labExploreJudge = useRef((submission: LabSeedSubmission) => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: 'lab-explore-judge', submission }));
    }
  }).current;

  const labExploreSkip = useRef((encounterId: number) => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: 'lab-explore-skip', encounterId }));
    }
  }).current;

  const labBookmark = useRef((decision: LabBookmarkSubmission) => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: 'lab-bookmark', decision }));
    }
  }).current;

  const labDevelopOpen = useRef((candidateId: string) => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: 'lab-develop-open', candidateId }));
    }
  }).current;

  const labDevelopDeal = useRef((request: LabDevelopRequest) => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: 'lab-develop-deal', request }));
    }
  }).current;

  const labDevelopCompare = useRef((comparison: LabBatchSubmission) => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: 'lab-develop-compare', comparison }));
    }
  }).current;

  const labDevelopSkip = useRef((encounterId: number) => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: 'lab-develop-skip', encounterId }));
    }
  }).current;

  const labDevelopClose = useRef(() => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: 'lab-develop-close' }));
    }
  }).current;

  const labFinalsOpen = useRef(() => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: 'lab-finals-open' }));
    }
  }).current;

  const labFinalsNew = useRef(() => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: 'lab-finals-new' }));
    }
  }).current;

  const labFinalsCompare = useRef((comparison: LabFinalsSubmission) => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: 'lab-finals-compare', comparison }));
    }
  }).current;

  const labFinalsSkip = useRef((encounterId: number) => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: 'lab-finals-skip', encounterId }));
    }
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

  const calibrationOpen = useRef((trialId?: string, trialVersion?: number) => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        kind: 'calibration-open',
        ...(trialId && trialVersion ? { trialId, trialVersion } : {}),
      }));
    }
  }).current;

  const calibrationDecide = useRef((decision: CalibrationSubmission) => {
    const socket = live.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ kind: 'calibration-decide', decision }));
    }
  }).current;

  return {
    show,
    showRef: held,
    scheme,
    library,
    media,
    models,
    grid,
    edit,
    saveScheme,
    saveSchemeAs,
    loadScheme,
    downbeat,
    nextFlow,
    nextColorway,
    importModel,
    importModelTexture,
    saveModelSetup,
    reconcileModel,
    lab,
    labOpen,
    labCompare,
    labSkipEncounter,
    labArchiveOpen,
    labArchiveSelect,
    labArchiveDecide,
    labLineageFinalist,
    labExploreOpen,
    labExploreJudge,
    labExploreSkip,
    labBookmark,
    labDevelopOpen,
    labDevelopDeal,
    labDevelopCompare,
    labDevelopSkip,
    labDevelopClose,
    labFinalsOpen,
    labFinalsNew,
    labFinalsCompare,
    labFinalsSkip,
    labSelect,
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
    calibrationAvailable,
    calibration,
    calibrationOpen,
    calibrationDecide,
    clock,
    online,
  };
}

export { RESTING };
