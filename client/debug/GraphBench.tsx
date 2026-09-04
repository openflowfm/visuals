import { useMemo, useState } from 'react';
import { Facts, type Fact } from '@openflow/widgets/debug/Facts.tsx';
import { Group, Harness, Shelf, Status, Toolbar } from '@openflow/widgets/debug/Harness.tsx';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { Toggle } from '@openflow/widgets/controls/Toggle.tsx';
import type { Circuit, Scheme, Show } from '../../protocol.ts';
import type { Clock } from '../state/useShow.ts';
import { CircuitEditor } from '../ui/Circuit.tsx';
import { NodePictures, type NodePictureStatus } from '../ui/NodePictures.tsx';
import './graph.css';

/**
 * The graph editor with three nodes in it and nothing else.
 *
 * The designer mounts this canvas inside a page that also owns a library, a
 * scheme, a set, a promoted node and a floating bench, so a fault in the canvas
 * arrives wrapped in five things that could also have caused it. Here there is
 * a source, a lens and an out, wired, and every one of those five is absent.
 *
 * Three nodes rather than two because two cannot tell a per-node picture from a
 * final picture: with a source straight into an out, the node picture, the
 * promoted picture and the output are all the same image, and a preview that is
 * quietly showing the wrong one looks right. The lens in the middle is what
 * makes them differ.
 */

/** A source, a lens and an out — the smallest graph where the middle matters. */
const THREE = (): Circuit => ({
  nodes: [
    // Graph units are pixels at scale 1, the way `starterCircuit` lays a flow
    // out — spaced so a cord between two of them is a cord you can point at.
    { id: 'g', kind: 'source', op: 'plasma', x: 40, y: 90 },
    { id: 'e', kind: 'lens', op: 'ripple', x: 300, y: 90 },
    { id: 'o', kind: 'out', x: 560, y: 110 },
  ],
  cords: [
    { from: 'g/c', to: 'e/c' },
    { from: 'e/c', to: 'o/c' },
  ],
});

/** The same three with the middle unwired, for telling apart empty and stale. */
const LOOSE = (): Circuit => ({
  nodes: THREE().nodes,
  cords: [{ from: 'g/c', to: 'o/c' }],
});

export function GraphBench({
  show,
  scheme,
  clock,
}: {
  show: Show;
  scheme: Scheme | null;
  clock: Clock;
}) {
  const [circuit, setCircuit] = useState<Circuit>(THREE);
  const [pictures, setPictures] = useState(true);
  const [promoted, setPromoted] = useState<string | null>(null);
  const [status, setStatus] = useState<NodePictureStatus | null>(null);

  const items: Fact[] = useMemo(() => {
    const wired = circuit.cords.length;
    return [
      { name: 'nodes', value: circuit.nodes.length },
      { name: 'cords', value: wired },
      { name: 'promoted', value: promoted ?? 'none', tone: promoted ? 'normal' : 'quiet' },
      { name: 'pictures', value: pictures ? 'on' : 'off', tone: pictures ? 'good' : 'quiet' },
      ...(status
        ? (Object.entries(status) as [string, number][]).map(([name, value]) => ({
            name,
            value,
            tone: 'quiet' as const,
          }))
        : [{ name: 'picture status', value: 'nothing reported', tone: 'bad' as const }]),
    ];
  }, [circuit, promoted, pictures, status]);

  if (!scheme) {
    return (
      <Harness title="Three nodes" status={<Status tone="bad">no scheme</Status>}>
        <Shelf>
          <Facts
            items={[
              { name: 'scheme', value: 'none compiled', tone: 'bad' },
              { name: 'why it matters', value: 'a node picture is rendered through one', tone: 'quiet' },
            ]}
          />
        </Shelf>
      </Harness>
    );
  }

  return (
    <Harness
      title="Three nodes"
      status={
        status && status.live > 0 ? (
          <Status tone="good">{status.live} drawing</Status>
        ) : (
          <Status tone="bad">no picture is live</Status>
        )
      }
    >
      <Toolbar>
        <Group caption="Graph">
          <Button onPress={() => setCircuit(THREE())}>Wired</Button>
          <Button onPress={() => setCircuit(LOOSE())}>Lens unwired</Button>
        </Group>
        <Group caption="Pictures">
          <Toggle on={pictures} onChange={setPictures} label="Draw node pictures">
            pictures
          </Toggle>
          <Button onPress={() => setPromoted(null)}>Unpromote</Button>
        </Group>
      </Toolbar>
      <Shelf>
        <Facts items={items} />
      </Shelf>
      <div className="vf-graph-bench">
        <NodePictures
          circuit={circuit}
          show={show}
          scheme={scheme}
          transport={clock}
          enabled={pictures}
          promoted={promoted}
          onStatus={setStatus}
        >
          {(picture) => (
            <CircuitEditor
              circuit={circuit}
              onChange={setCircuit}
              energy={show.master}
              beat={clock.beat}
              picture={(nodeId) => (
                <button
                  type="button"
                  className="vf-graph-promote"
                  data-on={nodeId === promoted ? '' : undefined}
                  aria-pressed={nodeId === promoted}
                  title="Show this node in the picture"
                  onClick={() => setPromoted(nodeId)}
                >
                  {picture(nodeId)}
                </button>
              )}
            />
          )}
        </NodePictures>
      </div>
    </Harness>
  );
}
