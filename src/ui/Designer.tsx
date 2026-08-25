import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Circuit, MediaAsset, NodeKind, Scheme, Show } from '../../protocol.ts';
import { wouldLoop } from '../../protocol.ts';
import type { GraphView } from '@openflow/widgets/chrome/Graph.tsx';
import { format } from '@openflow/widgets/param/format.ts';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { CircuitEditor, type NumberReading } from './Circuit.tsx';
import {
  addFlow,
  dropFlow,
  forkFlow,
  flowList,
  setCircuit,
  setNode,
} from './edits.ts';
import {
  drop,
  flowShelf,
  keyOf,
  matching,
  matchingFlows,
  NO_FILTER,
  palette,
  pickOf,
  SIGNALS,
  swapEntry,
  type Entry,
  type FlowRow,
  type Pick,
  type Ports as PortSet,
  type Signal,
} from './nodes.ts';
import { NodePictures, type NodePictureStatus } from './NodePictures.tsx';
import { createNumberEvaluator, type NumberSample } from '../render/evaluateNumber.ts';
import { inletsOf, portId } from '../render/circuit.ts';
import { FloatingBench } from './Preview.tsx';
import { PERCENT, VALUE } from './param.ts';
import { withStandIns, type Room } from '../state/useRoom.ts';
import type { Transport } from '../state/useTransport.ts';
import './circuit.css';
import './console.css';

const PICTURES_KEY = 'openflow.visuals.live-node-pictures';
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
  media,
  edit,
  flow,
  setFlow,
  room,
  transport,
  trail,
  setTrail,
}: {
  show: Show;
  scheme: Scheme;
  media: readonly MediaAsset[];
  edit(next: Scheme): void;
  /** Which flow is open, held above so the one header can name it. */
  flow: string | null;
  setFlow(id: string | null): void;
  room: Room;
  transport: Transport;
  trail: readonly string[];
  setTrail(next: readonly string[] | ((was: readonly string[]) => readonly string[])): void;
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
   * Narrow the browser to what a cord in your hand can reach.
   *
   * The search box answers "what is it called" and this answers "what will
   * connect", which is the other half of finding a node and the half nothing
   * could ask before. Holding a `p` outlet and wanting somewhere to put it is a
   * question about ports, not about names.
   */
  const [filter, setFilter] = useState<PortSet>(NO_FILTER);
  /**
   * Which flow's delete is armed. The first press arms it, the second one on
   * the same row commits — an inline confirm, in place of the modal this
   * column has nowhere to put and the undo the scheme does not have. Leaving
   * the row disarms it, so a stale "sure?" can never fire from muscle memory.
   */
  const [arming, setArming] = useState<string | null>(null);

  const id = flow && scheme.flows[flow] ? flow : (list[0]?.id ?? null);
  const def = id ? scheme.flows[id] : null;
  const activeSwap =
    swapping &&
    swapping.flow === id &&
    def?.circuit.nodes.some((node) => node.id === swapping.node && node.kind === swapping.kind)
      ? swapping
      : null;

  /**
   * The names a `track` node may point at, **groups first and distinct**.
   *
   * Groups lead because they are usually the better question. A set with five
   * kick tracks under a `DRUMS` group has one number worth driving a flow from
   * and it is the group's — but the choice stays open, because somebody wanting
   * the one snare should have it, and the rig has no business deciding which of
   * those two a person meant.
   *
   * Distinct, because a real set has five tracks called `MIDI` and a `track`
   * node addresses a track by *name* — so five of them are five identical rows
   * in a Select and five React children under one key. That last one shouts:
   * the browser rebuilds whenever the show does, so it warned about once a
   * second for as long as the designer was open.
   */
  const trackNames = useMemo(
    () => [
      ...new Set([
        'master',
        ...show.groups.map((each) => each.name),
        ...show.tracks.map((each) => each.name),
      ]),
    ],
    [show.groups, show.tracks],
  );
  const all = useMemo(() => palette(), []);
  const found = useMemo(() => matching(all, typed, filter), [all, typed, filter]);
  // One box, two shelves. The flow shelf has to answer the search too, or
  // pulling flows out of the node palette would have made them harder to find
  // than they were — which is the opposite of the point.
  const shelf = useMemo(
    () => matchingFlows(flowShelf(scheme), typed, filter),
    [scheme, typed, filter],
  );
  const swap = activeSwap ? swapEntry(activeSwap.kind) : null;
  // "Nothing by that name" lies when it was the port filter that emptied the
  // column, so the empty states share one verb that clears both narrowings.
  const narrowed = typed.trim() !== '' || filter.takes.length > 0 || filter.gives.length > 0;
  const widen = () => {
    setTyped('');
    setFilter(NO_FILTER);
  };
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
    edit(setCircuit(scheme, id, next));
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

  /** Place a flow in the open one, as a node. The refusal in `add` still applies. */
  const place = (row: FlowRow) => add(pickOf(row));

  const erase = (row: FlowRow) => {
    edit(dropFlow(scheme, row.id));
    setArming(null);
    setTrail((was) => was.filter((each) => each !== row.id));
    if (row.id === id) {
      setTrail([]);
      setFlow(null);
    }
  };

  /** What a delete would orphan, said on the button rather than after the fact. */
  const costOf = (row: FlowRow) => {
    const inside = Object.values(scheme.flows).filter((each) =>
      each.circuit.nodes.some((node) => node.kind === 'flow' && node.op === row.id),
    ).length;
    const pinned = Object.values(scheme.songs).filter((spec) =>
      spec.flows?.includes(row.id),
    ).length;
    const costs = [
      inside > 0 ? `placed inside ${inside} flow${inside === 1 ? '' : 's'}` : null,
      pinned > 0 ? `pinned by ${pinned} song${pinned === 1 ? '' : 's'}` : null,
    ].filter(Boolean);
    return `Delete ${row.name}${costs.length > 0 ? ` — ${costs.join(', ')}` : ''}`;
  };

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
              onKeyDown={(e) => {
                if (e.key !== 'Escape') return;
                if (activeSwap) setSwapping(null);
                setTyped('');
              }}
            />
            {!activeSwap && typed !== '' && (
              <Button tone="quiet" label="Clear the search" onPress={() => setTyped('')}>
                ×
              </Button>
            )}
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
            <PortFilter want={filter} onChange={setFilter} />
          )}

          <div className="stacks">
          {!activeSwap && (
            <div className="shelf shelf-flows">
              <div className="shelf-head">
                <h4>flows</h4>
                <Button
                  className="act"
                  title="A new flow, empty but for its out"
                  onPress={() => {
                    const made = addFlow(scheme);
                    edit(made.scheme);
                    open(made.id);
                  }}
                >
                  new
                </Button>
                {id && (
                  <Button
                    className="act"
                    title="A copy of the open flow, to take apart without losing it"
                    onPress={() => {
                      const made = forkFlow(scheme, id);
                      edit(made.scheme);
                      open(made.id);
                    }}
                  >
                    fork
                  </Button>
                )}
              </div>
              {shelf.length === 0 && <p className="cap flat">no flow matches</p>}
              {shelf.length === 0 && narrowed && (
                <button type="button" className="tick reset" onClick={widen}>
                  show everything
                </button>
              )}
              {shelf.map((row) => {
                // Not offered where it would be refused. `add` still refuses it
                // — the model is the authority — but a button that exists only
                // to produce an error message is a button that teaches the
                // wrong thing about what nesting can do. Same argument as the
                // missing delete on `out`.
                const placeable = id !== null && !wouldLoop(scheme.flows, id, row.id);
                const armed = arming === row.id;
                return (
                  <div
                    key={row.id}
                    className="flow-row"
                    data-on={row.id === id ? '' : undefined}
                    onMouseLeave={() => armed && setArming(null)}
                  >
                    <span className="twist mark" aria-hidden="true">
                      ◈
                    </span>
                    <button
                      type="button"
                      className="flow-open"
                      title={`Open ${row.name} — ${row.about}`}
                      onClick={() => open(row.id)}
                    >
                      <span className="flow-name">
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
                    {list.length > 1 && (
                      <Button
                        tone="quiet"
                        className={armed ? 'flow-x armed' : 'flow-x'}
                        label={armed ? `Really delete ${row.name}` : costOf(row)}
                        title={armed ? 'Press again to delete' : costOf(row)}
                        onPress={() => (armed ? erase(row) : setArming(row.id))}
                      >
                        {armed ? 'sure?' : '×'}
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
            {pictures && (
              <span className="picture-status">
                {pictureStatus.live} live / {pictureStatus.visible} visible
                {pictureStatus.reason === 'zoom'
                  ? ' · paused at this zoom'
                  : pictureStatus.reason === 'budget'
                    ? ` · ${pictureStatus.paused} paused`
                    : ''}
              </span>
            )}
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
              onWiden={narrowed ? widen : undefined}
            />
          </div>
          </div>
        </aside>

        <div className="canvas-wrap">
          {error && <span className="canvas-error bad">{error}</span>}

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
                  media={media}
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
              aside={room.following ? 'live' : 'preview'}
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
 * The signal filter, drawn as the column it filters.
 *
 * Six switches in the same six positions, in the same three colours, as the
 * block on every row — so it needs no label beyond `takes` and `gives`: what
 * you are pressing is a picture of what you are asking for, and the rows that
 * survive are the ones lit in the same places.
 *
 * Selected signals are required rather than allowed. Ticking *takes p* and
 * *gives c* narrows to nodes that do both, which is the question somebody with
 * a point in one hand and an `out` in the other is actually asking.
 */
function PortFilter({ want, onChange }: { want: PortSet; onChange(next: PortSet): void }) {
  const on = Object.keys(want).some((side) => want[side as 'takes' | 'gives'].length > 0);
  const toggle = (side: 'takes' | 'gives', signal: Signal) => {
    const held = want[side];
    onChange({
      ...want,
      [side]: held.includes(signal)
        ? held.filter((each) => each !== signal)
        : SIGNALS.filter((each) => each === signal || held.includes(each)),
    });
  };
  const side = (which: 'takes' | 'gives') => (
    <span className="port-filter-side">
      <b>{which}</b>
      {SIGNALS.map((signal) => (
        <button
          key={`${which}${signal}`}
          type="button"
          data-signal={signal}
          aria-pressed={want[which].includes(signal)}
          {...(want[which].includes(signal) ? { 'data-on': '' } : {})}
          title={`Only what ${which} a ${SIGNAL_NAMES[signal]}`}
          onClick={() => toggle(which, signal)}
        >
          {signal}
        </button>
      ))}
    </span>
  );
  return (
    <div className="port-filter" data-on={on ? '' : undefined}>
      {side('takes')}
      <i>→</i>
      {side('gives')}
      <button
        type="button"
        className="port-filter-clear"
        disabled={!on}
        title="Show everything again"
        onClick={() => onChange(NO_FILTER)}
      >
        ×
      </button>
    </div>
  );
}

const SIGNAL_NAMES: Record<Signal, string> = {
  p: 'point',
  n: 'number',
  c: 'colour',
};

/**
 * A node's ports: all six positions, always, with the ones it has not got dim.
 *
 * Two decisions, and they are the same decision. The letters are painted in the
 * blue, amber and purple the ports and cords on the canvas carry, so three
 * letters are a legend for the thing beside them rather than a code you have to
 * be told — you match the colour, and the letter is there for when you have.
 *
 * And **every row draws all six**. It used to draw only what a node had, which
 * meant `→ p` over `p n → c` over `c n → c`: six silhouettes down one column,
 * each a different width, and nothing lining up. A fixed grid scans as a table —
 * the `c` column either lights up or it does not, and you read down it.
 */
function Ports({ of }: { of: PortSet }) {
  const side = (held: readonly Signal[], which: 'takes' | 'gives') =>
    SIGNALS.map((signal) => (
      <span
        key={`${which}${signal}`}
        data-signal={signal}
        {...(held.includes(signal) ? { 'data-on': '' } : {})}
      >
        {signal}
      </span>
    ));
  return (
    <span
      className="node-sig"
      aria-label={`takes ${of.takes.join(' ') || 'nothing'}, gives ${of.gives.join(' ') || 'nothing'}`}
    >
      {side(of.takes, 'takes')}
      <i>→</i>
      {side(of.gives, 'gives')}
    </span>
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
  onWiden,
}: {
  entries: readonly Entry[];
  /** Which kinds are open, or null for "everything shown is open". */
  opened: readonly string[] | null;
  onOpen(kind: string): void;
  onAdd(pick: Pick): void;
  /** Clear whatever narrowed the list to nothing, when something did. */
  onWiden?: () => void;
}) {
  const families = [...new Set(entries.map((each) => each.node.family))];
  return (
    <div className="palette">
      {entries.length === 0 && <p className="cap flat">no node matches</p>}
      {entries.length === 0 && onWiden && (
        <button type="button" className="tick reset" onClick={onWiden}>
          show everything
        </button>
      )}
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
                    {entry.presets.length > 0 ? (
                      <button
                        type="button"
                        className="twist"
                        aria-expanded={on}
                        aria-label={`${on ? 'Hide' : 'Show'} the ${entry.presets.length} presets of ${entry.node.label}`}
                        title={`${entry.presets.length} presets`}
                        onClick={() => onOpen(entry.node.kind)}
                      >
                        {on ? '▾' : '▸'}
                      </button>
                    ) : (
                      <span className="twist" />
                    )}
                    <button
                      type="button"
                      className="node-pick"
                      data-kind={entry.node.kind}
                      title={entry.node.about}
                      onClick={() => onAdd(entry.node)}
                    >
                      <span className="node-label">{entry.node.label}</span>
                      <Ports of={entry.node.ports} />
                    </button>
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
