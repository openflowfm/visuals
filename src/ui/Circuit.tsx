import { useState, type ReactNode, type Ref } from 'react';
import type { Circuit, CircuitNode, FlowDef, MediaAsset, NodeKind } from '../../protocol.ts';
import {
  Graph,
  GraphNode,
  type GraphCord,
  type GraphView,
} from '@openflow/widgets/chrome/Graph.tsx';
import { Port } from '@openflow/widgets/chrome/Port.tsx';
import { Device, DevicePortRow } from '@openflow/widgets/chrome/Device.tsx';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { Select } from '@openflow/widgets/controls/Select.tsx';
import { Slider } from '@openflow/widgets/controls/Slider.tsx';
import {
  inletsOf,
  modesOf,
  NODE_SPECS,
  portId,
  reachesOut,
  signalOf,
  wouldFeedItself,
} from '../render/circuit.ts';
import { clearValue, connect, disconnect, dropNode, setDepth, setValue, setNode } from './edits.ts';
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
  flows = [],
  media = [],
  picture,
  energy = 0,
  beat = () => 0,
  numberReadings = {},
  onSwap,
  onEnter,
  viewRef,
}: {
  circuit: Circuit;
  onChange(next: Circuit): void;
  /**
   * Every name a `track` node may point at, which is **the set's** — the same
   * rule the rest of the editor keeps. A name you can typo is a flow that goes
   * quiet on the one night it mattered.
   */
  tracks?: readonly string[];
  /**
   * Every flow a `flow` node may point at, which is the library minus this one.
   *
   * Handed in rather than read, for the same reason the track names are: what a
   * node may name comes from something the canvas has no business knowing about.
   */
  flows?: readonly { id: string; def: FlowDef }[];
  /** Server-approved disk videos. The node stores the stable relative id. */
  media?: readonly MediaAsset[];
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
  /** Open the flow a `flow` node names, so the canvas is a way in as well as out. */
  onEnter?(flow: string): void;
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
    // a flow inside a flow gets. The compiler will say "blend feeds itself",
    // which is true and is about a node; this is about the cord in your hand,
    // and it happens before the whole flow goes black.
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
                flows={flows}
                media={media}
                picture={picture}
                energy={energy}
                beat={beat}
                numberReadings={numberReadings}
                onSwap={onSwap}
                onEnter={onEnter}
                onChange={(next) => onChange(setNode(circuit, node.id, next))}
                onTurn={(inlet, value) => onChange(setValue(circuit, node.id, inlet, value))}
                onRange={(inlet, depth) => onChange(setDepth(circuit, node.id, inlet, depth))}
                onFree={(inlet) => onChange(clearValue(circuit, node.id, inlet))}
                onCut={(inlet) => onChange(disconnect(circuit, inlet))}
                onDrop={() => onChange(dropNode(circuit, node.id))}
              />
            </GraphNode>
          ))}
        </Graph>
      </div>

      {/*
        A flow with nothing wired to `out` compiles, on purpose — it draws
        transparent black, which is the state every graph passes through on the
        way to being one. What it must not do is look identical to a flow that
        is broken. So the canvas says it, in the one place a canvas can say
        anything, and it is not an error: nothing is refused, nothing stops, and
        the moment a cord lands the line goes away.
      */}
      {!reachesOut(circuit) && (
        <p className="hits bad">
          nothing reaches out — this flow draws nothing until something does
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
  flows,
  media = [],
  picture,
  energy,
  beat,
  numberReadings = {},
  onSwap,
  onEnter,
  onChange,
  onTurn,
  onRange,
  onFree,
  onCut,
  onDrop,
}: {
  node: CircuitNode;
  circuit: Circuit;
  tracks: readonly string[];
  flows?: readonly { id: string; def: FlowDef }[];
  media?: readonly MediaAsset[];
  picture?: (nodeId: string) => ReactNode;
  energy: number;
  beat: () => number;
  numberReadings?: Readonly<Record<string, NumberReading>>;
  onSwap?(id: string, kind: NodeKind): void;
  onEnter?(flow: string): void;
  onChange(next: Partial<CircuitNode>): void;
  onTurn(inlet: string, value: number): void;
  onRange(inlet: string, depth: number): void;
  /** Take the held number off a live inlet, giving it its signal back. */
  onFree(inlet: string): void;
  onCut(inlet: string): void;
  onDrop(): void;
}) {
  const spec = NODE_SPECS[node.kind];
  const fed = new Set(circuit.cords.map((cord) => cord.to));
  const feeding = new Set(circuit.cords.map((cord) => cord.from));

  /**
   * The library, minus the flow being edited.
   *
   * Which is the one holding *this* graph — the canvas is handed a circuit
   * rather than an id, and the entry whose circuit is this one is the only
   * honest way to name it. It used to compare a flow id against a **node** id,
   * which are different things that occasionally spell the same: drop a flow
   * node on a canvas and it is called `look1`, and `look1` is also the first id
   * a hand-made flow gets. When they collided the list lost an entry while the
   * selected index was still counted against the full one, so the dropdown
   * named the wrong flow and picking one wired a different flow again.
   */
  const others = (flows ?? []).filter((each) => each.def.circuit !== circuit);
  const inlets = inletsOf(node).filter((port) => !port.name.startsWith('~'));
  const title = faceName(node, spec.name, flows);
  const previewed = previewOutletOf(circuit, node.id)?.name;
  const targets = tracks.length > 0 ? tracks : ['master'];
  const mediaIds = media.map((asset) => asset.id);
  const videoChoices =
    node.asset && !mediaIds.includes(node.asset) ? [node.asset, ...mediaIds] : mediaIds;
  const chooser =
    node.kind === 'flow' ? (
      <Select
        items={others.map((each) => each.def.name || each.id)}
        index={Math.max(
          0,
          others.findIndex((each) => each.id === node.op),
        )}
        onChange={(i) => onChange({ op: others[i]?.id })}
        label="Flow this draws"
      />
    ) : node.kind === 'track' ? (
      <Select
        items={targets}
        index={Math.max(0, targets.indexOf(node.of ?? 'master'))}
        onChange={(i) => onChange({ of: targets[i] })}
        label="Track this reads"
      />
    ) : node.kind === 'video' ? (
      videoChoices.length > 0 ? (
        <Select
          items={['choose video', ...videoChoices]}
          index={Math.max(0, videoChoices.indexOf(node.asset ?? '') + 1)}
          onChange={(i) => onChange({ asset: i > 0 ? videoChoices[i - 1] : undefined })}
          label="Video file"
        />
      ) : (
        <span className="node-empty">no videos</span>
      )
    ) : node.kind === 'value' ? (
      <input
        className="field node-name"
        value={node.label ?? ''}
        spellCheck={false}
        aria-label="Value name"
        onChange={(e) => onChange({ label: e.target.value })}
      />
    ) : undefined;

  /**
   * The one line a kind draws for itself, belonging to no port.
   *
   * A `track`'s smoothing and a `value`'s amount. Both are numbers the node
   * holds rather than reads, so they take a line like an inlet does and no
   * port sits beside them.
   */
  const ownRow =
    node.kind === 'track'
      ? {
          key: 'smooth',
          wide: true,
          inlet: undefined,
          control: (
            <Slider
              param={VALUE}
              value={PERCENT.to(node.smooth ?? 0)}
              onChange={(v) => onChange({ smooth: PERCENT.from(v) })}
              name="smooth"
              orientation="horizontal"
              layout="inside"
            />
          ),
        }
      : node.kind === 'value'
        ? {
            key: 'amount',
            wide: true,
            inlet: undefined,
            control: (
              <Slider
                param={VALUE}
                value={PERCENT.to(node.value ?? 0.5)}
                onChange={(v) => onChange({ value: PERCENT.from(v) })}
                name="value"
                orientation="horizontal"
                layout="inside"
              />
            ),
          }
        : null;

  /**
   * The kind, and for a flow the mark that says it is one.
   *
   * `◈` follows a flow everywhere it appears — this face, its row in the
   * browser — because the thing a person has to be able to tell at a glance is
   * *composite or primitive*, and a mark that only shows in one of the two
   * places it matters is a mark you never learn. It is Figma's rule about an
   * instance badge, and it is the answer to a `flow` node having been
   * indistinguishable from a `source` in the drawer it used to share.
   */
  const kindLabel =
    node.kind === 'flow' ? (
      <span className="node-kind is-flow">◈ flow</span>
    ) : title === spec.name ? null : (
      <span className="node-kind">{spec.name}</span>
    );

  /**
   * The way *in*, which the canvas has never had.
   *
   * A flow node names a graph and the only way to open that graph was to find
   * its name again in the sidebar — so the containment the model is built on
   * was invisible on the one screen that draws it. Every node editor with
   * groups has this gesture (Blender's `Tab`, Nuke's ctrl-enter) and it is
   * always on the node rather than in a menu, because the node is where you are
   * when you want it.
   */
  const enterButton =
    node.kind === 'flow' && node.op && onEnter ? (
      <Button
        tone="quiet"
        className="enter"
        label={`Open ${title}`}
        title={`Open ${title} — the flow this node draws`}
        onPress={() => onEnter(node.op!)}
      >
        ⤢
      </Button>
    ) : null;
  const deleteButton =
    // No delete on `out`. Every flow has exactly one and it is what leaves;
    // the model refuses the deletion too, but the face should not offer it.
    node.kind === 'out' ? null : (
      <Button tone="quiet" label={`Delete ${spec.name}`} onPress={onDrop}>
        ×
      </Button>
    );

  /** One line per inlet: the port on its own edge, and what it puts on the row. */
  const inletCells = inlets.map((port) => {
    const id = portId(node.id, port.name);
    const driver = driverOf(circuit, id, flows);
    const reading = numberReadings[id];
    const held = node.values?.[port.name];
    // A live inlet has no `at`: left alone it reads a signal, not a setting.
    const alive = port.kind === 'n' && port.at === undefined;
    // Nothing wired, nothing held — the row is showing that signal move.
    const running = alive && held === undefined && driver === undefined;
    const number =
      port.kind !== 'n' ? null : (
        <Slider
          param={VALUE}
          // The number this inlet holds, wired or not. It used to show the
          // live reading under a cord and go dead, on the argument that the
          // number underneath was dormant and showing it would be a lie. A
          // cord carries the inlet *from* this number now rather than
          // replacing it, so it is not dormant, and the row is the only place
          // the range can be set — the reading moved to the readout, where a
          // number that is not yours to drag belongs.
          //
          // A live inlet holds no number until somebody sets one, so its row
          // shows the signal itself — and a drag catches that signal wherever
          // it was and holds it there, which is the gesture the moving fill
          // was always offering.
          value={PERCENT.to(
            held ??
              port.at ??
              (driver === undefined
                ? (reading?.value ??
                  (port.name === 'energy' || port.fallbackInlet === 'energy' ? energy : beat()))
                : 0),
          )}
          onChange={(v) => onTurn(port.name, PERCENT.from(v))}
          depth={driver === undefined ? undefined : (node.depths?.[port.name] ?? 1)}
          onDepth={driver === undefined ? undefined : (d: number) => onRange(port.name, d)}
          live={driver === undefined ? undefined : reading?.value}
          name={port.name}
          orientation="horizontal"
          layout="inside"
          // The number, never the name of what is driving it. The name used
          // to go here and there is no room for one: `pulse · 73 %` in a
          // 140px row ellipsised to `pulse…`, which cost the reading to say
          // something the cord on the canvas already says. It is the title
          // now, and what a cord is *doing* — the only thing nothing else
          // shows — has the readout to itself.
          display={driver === undefined ? undefined : (reading?.display ?? '—')}
          title={
            driver !== undefined
              ? `${port.description} — ${port.name} ← ${driver}`
              : running
                ? `${port.description} — live; drag to hold it at a number`
                : alive
                  ? `${port.description} — held; double-click to let it run live again`
                  : port.description
          }
        />
      );
    return {
      key: id,
      // `wide` is a number's claim on the whole line. A bare name shares it
      // with an outlet on the far side; a fader cannot, and a name squeezed
      // against a moving reading is worse than a coloured dot with a tooltip.
      wide: port.kind === 'n',
      inlet: (
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
          {!fed.has(id) && alive && held !== undefined && (
            <Button
              tone="quiet"
              className="cut"
              label={`Let ${port.name} run live`}
              onPress={() => onFree(port.name)}
            >
              ∿
            </Button>
          )}
        </span>
      ),
      control:
        port.kind !== 'n' ? (
          <span className="node-inlet-name" title={port.description}>
            {port.name}
          </span>
        ) : alive ? (
          <span
            className="alive-row"
            {...(running ? { 'data-running': '' } : {})}
            // Double-click frees a live inlet rather than resetting it: the
            // default here is the signal, not a number, and the fader's own
            // return-to-default would hold the row at fifty.
            onDoubleClickCapture={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onFree(port.name);
            }}
          >
            {number}
          </span>
        ) : (
          number
        ),
    };
  });

  const outletCells = spec.outlets.map((port) => {
    const id = portId(node.id, port.name);
    const picked = previewed === port.name;
    return {
      key: id,
      outlet: (
        <Port
          id={id}
          side="out"
          label={port.name}
          showLabel={false}
          kind={port.kind}
          connected={feeding.has(id)}
        />
      ),
      // A button only where there is a choice to make: with one outlet there is
      // nothing to pick and a chip that cannot be pressed is a lie.
      name:
        spec.outlets.length > 1 ? (
          <button
            type="button"
            className="node-outlet-preview"
            aria-pressed={picked}
            {...(picked ? { 'data-on': '' } : {})}
            title={`Show ${port.name} in this node's picture — ${port.description}`}
            onClick={() => onChange({ previewOutlet: port.name })}
          >
            {port.name}
          </button>
        ) : (
          <span className="node-outlet-name" title={port.description}>
            {port.name}
          </span>
        ),
    };
  });

  /**
   * The face's lines, with an inlet and an outlet sharing each one.
   *
   * Outlets used to have a band of their own above the inlets, which spends a
   * row of a small node on one port and leaves the other end of that row empty.
   * A port belongs to its own edge, and a row is a line across the face — so a
   * node with six inlets and two outlets is six lines, not eight.
   */
  const lines = [...inletCells, ...(ownRow ? [ownRow] : [])];
  const paired = Array.from(
    { length: Math.max(lines.length, outletCells.length) },
    (_unused, at) => {
      const left = lines[at];
      const right = outletCells[at];
      return {
        key: left?.key ?? right?.key ?? `line${at}`,
        inlet: left?.inlet,
        outlet: right?.outlet,
        control: (
          <>
            {left?.control}
            {right !== undefined && left?.wide !== true && right.name}
          </>
        ),
      };
    },
  );

  const held = rowsHeldOpen(node);

  return (
    <Device
      name={title}
      className={`node node-${node.kind}`}
      vars={{ '--wdg-device-port-rows': held.ports }}
      title={spec.description}
      screen={picture?.(node.id)}
      chooser={chooser}
      onHotSwap={spec.modes && onSwap ? () => onSwap(node.id, node.kind) : undefined}
      headerEnd={
        kindLabel || enterButton || deleteButton ? (
          <>
            {kindLabel}
            {enterButton}
            {deleteButton}
          </>
        ) : undefined
      }
      portRows={paired.map((row) => (
        <DevicePortRow key={row.key} inlet={row.inlet} outlet={row.outlet}>
          {row.control}
        </DevicePortRow>
      ))}
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
/**
 * How many rows a face of this kind holds open, whatever mode it is in.
 *
 * The **kind's** maximum across its own modes, not one number for the whole
 * canvas. Reserving the tallest node's shape on every node was the first
 * attempt at stopping the reflow, and it makes a `point` — no inlets, one
 * outlet — exactly as tall as a `ripple` with six, so most of the canvas is
 * empty frame. Per kind still stops the reflow that matters, because a mode
 * change is the only thing that alters a node's rows without a person moving
 * something.
 *
 * `track` and `value` carry one row of their own that is nobody's inlet: a
 * smoothing and an amount. They are counted here because the face draws them.
 */
export function rowsHeldOpen(node: CircuitNode): { ports: number } {
  const spec = NODE_SPECS[node.kind];
  const own = node.kind === 'track' || node.kind === 'value' ? 1 : 0;
  const modes = modesOf(node.kind);
  const widest = (modes.length > 0 ? modes : [node.op]).reduce((most, op) => {
    const named = inletsOf({ ...node, op }).filter((port) => !port.name.startsWith('~'));
    return Math.max(most, named.length);
  }, 0);
  // Outlets share these lines rather than sitting above them, so a node with
  // more outlets than inlets — `polar` has one of each way round — is still as
  // tall as its longer side.
  return { ports: Math.max(widest + own, spec.outlets.length) };
}

export function driverOf(
  circuit: Circuit,
  id: string,
  flows?: readonly { id: string; def: FlowDef }[],
): string | undefined {
  const from = circuit.cords.find((cord) => cord.to === id)?.from;
  if (from === undefined) return undefined;
  const cut = from.lastIndexOf('/');
  const outlet = from.slice(cut + 1);
  const source = circuit.nodes.find((each) => each.id === from.slice(0, cut));
  if (!source) return outlet;
  const spec = NODE_SPECS[source.kind];
  const named = faceName(source, spec.name, flows);
  return spec.outlets.length > 1 ? `${named}·${outlet}` : named;
}

function faceName(
  node: CircuitNode,
  fallback: string,
  flows?: readonly { id: string; def: FlowDef }[],
): string {
  if (node.kind === 'value') return node.label || 'value';
  if (node.kind === 'flow') return flows?.find((each) => each.id === node.op)?.def.name ?? 'flow';
  const modes = modesOf(node.kind);
  if (modes.length > 0) return node.op || modes[0] || fallback;
  return fallback;
}
