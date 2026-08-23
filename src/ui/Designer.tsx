import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Circuit, NodeKind, Scheme, Show } from '../../protocol.ts';
import { wouldLoop } from '../../protocol.ts';
import type { GraphView } from '../../../widgets/src/chrome/Graph.tsx';
import { format } from '../../../widgets/src/param/format.ts';
import { Button } from '../../../widgets/src/controls/Button.tsx';
import { Knob } from '../../../widgets/src/controls/Knob.tsx';
import { NumberField } from '../../../widgets/src/controls/NumberField.tsx';
import { Select } from '../../../widgets/src/controls/Select.tsx';
import { Toggle } from '../../../widgets/src/controls/Toggle.tsx';
import { CircuitEditor, type NumberReading } from './Circuit.tsx';
import {
  addFlow,
  dropFlow,
  forkFlow,
  flowList,
  renameFlow,
  setCircuit,
  setNode,
} from './edits.ts';
import {
  aboutFlow,
  drop,
  flowShelf,
  keyOf,
  matching,
  matchingFlows,
  palette,
  pickOf,
  swapEntry,
  type Entry,
  type FlowRow,
  type Pick,
} from './nodes.ts';
import { NodePictures, type NodePictureStatus } from './NodePictures.tsx';
import { createNumberEvaluator, type NumberSample } from '../render/evaluateNumber.ts';
import { inletsOf, portId } from '../render/circuit.ts';
import { FloatingBench } from './Preview.tsx';
import { BPM, ENERGY, PERCENT, VALUE } from './param.ts';
import { KEYS, useRoom, withStandIns, type Room } from '../state/useRoom.ts';
import { useTransport, type Transport } from '../state/useTransport.ts';
import type { Clock } from '../state/useShow.ts';
import './circuit.css';
import './console.css';

const PICTURES_KEY = 'bsv.visuals.live-node-pictures';
const DISPLAY_RATE_MS = 100;

const EMPTY_PICTURE_STATUS: NodePictureStatus = {
  mounted: 0,
  visible: 0,
  live: 0,
  paused: 0,
  culled: 0,
  reason: null,
};

function displayNumber(value: number): string {
  if (value >= 0 && value <= 1) return format(VALUE, PERCENT.to(value));
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/** One display-rate reading for every number row, including unsupported ones. */
export function readingsOf(circuit: Circuit, sample: NumberSample): Record<string, NumberReading> {
  const readings: Record<string, NumberReading> = {};
  for (const node of circuit.nodes) {
    for (const port of inletsOf(node)) {
      if (port.kind !== 'n' || port.name.startsWith('~')) continue;
      const id = portId(node.id, port.name);
      const value = sample.inlet(id);
      readings[id] = value === undefined ? {} : { value, display: displayNumber(value) };
    }
  }
  return readings;
}

/** Keep React asleep while a signal moves inside the same printed value. */
export function sameDisplayedReadings(
  left: Readonly<Record<string, NumberReading>>,
  right: Readonly<Record<string, NumberReading>>,
): boolean {
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => key in right && left[key]?.display === right[key]?.display);
}

/**
 * The flow builder, which is the whole product.
 *
 * Everything else this app does is arrangements of what gets made here. There
 * used to be three views and a four-level cascade above them, and all of it
 * existed to answer one question — how two pictures combine — which a graph
 * answers by being a graph. So the console is this, and a small page for the
 * wheel that turns through what you built.
 *
 * ## Two shelves, one box, and the difference between them is the point
 *
 * The left side is **flows** over **nodes** under one search box. It used to be
 * two lists that did not know about each other, and every flow appeared in both
 * — once as something to open and once, in the node palette under `draw`, as a
 * chip identical to `source` and `paint`. So a graph of sixteen nodes and a
 * shipped shader were the same object to anyone reading the column, and the
 * only way to find out which you were holding was to drop it.
 *
 * Now a flow is a **row of its own kind**: marked `◈`, saying how many nodes
 * are inside it, and carrying two verbs where a node has one — click the name
 * to **open** it, click `⤵` to **place** it in the flow you already have open.
 * A node is one line with its signature on the right. The search box reaches
 * both shelves, which is what pays for the separation: pulling flows out of the
 * palette would otherwise have made them harder to find than they were.
 *
 * See [`nodes.ts`](./nodes.ts) for the two row types and why they are two.
 *
 * ## The canvas is a way in
 *
 * A `flow` node names a graph, and the only way to open that graph used to be
 * finding its name again in the sidebar — so the containment this whole model
 * rests on was invisible on the screen that draws it. `⤢` on the node opens it,
 * and a trail across the top of the canvas is the way back up.
 *
 * ## The picture floats, and there is no third column
 *
 * The bench used to be a fixed column on the right, which spent the widest part
 * of the screen on the thing you look at least and gave the thing you are
 * actually judging 236 pixels. It is a panel over the canvas now — drag it by
 * its header, stretch it by its corner, park it where the graph is empty. See
 * [`Preview.tsx`](./Preview.tsx).
 *
 * ## It runs on its own room
 *
 * Everything here used to read Link through the show, which is right on stage
 * and exactly wrong at a desk: it made *Ableton running* a precondition for
 * drawing a picture. That argument did not stop at the clock, and neither does
 * this — tempo, energy, section, colourway and key are all conditions a flow
 * behaves differently under, and all of them are now dialled rather than waited
 * for. [`useRoom`](../state/useRoom.ts) hands back the `Show` that comes out.
 * **Follow the room** turns the lot off and reads the real one; following is
 * the option, not the fallback.
 */
export function Designer({
  show,
  scheme,
  save,
  clock,
  flow,
  setFlow,
}: {
  show: Show;
  scheme: Scheme;
  save(next: Scheme): void;
  /** The room's clock, when there is a room. The transport may follow it. */
  clock: Clock;
  /** Which flow is open, held above so the tab bar can name it. */
  flow: string | null;
  setFlow(id: string | null): void;
}) {
  const list = flowList(scheme);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [promoted, setPromoted] = useState<string | null>(null);
  const [swapping, setSwapping] = useState<{
    flow: string;
    node: string;
    kind: NodeKind;
  } | null>(null);
  const [pictures, setPictures] = useState(() => {
    try {
      return localStorage.getItem(PICTURES_KEY) !== 'off';
    } catch {
      return true;
    }
  });
  const [pictureStatus, setPictureStatus] = useState<NodePictureStatus>(EMPTY_PICTURE_STATUS);
  const [numberReadings, setNumberReadings] = useState<Readonly<Record<string, NumberReading>>>({});
  const graphView = useRef<GraphView | null>(null);
  const graphScale = useCallback(() => graphView.current?.scale() ?? 1, []);
  /**
   * Which nodes have their presets open, by kind.
   *
   * Kept here rather than in the browser so that typing in the search box and
   * clearing it again leaves the drawers as they were — a list that reshuffled
   * itself shut every time you looked something up would be a list you stop
   * opening.
   */
  const [opened, setOpened] = useState<readonly string[]>([]);
  /**
   * How you got to the flow you are in, so ⤢ has a way back.
   *
   * Entering a flow from a node on the canvas is a move *down*, and a move down
   * with no way up is how a graph editor loses people. The trail is here rather
   * than beside the open flow because it is a fact about this visit — reopen the
   * same flow from the shelf tomorrow and you did not come from anywhere.
   */
  const [trail, setTrail] = useState<readonly string[]>([]);

  const canFollow = show.clock && show.connected;
  const transport = useTransport(clock, canFollow);
  const room = useRoom(show, scheme, transport);

  const id = flow && scheme.flows[flow] ? flow : (list[0]?.id ?? null);
  const def = id ? scheme.flows[id] : null;
  const activeSwap =
    swapping &&
    swapping.flow === id &&
    def?.circuit.nodes.some((node) => node.id === swapping.node && node.kind === swapping.kind)
      ? swapping
      : null;

  /**
   * The names a `track` or `energy` node may point at, **distinct**.
   *
   * A real set has five tracks called `MIDI`, and a `track` node addresses a
   * track by *name* — so five of them are five chips that do exactly the same
   * thing, five identical rows in a Select, and five React children under one
   * key. The last of those is the one that shouts: the browser rebuilds
   * whenever the show does, so it warned about once a second for as long as the
   * designer was open.
   */
  const trackNames = useMemo(
    () => [...new Set([...show.tracks.map((t) => t.name), 'master'])],
    [show.tracks],
  );
  const all = useMemo(() => palette(trackNames), [trackNames]);
  const found = useMemo(() => matching(all, typed), [all, typed]);
  // One box, two shelves. The flow shelf has to answer the search too, or
  // pulling flows out of the node palette would have made them harder to find
  // than they were — which is the opposite of the point.
  const shelf = useMemo(() => matchingFlows(flowShelf(scheme), typed), [scheme, typed]);
  const swap = activeSwap ? swapEntry(activeSwap.kind) : null;
  const browsed = swap ? matching([swap], typed) : found;

  const evaluator = useRef<ReturnType<typeof createNumberEvaluator> | null>(null);
  if (!evaluator.current) evaluator.current = createNumberEvaluator();
  const numberSource = useRef({
    circuit: def?.circuit ?? null,
    show: room.show,
    beat: transport.beat,
    seconds: transport.seconds,
    pace: scheme.defaults.pace,
  });
  numberSource.current = {
    circuit: def?.circuit ?? null,
    show: room.show,
    beat: transport.beat,
    seconds: transport.seconds,
    pace: scheme.defaults.pace,
  };

  useEffect(() => {
    evaluator.current?.reset();
    setNumberReadings({});
    setSwapping(null);
  }, [id]);

  useEffect(() => {
    let last = performance.now();
    const latch = () => {
      const now = performance.now();
      const source = numberSource.current;
      const held = evaluator.current;
      if (!source.circuit || !held) {
        setNumberReadings((was) => (Object.keys(was).length === 0 ? was : {}));
        last = now;
        return;
      }
      const beat = source.beat();
      const sample = held.sample(source.circuit, {
        show: withStandIns(source.show, beat),
        beat,
        seconds: source.seconds(),
        dt: Math.min((now - last) / 1000, 0.25),
        pace: source.pace,
      });
      last = now;
      const next = readingsOf(source.circuit, sample);
      setNumberReadings((was) => (sameDisplayedReadings(was, next) ? was : next));
    };
    latch();
    const timer = window.setInterval(latch, DISPLAY_RATE_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PICTURES_KEY, pictures ? 'on' : 'off');
    } catch {
      // A blocked store changes only whether this preference survives a reload.
    }
  }, [pictures]);

  const wire = (next: Circuit) => {
    if (!id) return;
    save(setCircuit(scheme, id, next));
  };

  /**
   * Which node the bench is showing, resolved rather than remembered.
   *
   * Deriving it from the graph every render is what makes switching flows and
   * deleting nodes need no handling at all: an id the open flow does not contain
   * simply is not promoted, so the panel falls back to the whole flow instead of
   * going blank on a node that no longer exists.
   */
  const probing = def?.circuit.nodes.find((node) => node.id === promoted) ?? null;

  /**
   * `out`'s picture *is* the finished flow, so promoting it means clearing.
   *
   * `probeAt` says the same thing by returning the circuit unchanged. Reading it
   * as a node preview would put "one node" over a picture of the whole flow,
   * which is the one caption this panel must never show.
   */
  const promote = (nodeId: string) => {
    const node = def?.circuit.nodes.find((each) => each.id === nodeId);
    setPromoted(!node || node.kind === 'out' || nodeId === promoted ? null : nodeId);
  };

  /**
   * A flow node is refused before it is dropped, not when it fails to compile.
   *
   * At compile time the honest message is "one of these seven flows contains
   * itself", which nobody can act on. At the moment of dropping, the message is
   * about the thing you just clicked.
   */
  const add = (pick: Pick) => {
    if (!def || !id) return;
    if (pick.kind === 'flow' && pick.op && wouldLoop(scheme.flows, id, pick.op)) {
      setError(`${pick.label} already contains ${def.name} — a flow cannot hold itself`);
      return;
    }
    setError(null);
    wire(drop(def.circuit, pick));
  };

  /** Open one from the shelf, which is a jump rather than a step: no trail. */
  const open = (next: string) => {
    setTrail([]);
    setFlow(next);
  };

  /** Open one from a node on the canvas, which is a step down and remembers. */
  const enter = (next: string) => {
    if (!id || next === id) return;
    setTrail((was) => [...was, id]);
    setFlow(next);
  };

  /** Back up the trail to a flow you came through, dropping everything under it. */
  const back = (at: number) => {
    const to = trail[at];
    if (!to) return;
    setTrail(trail.slice(0, at));
    setFlow(to);
  };

  /** Place a flow in the open one, as a node. The refusal in `add` still applies. */
  const place = (row: FlowRow) => add(pickOf(row));

  const choose = (pick: Pick) => {
    if (!activeSwap || !def) {
      add(pick);
      return;
    }
    const held = def.circuit.nodes.find((node) => node.id === activeSwap.node);
    if (!held) return;
    wire(
      setNode(def.circuit, held.id, {
        op: pick.op,
        ...(pick.values ? { values: { ...held.values, ...pick.values } } : {}),
      }),
    );
    setSwapping(null);
    setTyped('');
  };

  return (
    <div className="designer wdg">
      <TheRoom room={room} transport={transport} canFollow={canFollow} />

      <div className="body">
        <aside className="library">
          <div className="find-row" {...(activeSwap ? { 'data-swapping': '' } : {})}>
            <input
              className="field find"
              value={typed}
              spellCheck={false}
              placeholder={activeSwap ? `swap ${activeSwap.kind} mode` : 'find a flow or a node'}
              aria-label={activeSwap ? `Find a ${activeSwap.kind} mode` : 'Find a flow or a node'}
              onChange={(e) => setTyped(e.target.value)}
            />
            {activeSwap && (
              <Button
                tone="quiet"
                label="Close mode browser"
                onPress={() => {
                  setSwapping(null);
                  setTyped('');
                }}
              >
                ×
              </Button>
            )}
          </div>

          {!activeSwap && (
            <div className="shelf shelf-flows">
              <div className="shelf-head">
                <h4>flows</h4>
                <Button
                  className="act"
                  title="A new flow, empty but for its out"
                  onPress={() => {
                    const made = addFlow(scheme);
                    save(made.scheme);
                    open(made.id);
                  }}
                >
                  ＋
                </Button>
                {id && (
                  <Button
                    className="act"
                    title="A copy, to take apart without losing this one"
                    onPress={() => {
                      const made = forkFlow(scheme, id);
                      save(made.scheme);
                      open(made.id);
                    }}
                  >
                    fork
                  </Button>
                )}
                {id && list.length > 1 && (
                  <Button
                    className="act"
                    tone="danger"
                    title={`Delete ${def?.name || id}`}
                    onPress={() => {
                      save(dropFlow(scheme, id));
                      setTrail([]);
                      setFlow(null);
                    }}
                  >
                    ×
                  </Button>
                )}
              </div>
              {shelf.length === 0 && <p className="cap flat">no flow by that name</p>}
              {shelf.map((row) => {
                // Not offered where it would be refused. `add` still refuses it
                // — the model is the authority — but a button that exists only
                // to produce an error message is a button that teaches the
                // wrong thing about what nesting can do. Same argument as the
                // missing delete on `out`.
                const placeable = id !== null && !wouldLoop(scheme.flows, id, row.id);
                return (
                  <div key={row.id} className="flow-row" data-on={row.id === id ? '' : undefined}>
                    <button
                      type="button"
                      className="flow-open"
                      title={`Open ${row.name} — ${row.about}`}
                      onClick={() => open(row.id)}
                    >
                      <span className="flow-name">
                        <b className="mark">◈</b>
                        {row.name}
                        {row.rolled && <i title="wired by a roll — the next roll replaces it">◇</i>}
                      </span>
                      <span className="flow-about">{row.about}</span>
                    </button>
                    {placeable && (
                      <Button
                        tone="quiet"
                        className="flow-place"
                        label={`Place ${row.name} in ${def?.name || 'this flow'}`}
                        title={`Place it in ${def?.name || 'this flow'} as one node`}
                        onPress={() => place(row)}
                      >
                        ⤵
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="shelf shelf-nodes">
            <div className="shelf-head">
              <h4>{activeSwap ? `${activeSwap.kind} modes` : 'nodes'}</h4>
              <button
                type="button"
                className="tick pictures-toggle"
                data-on={pictures ? '' : undefined}
                aria-pressed={pictures}
                onClick={() => setPictures((on) => !on)}
              >
                live pictures
              </button>
            </div>
            <span className="picture-status">
              {pictureStatus.live} live / {pictureStatus.visible} visible
              {pictureStatus.reason === 'off'
                ? ' · off'
                : pictureStatus.reason === 'zoom'
                  ? ' · paused at this zoom'
                  : pictureStatus.reason === 'budget'
                    ? ` · ${pictureStatus.paused} paused`
                    : ''}
            </span>
            <NodeBrowser
              entries={browsed}
              // Everything a search turned up is drawn open, because a preset
              // found behind a closed drawer has not been found.
              opened={activeSwap || typed.trim() ? null : opened}
              onOpen={(kind) =>
                setOpened((was) =>
                  was.includes(kind) ? was.filter((each) => each !== kind) : [...was, kind],
                )
              }
              onAdd={choose}
            />
          </div>
        </aside>

        <div className="canvas-wrap">
          {trail.length > 0 && (
            <nav className="trail" aria-label="How you got here">
              {trail.map((each, at) => (
                <button
                  key={`${each}${at}`}
                  type="button"
                  className="crumb"
                  onClick={() => back(at)}
                >
                  {scheme.flows[each]?.name || each}
                </button>
              ))}
              <span className="crumb here">{def?.name || id}</span>
            </nav>
          )}

          {def && id && (
            <div className="naming">
              <input
                className="field"
                value={def.name}
                spellCheck={false}
                aria-label="Flow name"
                onChange={(e) => save(renameFlow(scheme, id, e.target.value))}
              />
              <span className="cap">{def ? aboutFlow(def) : ''}</span>
              <Uses scheme={scheme} show={show} id={id} />
              <span className="gap" />
              {error && <span className="bad">{error}</span>}
            </div>
          )}

          {def && (
            <NodePictures
              circuit={def.circuit}
              show={room.show}
              scheme={scheme}
              transport={transport}
              enabled={pictures}
              scale={graphScale}
              promoted={promoted}
              onStatus={setPictureStatus}
            >
              {(picture) => (
                <CircuitEditor
                  circuit={def.circuit}
                  onChange={wire}
                  tracks={trackNames}
                  flows={list}
                  viewRef={graphView}
                  energy={room.show.master}
                  beat={transport.beat}
                  numberReadings={numberReadings}
                  onSwap={(nodeId, kind) => {
                    if (id) setSwapping({ flow: id, node: nodeId, kind });
                    setTyped('');
                  }}
                  onEnter={enter}
                  // The picture stays a picture and the click is wrapped round
                  // it, because which node is promoted is a fact about *this*
                  // page rather than about drawing a node. `NodePictures` hands
                  // its faces over through a child function precisely so the
                  // page can put something round them.
                  picture={(nodeId) => (
                    <button
                      type="button"
                      className="promote"
                      data-on={nodeId === promoted ? '' : undefined}
                      aria-pressed={nodeId === promoted}
                      title="Show this node in the picture"
                      onClick={() => promote(nodeId)}
                    >
                      {picture(nodeId)}
                    </button>
                  )}
                />
              )}
            </NodePictures>
          )}

          {id && (
            <FloatingBench
              show={room.show}
              scheme={scheme}
              flow={id}
              clock={transport}
              onError={setError}
              aside={room.following ? 'from the room' : 'from the desk'}
              probing={probing}
              onProbe={setPromoted}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Every condition a flow behaves differently under, in one group.
 *
 * The energy knob arrived on its own and made the case for the rest: if you can
 * dial the room's energy without a band in it, there is no reason to wait for a
 * rehearsal to reach a chorus, or for the wheel to land on the third colourway,
 * or for the one song in F# minor. Each of those is a `song` or `paint` node
 * reading a number, and each was previously unreachable at a desk.
 *
 * Grouped rather than scattered because they are one idea — *pretend it is like
 * this* — and because the switch that turns them off has to be visibly attached
 * to all of them. `follow the room` is that switch, and it is the transport's
 * own `following` widened from the clock to everything beside it; the reasoning
 * for one switch rather than six is in [`useRoom`](../state/useRoom.ts).
 */
function TheRoom({
  room,
  transport,
  canFollow,
}: {
  room: Room;
  transport: Transport;
  canFollow: boolean;
}) {
  const following = room.following;
  return (
    <div className="bar room">
      <span className="cap">the room</span>
      <Toggle
        on={transport.playing}
        onChange={transport.setPlaying}
        disabled={following}
        width={46}
      >
        {transport.playing ? 'playing' : 'stopped'}
      </Toggle>
      <NumberField
        param={BPM}
        value={transport.bpm}
        onChange={transport.setBpm}
        name="bpm"
        disabled={following}
      />
      <Button onPress={transport.restart} disabled={following}>
        to the top
      </Button>
      <Knob
        param={ENERGY}
        value={PERCENT.to(room.energy)}
        onChange={(v) => room.setEnergy(PERCENT.from(v))}
        name="energy"
        disabled={following}
      />
      <Select
        items={room.sections}
        index={Math.max(0, room.sections.indexOf(room.section))}
        onChange={(at) => room.setSection(room.sections[at])}
        name="section"
        width={104}
        disabled={following || room.sections.length === 0}
        title="What a `song section` node reports"
      />
      <Select
        items={room.colorways}
        index={Math.max(0, room.colorways.indexOf(room.colorway))}
        onChange={(at) => room.setColorway(room.colorways[at])}
        name="colourway"
        width={110}
        disabled={following || room.colorways.length === 0}
        title="What `paint` and the set's own tracks draw from"
      />
      <Select
        items={KEYS}
        index={room.keyAt}
        onChange={room.setKeyAt}
        name="key"
        width={58}
        disabled={following}
        title="What a `song key` node reports"
      />
      <span className="gap" />
      <Toggle
        on={following}
        onChange={transport.setFollowing}
        disabled={!canFollow}
        width={96}
        title={
          canFollow
            ? 'Draw the real show instead — its beat, its energy, its section, its colourway and its key'
            : 'Nothing to follow — no bridge is connected'
        }
      >
        follow the room
      </Toggle>
      <span className="cap">{following ? 'the real show' : 'made up · no set needed'}</span>
    </div>
  );
}

/**
 * The vocabulary, grouped and searchable — a device browser, not a list of modes.
 *
 * Grouped by family rather than by node kind, and the families are declared in
 * `protocol.ts` rather than here — two editors listing these differently would
 * be two different vocabularies, and the one thing a browser must not do is
 * disagree with the compiler about what exists.
 *
 * **One node per row.** These were chips wrapping into a paragraph, which packs
 * a lot of names into a short column and gives every one of them the same
 * nothing to say for itself. A row has a right-hand side, and what goes there is
 * the node's signature — `p → c`, `n → n` — because the question you have
 * before you drop a node is whether the cord in your hand can reach it, and a
 * browser that makes you drop one to find out costs an undo per question.
 *
 * The count beside a row opens its presets, each of which drops that node
 * already configured, with its one-line description in the same right-hand
 * column. A row with nothing under it is a target — a track's meter — and reads
 * differently for having nothing to open rather than for being labelled.
 *
 * **No flows.** They have a shelf above this one; see `flowShelf` in
 * [`nodes.ts`](./nodes.ts) for why they are not rows here.
 */
function NodeBrowser({
  entries,
  opened,
  onOpen,
  onAdd,
}: {
  entries: readonly Entry[];
  /** Which kinds are open, or null for "everything shown is open". */
  opened: readonly string[] | null;
  onOpen(kind: string): void;
  onAdd(pick: Pick): void;
}) {
  const families = [...new Set(entries.map((each) => each.node.family))];
  return (
    <div className="palette">
      {entries.length === 0 && <p className="cap flat">nothing by that name</p>}
      {families.map((family) => (
        <div key={family} className="group">
          <h5>{family}</h5>
          {entries
            .filter((each) => each.node.family === family)
            .map((entry) => {
              const on = opened === null || opened.includes(entry.node.kind);
              return (
                <div
                  key={keyOf(entry.node)}
                  className="node-entry"
                  data-open={on && entry.presets.length > 0 ? '' : undefined}
                >
                  <div className="node-row">
                    <button
                      type="button"
                      className="node-pick"
                      data-kind={entry.node.kind}
                      title={entry.node.about}
                      onClick={() => onAdd(entry.node)}
                    >
                      <span className="node-label">{entry.node.label}</span>
                      <span className="node-sig">{entry.node.signature}</span>
                    </button>
                    {entry.presets.length > 0 && (
                      <Button
                        tone="quiet"
                        className="more"
                        label={`${on ? 'Hide' : 'Show'} the presets of ${entry.node.label}`}
                        title={`${entry.presets.length} presets`}
                        onPress={() => onOpen(entry.node.kind)}
                      >
                        {on ? '–' : `+${entry.presets.length}`}
                      </Button>
                    )}
                  </div>
                  {on && entry.presets.length > 0 && (
                    <div className="under">
                      {entry.presets.map((preset) => (
                        <button
                          key={preset.op}
                          type="button"
                          className="node-pick preset"
                          data-kind={preset.kind}
                          title={preset.about}
                          onClick={() => onAdd(preset)}
                        >
                          <span className="node-label">{preset.label}</span>
                          <span className="node-about">{preset.about}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      ))}
    </div>
  );
}

/**
 * Where this flow is reachable from, which is the question the designer used to
 * have no answer to.
 *
 * Deliberately not an editor. The wheel and the song pins live on the set page,
 * and putting a second way to change them here would mean two places that could
 * disagree. What this answers is "if I make this good, will anyone see it" —
 * and the honest answer is usually yes, because an empty pool means everything.
 *
 * One line beside the flow's name rather than a pane of its own. It was a list
 * in the bench's sidebar, which is a lot of furniture for a sentence you read
 * once a session — and the sidebar it was in was costing the picture the width
 * it wanted.
 */
function Uses({ scheme, show, id }: { scheme: Scheme; show: Show; id: string | null }) {
  if (!id) return null;
  const pool = scheme.rotation.flows;
  const turning = pool.length === 0 || pool.includes(id);
  const pinned = Object.entries(scheme.songs).filter(([, spec]) => spec.flows?.includes(id));
  const inside = Object.entries(scheme.flows).filter(
    ([other, def]) => other !== id && def.circuit.nodes.some((n) => n.kind === 'flow' && n.op === id),
  );
  const parts = [
    turning
      ? pool.length === 0
        ? 'in the wheel — nothing narrowed'
        : 'in the wheel'
      : 'not in the wheel',
    pinned.length > 0
      ? `pinned by ${pinned.length} song${pinned.length === 1 ? '' : 's'}`
      : null,
    inside.length > 0 ? `inside ${inside.map(([, def]) => def.name).join(', ')}` : null,
  ].filter(Boolean);
  return (
    <span className="cap uses">
      {parts.join(' · ')}
      {show.flow === id && <em>on screen now</em>}
    </span>
  );
}


