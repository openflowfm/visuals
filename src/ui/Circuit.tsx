import { useState, type ReactNode } from 'react';
import { TRACK_READS, type Circuit, type CircuitNode, type LookDef } from '../../protocol.ts';
import { Graph, GraphNode, type GraphCord } from '../../../widgets/src/chrome/Graph.tsx';
import { Port } from '../../../widgets/src/chrome/Port.tsx';
import { Device } from '../../../widgets/src/chrome/Device.tsx';
import { Button } from '../../../widgets/src/controls/Button.tsx';
import { Knob } from '../../../widgets/src/controls/Knob.tsx';
import { Select } from '../../../widgets/src/controls/Select.tsx';
import {
  inletsOf,
  NODE_SPECS,
  portId,
  reachesOut,
  signalOf,
  wouldFeedItself,
} from '../render/circuit.ts';
import { connect, disconnect, dropNode, setValue, setNode } from './edits.ts';
import { VALUE, PERCENT } from './param.ts';

/**
 * An effect, wired.
 *
 * The first host of [`widgets`' `Graph`](../../../widgets/docs/graph.md), and
 * the thing that module was built without knowing about. Everything about a
 * circuit that is *this app's* — what a port carries, which cords are legal,
 * where a node may go — lives here; the canvas contributes pan, zoom, dragging
 * and the drawing, and still has no idea what any of it means. The one rule it
 * enforces is that an outlet reaches an inlet, because that one is the
 * drawing's own.
 *
 * **Type checking is the host's**, and it is done by refusing rather than by
 * converting. A point is not a number and joining them would need a rule about
 * which of its two halves you meant; saying so out loud is shorter than any
 * answer to that.
 */
export function CircuitEditor({
  circuit,
  onChange,
  tracks = [],
  looks = [],
  picture,
}: {
  circuit: Circuit;
  onChange(next: Circuit): void;
  /**
   * Every name a `track` node may point at, which is **the set's** — the same
   * rule the rest of the editor keeps. A name you can typo is a look that goes
   * quiet on the one night it mattered.
   */
  tracks?: readonly string[];
  /**
   * Every look a `look` node may point at, which is the library minus this one.
   *
   * Handed in rather than read, for the same reason the track names are: what a
   * node may name comes from something the canvas has no business knowing about.
   */
  looks?: readonly { id: string; def: LookDef }[];
  /** A small picture of what a node has made, when the host can draw one. */
  picture?: (nodeId: string) => ReactNode;
}) {
  const [refused, setRefused] = useState<string | null>(null);

  const cords: GraphCord[] = circuit.cords.map((cord) => ({
    from: cord.from,
    to: cord.to,
    kind: signalOf(circuit, cord.from) ?? undefined,
  }));

  const wire = (from: string, to: string) => {
    const out = signalOf(circuit, from);
    const into = signalOf(circuit, to);
    if (!out || !into) return;
    if (out !== into) {
      setRefused(`a ${LONG[out]} does not go into a ${LONG[into]}`);
      return;
    }
    // Refused where it is dropped rather than where it fails, the same bargain
    // a look inside a look gets. The compiler will say "blend feeds itself",
    // which is true and is about a node; this is about the cord in your hand,
    // and it happens before the whole look goes black.
    if (wouldFeedItself(circuit, from, to)) {
      setRefused('that would feed this back into itself');
      return;
    }
    setRefused(null);
    onChange(connect(circuit, from, to));
  };

  return (
    <div className="circuit">
      <div className="canvas">
        <Graph
          cords={cords}
          onConnect={wire}
          onMove={(id, x, y) =>
            onChange(setNode(circuit, id, { x: Math.round(x), y: Math.round(y) }))
          }
        >
          {circuit.nodes.map((node) => (
            <GraphNode key={node.id} id={node.id} x={node.x} y={node.y}>
              <NodeFace
                node={node}
                circuit={circuit}
                tracks={tracks}
                looks={looks}
                picture={picture}
                onChange={(next) => onChange(setNode(circuit, node.id, next))}
                onTurn={(inlet, value) => onChange(setValue(circuit, node.id, inlet, value))}
                onCut={(inlet) => onChange(disconnect(circuit, inlet))}
                onDrop={() => onChange(dropNode(circuit, node.id))}
              />
            </GraphNode>
          ))}
        </Graph>
      </div>

      {/*
        A look with nothing wired to `out` compiles, on purpose — it draws
        transparent black, which is the state every graph passes through on the
        way to being one. What it must not do is look identical to a look that
        is broken. So the canvas says it, in the one place a canvas can say
        anything, and it is not an error: nothing is refused, nothing stops, and
        the moment a cord lands the line goes away.
      */}
      {!reachesOut(circuit) && (
        <p className="hits bad">
          nothing reaches out — this look draws nothing until something does
        </p>
      )}
      {refused && <p className="hits bad">{refused}</p>}
    </div>
  );
}

const LONG: Record<string, string> = { p: 'point', n: 'number', c: 'colour' };

/**
 * One node's faceplate.
 *
 * A `Device`, exactly as a device chain draws one — which is the whole reason
 * `Graph` takes children rather than a list of nodes. Its ports hang off the
 * device rather than off whatever positions it, so the same face would work
 * inside a rack.
 */
function NodeFace({
  node,
  circuit,
  tracks,
  looks,
  picture,
  onChange,
  onTurn,
  onCut,
  onDrop,
}: {
  node: CircuitNode;
  circuit: Circuit;
  tracks: readonly string[];
  looks?: readonly { id: string; def: LookDef }[];
  picture?: (nodeId: string) => ReactNode;
  onChange(next: Partial<CircuitNode>): void;
  onTurn(inlet: string, value: number): void;
  onCut(inlet: string): void;
  onDrop(): void;
}) {
  const spec = NODE_SPECS[node.kind];
  const fed = new Set(circuit.cords.map((cord) => cord.to));
  const feeding = new Set(circuit.cords.map((cord) => cord.from));

  /**
   * The inlets with a control on the face: every settable one, wired or not.
   *
   * **A wired inlet keeps its control.** Dropping it was the obvious reading of
   * "a cord already answers the inlet", and it cost more than it saved. The
   * face lost a whole row the moment a cord landed and the rail gained a cut
   * button in the same beat, so the node changed size in two directions at
   * once and every cord touching it moved. Worse, the one inlet whose number
   * was actually alive became the one inlet you could not see.
   *
   * A driven control is disabled and reads out **what is driving it** rather
   * than the number underneath — which says *this is not yours to turn*
   * without pretending the inlet has gone. Showing the stale number instead is
   * the near miss: a control that looks readable but is not is worse than one
   * that is plainly inert.
   *
   * The stored number is untouched either way, so a cord is still not a
   * destructive gesture: unwire it and the control is live again where it was.
   */
  const turnable = inletsOf(node).filter((port) => port.at !== undefined);


  /**
   * The library, minus the look being edited.
   *
   * Which is the one holding *this* graph — the canvas is handed a circuit
   * rather than an id, and the entry whose circuit is this one is the only
   * honest way to name it. It used to compare a look id against a **node** id,
   * which are different things that occasionally spell the same: drop a look
   * node on a canvas and it is called `look1`, and `look1` is also the first id
   * a hand-made look gets. When they collided the list lost an entry while the
   * selected index was still counted against the full one, so the dropdown
   * named the wrong look and picking one wired a different look again.
   */
  const others = (looks ?? []).filter((each) => each.def.circuit !== circuit);

  return (
    <Device
      name={faceName(node, spec.name, looks)}
      className={`node node-${node.kind}`}
      title={spec.about}
      headerEnd={
        // No delete on `out`. Every look has exactly one and it is what leaves;
        // a look without one does not draw a smaller picture, it refuses. The
        // model refuses the deletion too — this is the half that stops anyone
        // reaching for it, rather than the half that catches them.
        node.kind === 'out' ? undefined : (
          <Button tone="quiet" label={`Delete ${spec.name}`} onPress={onDrop}>
            ×
          </Button>
        )
      }
      // A tilde is the flattener's, not a person's: `look` carries one for the
      // graph it names, which nobody wires and nobody should see a port for.
      inlets={inletsOf(node)
        .filter((port) => !port.name.startsWith('~'))
        .map((port) => {
          const id = portId(node.id, port.name);
          return (
            <span key={id} className="wire">
              <Port id={id} side="in" label={port.name} kind={port.kind} connected={fed.has(id)} />
              {fed.has(id) && (
                <Button
                  tone="quiet"
                  className="cut"
                  label={`Unwire ${port.name}`}
                  onPress={() => onCut(id)}
                >
                  ×
                </Button>
              )}
            </span>
          );
        })}
      outlets={spec.outlets.map((port) => {
        const id = portId(node.id, port.name);
        return (
          <Port
            key={id}
            id={id}
            side="out"
            label={port.name}
            kind={port.kind}
            connected={feeding.has(id)}
          />
        );
      })}
    >
      {picture?.(node.id)}
      {node.kind === 'look' ? (
        <Select
          items={others.map((each) => each.def.name || each.id)}
          index={Math.max(
            0,
            others.findIndex((each) => each.id === node.op),
          )}
          onChange={(i) => onChange({ op: others[i]?.id })}
          label="Look this draws"
          width={120}
        />
      ) : node.kind === 'track' ? (
        // Two pickers and a control, because a track node answers two questions
        // and neither is the other's mode: **which** track, out of a list only
        // this set has, and **which of its numbers**, out of a list this
        // codebase writes down. The control is how much envelope to put on
        // whichever — at zero it is the number itself, which is what folded the
        // old `energy` node in here.
        <div className="valueface">
          <div className="stack">
            <Select
              items={tracks.length > 0 ? tracks : ['master']}
              index={Math.max(0, tracks.indexOf(node.of ?? 'master'))}
              onChange={(i) => onChange({ of: tracks[i] })}
              label="Track this reads"
              width={100}
            />
            <Select
              items={TRACK_READS}
              index={Math.max(0, TRACK_READS.indexOf(node.op ?? TRACK_READS[0]))}
              onChange={(i) => onChange({ op: TRACK_READS[i] })}
              label="Which of its numbers"
              width={100}
            />
          </div>
          <Knob
            param={VALUE}
            value={PERCENT.to(node.smooth ?? 0)}
            onChange={(v) => onChange({ smooth: PERCENT.from(v) })}
            name="smooth"
          />
        </div>
      ) : node.kind === 'value' ? (
        <div className="valueface">
          <Knob
            param={VALUE}
            value={PERCENT.to(node.value ?? 0.5)}
            onChange={(v) => onChange({ value: PERCENT.from(v) })}
            // The node's own title bar already carries the name, and a caption
            // reading "Value" above every one of them is the sort of label that
            // makes a canvas harder to read rather than easier.
            name=""
          />
          <input
            className="field"
            value={node.label ?? ''}
            spellCheck={false}
            aria-label="Value name"
            onChange={(e) => onChange({ label: e.target.value })}
          />
        </div>
      ) : spec.ops ? (
        <Select
          items={spec.ops}
          index={Math.max(0, spec.ops.indexOf(node.op ?? spec.ops[0]))}
          onChange={(i) => onChange({ op: spec.ops![i] })}
          label={`${spec.name} mode`}
        />
      ) : null}

      {turnable.length > 0 && (
        <div className="values">
          {turnable.map((port) => {
            const driver = driverOf(circuit, portId(node.id, port.name), looks);
            return (
              <Knob
                key={port.name}
                param={VALUE}
                value={PERCENT.to(node.values?.[port.name] ?? port.at!)}
                onChange={(v) => onTurn(port.name, PERCENT.from(v))}
                name={port.name}
                disabled={driver !== undefined}
                display={driver}
              />
            );
          })}
        </div>
      )}
    </Device>
  );
}

/**
 * What a node is called on its faceplate.
 *
 * The **mode**, not the kind, whenever a node has one — a node showing `source`
 * with a dropdown reading `plasma` makes you read two things to learn one, and
 * the browser you dropped it from called it `plasma`. A faceplate that disagrees
 * with the drawer it came out of is a faceplate you stop trusting.
 */
/**
 * What is driving an inlet, named the way that node's own faceplate is.
 *
 * A driven control reads this out in place of its number, so the name has to be
 * the one on the source's own title bar — a face saying it is driven by
 * `plasma` when the node upstream is titled `plasma` is a sentence; one saying
 * `source1` is a lookup.
 *
 * The outlet too, but only when the source has more than one — `polar` and
 * `lens` are the only nodes where *which* port a cord left by is a real
 * question, and printing one on everything else is noise on a face that has no
 * room for it.
 *
 * Split on the **last** slash, because a port address is `nodeId/port` and the
 * flattener's ids carry slashes of their own.
 */
export function driverOf(
  circuit: Circuit,
  id: string,
  looks?: readonly { id: string; def: LookDef }[],
): string | undefined {
  const from = circuit.cords.find((cord) => cord.to === id)?.from;
  if (from === undefined) return undefined;
  const cut = from.lastIndexOf('/');
  const outlet = from.slice(cut + 1);
  const source = circuit.nodes.find((each) => each.id === from.slice(0, cut));
  if (!source) return outlet;
  const spec = NODE_SPECS[source.kind];
  const named = faceName(source, spec.name, looks);
  return spec.outlets.length > 1 ? `${named}·${outlet}` : named;
}

function faceName(
  node: CircuitNode,
  fallback: string,
  looks?: readonly { id: string; def: LookDef }[],
): string {
  if (node.kind === 'value') return node.label || 'value';
  if (node.kind === 'look') return looks?.find((each) => each.id === node.op)?.def.name ?? 'look';
  // The track's name and not the reading, because the name is the part nobody
  // could guess from the canvas and the reading is on a dropdown an inch below.
  if (node.kind === 'track') return node.of || 'track';
  if (node.kind === 'tracks') return 'the set';
  if (
    node.kind === 'source' ||
    node.kind === 'lens' ||
    node.kind === 'grade' ||
    node.kind === 'spread' ||
    node.kind === 'playback'
  ) {
    return node.op || fallback;
  }
  if (node.kind === 'song') return `song ${node.op ?? 'seed'}`;
  return fallback;
}
