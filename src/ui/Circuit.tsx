import { useState, type ReactNode, type Ref } from 'react';
import type { Circuit, CircuitNode, LookDef, NodeKind } from '../../protocol.ts';
import {
  Graph,
  GraphNode,
  type GraphCord,
  type GraphView,
} from '../../../widgets/src/chrome/Graph.tsx';
import { Port } from '../../../widgets/src/chrome/Port.tsx';
import { Device, DevicePortRow } from '../../../widgets/src/chrome/Device.tsx';
import { Button } from '../../../widgets/src/controls/Button.tsx';
import { Meter } from '../../../widgets/src/controls/Meter.tsx';
import { Select } from '../../../widgets/src/controls/Select.tsx';
import { Slider } from '../../../widgets/src/controls/Slider.tsx';
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
import { previewOutletOf } from './probe.ts';

export interface NumberReading {
  /** The display-clock value, 0–1, or absent when the source is per-fragment. */
  value?: number;
  /** The already-formatted value; changes less often than the renderer's signal. */
  display?: string;
}

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
  energy = 0,
  beat = () => 0,
  numberReadings = {},
  onSwap,
  viewRef,
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
  /** The room's current energy, for an unwired alive inlet. */
  energy?: number;
  /** The designer's running beat, for a wave's unwired phase. */
  beat?: () => number;
  /** Values latched by the host's display clock, by inlet port id. */
  numberReadings?: Readonly<Record<string, NumberReading>>;
  /** Open this node's kind in the host's mode browser. */
  onSwap?(id: string, kind: NodeKind): void;
  /** Publish a stable read-only view without lifting wheel zoom into state. */
  viewRef?: Ref<GraphView>;
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
          viewRef={viewRef}
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
                energy={energy}
                beat={beat}
                numberReadings={numberReadings}
                onSwap={onSwap}
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
export function NodeFace({
  node,
  circuit,
  tracks,
  looks,
  picture,
  energy,
  beat,
  numberReadings = {},
  onSwap,
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
  energy: number;
  beat: () => number;
  numberReadings?: Readonly<Record<string, NumberReading>>;
  onSwap?(id: string, kind: NodeKind): void;
  onChange(next: Partial<CircuitNode>): void;
  onTurn(inlet: string, value: number): void;
  onCut(inlet: string): void;
  onDrop(): void;
}) {
  const spec = NODE_SPECS[node.kind];
  const fed = new Set(circuit.cords.map((cord) => cord.to));
  const feeding = new Set(circuit.cords.map((cord) => cord.from));

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
  const inlets = inletsOf(node).filter((port) => !port.name.startsWith('~'));
  const title = faceName(node, spec.name, looks);
  const previewed = previewOutletOf(circuit, node.id)?.name;
  const targets = tracks.length > 0 ? tracks : ['master'];
  const chooser =
    node.kind === 'look' ? (
      <Select
        items={others.map((each) => each.def.name || each.id)}
        index={Math.max(
          0,
          others.findIndex((each) => each.id === node.op),
        )}
        onChange={(i) => onChange({ op: others[i]?.id })}
        label="Look this draws"
      />
    ) : node.kind === 'track' ? (
      <Select
        items={targets}
        index={Math.max(0, targets.indexOf(node.of ?? 'master'))}
        onChange={(i) => onChange({ of: targets[i] })}
        label="Track this reads"
      />
    ) : node.kind === 'value' ? (
      <input
        className="field node-name"
        value={node.label ?? ''}
        spellCheck={false}
        aria-label="Value name"
        onChange={(e) => onChange({ label: e.target.value })}
      />
    ) : undefined;

  const ownRows =
    node.kind === 'track' ? (
      <DevicePortRow>
        <Slider
          param={VALUE}
          value={PERCENT.to(node.smooth ?? 0)}
          onChange={(v) => onChange({ smooth: PERCENT.from(v) })}
          name="smooth"
          orientation="horizontal"
          layout="inside"
        />
      </DevicePortRow>
    ) : node.kind === 'value' ? (
      <DevicePortRow>
        <Slider
          param={VALUE}
          value={PERCENT.to(node.value ?? 0.5)}
          onChange={(v) => onChange({ value: PERCENT.from(v) })}
          name="value"
          orientation="horizontal"
          layout="inside"
        />
      </DevicePortRow>
    ) : null;

  const kindLabel = title === spec.name ? null : <span className="node-kind">{spec.name}</span>;
  const deleteButton =
    // No delete on `out`. Every look has exactly one and it is what leaves;
    // the model refuses the deletion too, but the face should not offer it.
    node.kind === 'out' ? null : (
      <Button tone="quiet" label={`Delete ${spec.name}`} onPress={onDrop}>
        ×
      </Button>
    );

  return (
    <Device
      name={title}
      className={`node node-${node.kind}`}
      title={spec.about}
      overlay={picture?.(node.id)}
      chooser={chooser}
      onHotSwap={spec.ops && onSwap ? () => onSwap(node.id, node.kind) : undefined}
      headerEnd={
        kindLabel || deleteButton ? (
          <>
            {kindLabel}
            {deleteButton}
          </>
        ) : undefined
      }
      outlets={spec.outlets.map((port) => {
        const id = portId(node.id, port.name);
        if (spec.outlets.length > 1) {
          return (
            <span
              key={id}
              className="node-outlet-choice"
              {...(previewed === port.name ? { 'data-on': '' } : {})}
            >
              <button
                type="button"
                className="node-outlet-preview"
                aria-pressed={previewed === port.name}
                title={`Show ${port.name} in this node's picture`}
                onClick={() => onChange({ previewOutlet: port.name })}
              >
                {port.name}
              </button>
              <Port
                id={id}
                side="out"
                label={port.name}
                showLabel={false}
                kind={port.kind}
                connected={feeding.has(id)}
              />
            </span>
          );
        }
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
      portRows={
        <>
          {inlets.map((port) => {
            const id = portId(node.id, port.name);
            const driver = driverOf(circuit, id, looks);
            const reading = numberReadings[id];
            return (
              <DevicePortRow
                key={id}
                inlet={
                  <span className="wire">
                    <Port
                      id={id}
                      side="in"
                      label={port.name}
                      showLabel={false}
                      kind={port.kind}
                      connected={fed.has(id)}
                    />
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
                }
              >
                {port.kind !== 'n' ? (
                  <span className="node-inlet-name">{port.name}</span>
                ) : port.at === undefined ? (
                  <AliveMeter
                    name={port.name}
                    fallback={port.name === 'energy' ? energy : beat()}
                    reading={reading}
                    driver={driver}
                  />
                ) : (
                  <Slider
                    param={VALUE}
                    value={PERCENT.to(
                      driver !== undefined && reading?.value !== undefined
                        ? reading.value
                        : (node.values?.[port.name] ?? port.at),
                    )}
                    onChange={(v) => onTurn(port.name, PERCENT.from(v))}
                    name={port.name}
                    orientation="horizontal"
                    layout="inside"
                    disabled={driver !== undefined}
                    display={
                      driver === undefined
                        ? undefined
                        : reading?.display
                          ? `${driver} · ${reading.display}`
                          : driver
                    }
                    className={
                      driver !== undefined && reading?.value === undefined
                        ? 'node-number-unreadable'
                        : undefined
                    }
                  />
                )}
              </DevicePortRow>
            );
          })}
          {ownRows}
        </>
      }
    />
  );
}

function AliveMeter({
  name,
  fallback,
  reading,
  driver,
}: {
  name: string;
  fallback: number;
  reading?: NumberReading;
  driver?: string;
}) {
  const value = reading?.value ?? fallback;
  return (
    <Meter
      value={value}
      name={name}
      layout="inside"
      showValue
      display={
        driver
          ? reading?.display
            ? `${driver} · ${reading.display}`
            : driver
          : reading?.display
      }
      className={driver && reading?.value === undefined ? 'node-number-unreadable' : undefined}
    />
  );
}

/**
 * What a node is called on its faceplate.
 *
 * The **mode**, not the kind, whenever a node has one — a node showing `source`
 * while it draws `plasma` makes you read two things to learn one. The kind sits
 * beside it in smaller type, so fixed-mode nodes can all follow the same rule.
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
  const modes = NODE_SPECS[node.kind].ops;
  if (modes) return node.op || modes[0] || fallback;
  return fallback;
}
