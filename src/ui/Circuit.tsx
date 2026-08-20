import { useState, type ReactNode } from 'react';
import type { Circuit, CircuitNode, NodeKind } from '../../protocol.ts';
import { Graph, GraphNode, type GraphCord } from '../../../widgets/src/chrome/Graph.tsx';
import { Port } from '../../../widgets/src/chrome/Port.tsx';
import { Device } from '../../../widgets/src/chrome/Device.tsx';
import { Button } from '../../../widgets/src/controls/Button.tsx';
import { Knob } from '../../../widgets/src/controls/Knob.tsx';
import { Select } from '../../../widgets/src/controls/Select.tsx';
import { NODE_SPECS, portId, signalOf } from '../render/circuit.ts';
import { connect, disconnect, dropNode, freeNodeId, setNode } from './edits.ts';
import { KNOB, PERCENT } from './param.ts';

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
  /** A small picture of what a node has made, when the host can draw one. */
  picture?: (nodeId: string) => ReactNode;
}) {
  const [adding, setAdding] = useState(0);
  const [refused, setRefused] = useState<string | null>(null);

  const kinds = (Object.keys(NODE_SPECS) as NodeKind[]).filter(
    (kind) => kind !== 'out' || !circuit.nodes.some((n) => n.kind === 'out'),
  );

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
    setRefused(null);
    onChange(connect(circuit, from, to));
  };

  const add = () => {
    const kind = kinds[adding];
    if (!kind) return;
    const at = circuit.nodes.length;
    onChange({
      ...circuit,
      nodes: [
        ...circuit.nodes,
        {
          id: freeNodeId(circuit, kind),
          kind,
          // Somewhere free-ish rather than somewhere clever. Every node drags,
          // and a layout algorithm would fight whatever you did by hand.
          x: 40 + (at % 4) * 180,
          y: 30 + Math.floor(at / 4) * 130,
          ...(kind === 'value' ? { value: 0.5, label: 'knob' } : {}),
        },
      ],
    });
  };

  return (
    <div className="circuit">
      <div className="line">
        <Select
          items={kinds}
          index={Math.min(adding, kinds.length - 1)}
          onChange={setAdding}
          label="Node to add"
          width={96}
        />
        <Button onPress={add}>+ node</Button>
        <span className="about">{NODE_SPECS[kinds[adding]]?.about}</span>
      </div>

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
                picture={picture}
                onChange={(next) => onChange(setNode(circuit, node.id, next))}
                onCut={(inlet) => onChange(disconnect(circuit, inlet))}
                onDrop={() => onChange(dropNode(circuit, node.id))}
              />
            </GraphNode>
          ))}
        </Graph>
      </div>

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
  picture,
  onChange,
  onCut,
  onDrop,
}: {
  node: CircuitNode;
  circuit: Circuit;
  tracks: readonly string[];
  picture?: (nodeId: string) => ReactNode;
  onChange(next: Partial<CircuitNode>): void;
  onCut(inlet: string): void;
  onDrop(): void;
}) {
  const spec = NODE_SPECS[node.kind];
  const fed = new Set(circuit.cords.map((cord) => cord.to));
  const feeding = new Set(circuit.cords.map((cord) => cord.from));

  return (
    <Device
      name={node.kind === 'value' ? node.label || 'value' : spec.name}
      className={`node node-${node.kind}`}
      title={spec.about}
      headerEnd={
        node.kind === 'out' ? undefined : (
          <Button tone="quiet" label={`Delete ${spec.name}`} onPress={onDrop}>
            ×
          </Button>
        )
      }
      inlets={spec.inlets.map((port) => {
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
      {node.kind === 'track' ? (
        <Select
          items={tracks.length > 0 ? tracks : ['no tracks']}
          index={Math.max(0, tracks.indexOf(node.op ?? ''))}
          onChange={(i) => onChange({ op: tracks[i] })}
          label="Track this reads"
          width={104}
        />
      ) : node.kind === 'value' ? (
        <div className="knobface">
          <Knob
            param={KNOB}
            value={PERCENT.to(node.value ?? 0.5)}
            onChange={(v) => onChange({ value: PERCENT.from(v) })}
            // The node's own title bar already carries the name, and a caption
            // reading "Knob" above every one of them is the sort of label that
            // makes a canvas harder to read rather than easier.
            name=""
          />
          <input
            className="field"
            value={node.label ?? ''}
            spellCheck={false}
            aria-label="Knob name"
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
    </Device>
  );
}
