import { useMemo, useState } from 'react';
import { Facts, type Fact } from '@openflow/widgets/debug/Facts.tsx';
import { Group, Harness, Shelf, Status, Toolbar } from '@openflow/widgets/debug/Harness.tsx';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { Select } from '@openflow/widgets/controls/Select.tsx';
import { Toggle } from '@openflow/widgets/controls/Toggle.tsx';
import { LENS_MODES, SOURCES, type Circuit, type Scheme, type Show } from '../../protocol.ts';
import { inletsOf } from '../render/circuit.ts';
import { setValue } from '../ui/edits.ts';
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

/**
 * A source, a lens and an out — the smallest graph where the middle matters.
 *
 * `checker` rather than something pretty. A displacement moves pixels without
 * changing the histogram, so a soft cloudy source rippled looks identical to
 * the same source unrippled unless you are staring — which is exactly the
 * reading a bench must not require. Hard edges make a displacement obvious.
 */
const THREE = (source = 'checker', lens = 'ripple'): Circuit => ({
  nodes: [
    // Graph units are pixels at scale 1, the way `starterCircuit` lays a flow
    // out — spaced so a cord between two of them is a cord you can point at.
    { id: 'g', kind: 'source', op: source, x: 40, y: 90 },
    { id: 'e', kind: 'lens', op: lens, x: 300, y: 90 },
    { id: 'o', kind: 'out', x: 560, y: 110 },
  ],
  cords: [
    { from: 'g/c', to: 'e/c' },
    { from: 'e/c', to: 'o/c' },
  ],
});

/** The same three with the middle unwired, for telling apart empty and stale. */
const LOOSE = (source = 'checker', lens = 'ripple'): Circuit => ({
  nodes: THREE(source, lens).nodes,
  cords: [{ from: 'g/c', to: 'o/c' }],
});

/**
 * What a node's picture looks like, as one number.
 *
 * "Did moving that change anything" is a question eyes are bad at and a hash is
 * good at — a displacement that moved every pixel and changed no colour reads
 * as identical to a glance and as a different number here. Sampled rather than
 * summed over every pixel: this runs on a button, but it runs beside a rig
 * drawing at sixty.
 */
const signature = (canvas: HTMLCanvasElement): number | null => {
  const g = canvas.getContext('2d');
  if (!g || !canvas.width || !canvas.height) return null;
  const { data } = g.getImageData(0, 0, canvas.width, canvas.height);
  let hash = 0;
  for (let i = 0; i < data.length; i += 4 * 97) {
    hash = (hash * 31 + data[i] + data[i + 1] * 3 + data[i + 2] * 7) >>> 0;
  }
  return hash;
};

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
  const [source, setSource] = useState(SOURCES.indexOf('checker' as never));
  const [lens, setLens] = useState(LENS_MODES.indexOf('ripple'));
  const [inlet, setInlet] = useState(0);
  const [verdict, setVerdict] = useState<string>('');
  const [still, setStill] = useState(true);

  /**
   * A clock that says the same thing every time it is asked.
   *
   * Nothing here animates while this is the transport, which is the only way
   * "did moving that change anything" has an answer. With the real clock every
   * picture differs from itself a third of a second later, and the question
   * cannot be asked — the first version of the probe below asked it anyway and
   * reported the source reacting to the lens.
   */
  const frozen = useMemo<Clock>(
    () => ({ beat: () => 8, seconds: () => 4, advance: () => {} }),
    [],
  );

  const middle = circuit.nodes.find((node) => node.id === 'e');
  const knobs = useMemo(
    () => (middle ? inletsOf(middle).filter((port) => port.kind === 'n') : []),
    [middle],
  );

  /**
   * Move one number and report which pictures noticed — against a control.
   *
   * The whole question in one button, and the first version of it was wrong in
   * the way instruments usually are: these pictures animate, so sampling twice
   * a third of a second apart says everything changed whatever you touched. It
   * reported the *source* reacting to the lens's parameter and that reading was
   * worth nothing.
   *
   * So it samples the same interval twice — once having done nothing, once
   * having moved the number — and reports both. A picture in the drifting list
   * is a picture the nudge cannot say anything about; a picture that moved and
   * was not drifting is the answer. Without the control there is no answer,
   * only a number that always says yes.
   */
  const probe = async () => {
    const faces = () =>
      [...document.querySelectorAll<HTMLElement>('.vf-graph-promote')].map((box) => ({
        id: box.dataset.node ?? '?',
        canvas: box.querySelector('canvas'),
      }));
    const read = () =>
      new Map(faces().map(({ id, canvas }) => [id, canvas ? signature(canvas) : null]));
    const settle = () => new Promise((r) => setTimeout(r, 350));

    const port = knobs[Math.min(inlet, Math.max(0, knobs.length - 1))];
    if (!port || !middle) return setVerdict('the middle node has no number inlet');
    // Stop the clock first, or the control below finds everything drifting and
    // the probe can say nothing about anything.
    setStill(true);
    await settle();

    // The control: the same wait, having touched nothing.
    const restingBefore = read();
    await settle();
    const restingAfter = read();
    const drifting = new Set(
      [...restingAfter]
        .filter(([id, sig]) => sig === null || restingBefore.get(id) !== sig)
        .map(([id]) => id),
    );

    const was = middle.values?.[port.name] ?? port.at ?? 0;
    // Far enough that no reasonable effect could ignore it.
    const now = was > 0.5 ? was - 0.4 : was + 0.4;
    const before = read();
    setCircuit((held) => setValue(held, 'e', port.name, now));
    await settle();
    const after = read();

    const moved: string[] = [];
    const still: string[] = [];
    for (const [id, sig] of after) {
      if (drifting.has(id)) continue;
      (sig !== null && before.get(id) !== sig ? moved : still).push(id);
    }
    // The node whose number moved is the one that had to react. Upstream not
    // reacting is the right answer, not a second fault, so it is not a verdict
    // against anything — the first cut of this called a correct reading red.
    const answered = moved.includes('e');
    setVerdict(
      [
        answered ? 'the lens reacted' : 'THE LENS DID NOT REACT',
        `${port.name} ${was.toFixed(2)} → ${now.toFixed(2)}`,
        drifting.size ? `could not tell for: ${[...drifting].join(', ')}` : 'nothing drifting',
        `moved: ${moved.join(', ') || 'nothing'}`,
        `unchanged: ${still.join(', ') || 'nothing'}`,
      ].join(' · '),
    );
  };

  const items: Fact[] = useMemo(
    () => [
      { name: 'nodes', value: circuit.nodes.length },
      { name: 'cords', value: circuit.cords.length },
      { name: 'promoted', value: promoted ?? 'none', tone: promoted ? 'normal' : 'quiet' },
      { name: 'pictures', value: pictures ? 'on' : 'off', tone: pictures ? 'good' : 'quiet' },
      ...(status
        ? (Object.entries(status) as [string, number][]).map(([name, value]) => ({
            name,
            value,
            tone: 'quiet' as const,
          }))
        : [{ name: 'picture status', value: 'nothing reported', tone: 'bad' as const }]),
    ],
    [circuit, promoted, pictures, status],
  );

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
          <Select
            label="Source"
            items={[...SOURCES]}
            index={Math.max(0, source)}
            onChange={(i) => {
              setSource(i);
              setCircuit(THREE(SOURCES[i], LENS_MODES[Math.max(0, lens)]));
            }}
            width={104}
          />
          <Select
            label="Lens"
            items={[...LENS_MODES]}
            index={Math.max(0, lens)}
            onChange={(i) => {
              setLens(i);
              setCircuit(THREE(SOURCES[Math.max(0, source)], LENS_MODES[i]));
            }}
            width={104}
          />
          <Button onPress={() => setCircuit(THREE(SOURCES[Math.max(0, source)], LENS_MODES[Math.max(0, lens)]))}>
            Wired
          </Button>
          <Button onPress={() => setCircuit(LOOSE(SOURCES[Math.max(0, source)], LENS_MODES[Math.max(0, lens)]))}>
            Lens unwired
          </Button>
        </Group>
        <Group caption="Clock">
          <Toggle on={still} onChange={setStill} label="Hold the clock still">
            still
          </Toggle>
        </Group>
        <Group caption="Does it change">
          <Select
            label="Inlet to nudge"
            items={knobs.length ? knobs.map((port) => port.name) : ['none']}
            index={Math.min(inlet, Math.max(0, knobs.length - 1))}
            onChange={setInlet}
            width={92}
          />
          <Button onPress={() => void probe()}>Nudge and compare</Button>
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
      {verdict && (
        <Shelf>
          <Status tone={verdict.startsWith('THE LENS DID NOT') ? 'bad' : 'good'}>{verdict}</Status>
        </Shelf>
      )}
      <div className="vf-graph-bench">
        <NodePictures
          circuit={circuit}
          show={show}
          scheme={scheme}
          transport={still ? frozen : clock}
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
                  data-node={nodeId}
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
