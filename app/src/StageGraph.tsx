import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Device, DevicePortRow } from '@openflow/widgets/chrome/Device.tsx';
import { Graph, GraphNode, type GraphView } from '@openflow/widgets/chrome/Graph.tsx';
import { Popup } from '@openflow/widgets/chrome/Popup.tsx';
import { Port } from '@openflow/widgets/chrome/Port.tsx';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import { PREVIEW, type Owner, type Preset, type Problem } from './api.ts';
import { plural, show } from './controls.ts';
import { cords, layout, port } from './graph/layout.ts';
import { RemoveLayer } from './graph/RemoveLayer.tsx';
import { writeDefaultShader } from './graph/writeDefaultShader.ts';
import { previewZoom, usePreview } from './previews.ts';
import {
  CHAIN,
  FIRST,
  addLayer,
  codeLines,
  drivenBy,
  layersOf,
  offers,
  problemsOf,
  shaderCode,
  summaryOf,
  usesBlur,
  type LayerKind,
  type Stage,
} from './stages.ts';

import './graph.css';

interface Props {
  preset: Preset;
  problems: Problem[];
  /** The stage open in the inspector; null is motion. */
  selected: string | null;
  onSelect(id: string): void;
  /** The preset changed whole (a layer added or removed, a shader written): applied as a load. */
  onChange(next: Preset): void;
  /** One setting turned: applied live, without reloading the preset. */
  onSet(owner: Owner, key: string, value: number): void;
}

/**
 * A canvas showing one of the engine's stage pictures. It starts at the base
 * size; the poll sets its `width` and `height` to the size each picture comes at.
 */
function Picture({ which, className }: { which: number; className: string }) {
  const ref = usePreview(which);
  return <canvas ref={ref} width={PREVIEW.width} height={PREVIEW.height} className={className} />;
}

/** The node's one line of wiring: a port in, a port out, and a word between them. */
function Wiring({ s, caption }: { s: Stage; caption?: string }) {
  const into = s.kind !== 'source' && s.kind !== 'layer';
  const from = s.kind !== 'out';
  return (
    <DevicePortRow
      inlet={into ? <Port id={port(s.id, 'in')} side="in" label={`into ${s.label}`} showLabel={false} /> : undefined}
      outlet={from ? <Port id={port(s.id, 'out')} side="out" label={`out of ${s.label}`} showLabel={false} /> : undefined}
    >
      <span className="stage-caption">{caption}</span>
    </DevicePortRow>
  );
}

const summary = (p: Preset, s: Stage, n: number) =>
  summaryOf(p, s, n)
    .map(([spec, v]) => `${spec.label} ${show(spec, v)}`)
    .join(' · ');

interface NodeProps {
  stage: Stage;
  preset: Preset;
  problems: Problem[];
  selected: boolean;
  onSelect(id: string): void;
  onChange(next: Preset): void;
}

/** One stage of the pipeline: its picture, a word on what it's set to, and the head of its code. */
const StageNode = memo(function StageNode({ stage: s, preset, problems, selected, onSelect, onChange }: NodeProps) {
  const issues = problemsOf(problems, s);
  const shader = s.kind === 'shader';
  const written = shader && shaderCode(preset, s).trim() !== '';
  const code = codeLines(preset, s, shader ? 3 : 4);
  const blur = s.id === 'feedback' && usesBlur(preset);
  // The narrow ends have no room for a word beside their port: their name says it.
  const caption =
    s.kind === 'source' || s.kind === 'out'
      ? undefined
      : shader
          ? written
            ? plural(shaderCode(preset, s).split('\n').length, 'line')
            : "MilkDrop's default"
          : summary(preset, s, 2) || 'as MilkDrop starts';
  return (
    <div className="stage" data-kind={s.kind} data-problem={issues.length ? '' : undefined} onPointerDown={() => onSelect(s.id)}>
      <Device
        name={s.label}
        title={s.term}
        selected={selected}
        onSelect={() => onSelect(s.id)}
        screen={s.picture !== undefined && s.kind !== 'out' ? <Picture which={s.picture} className="stage-picture" /> : undefined}
        portRows={<Wiring s={s} caption={caption} />}
      >
        {s.kind === 'motion' && <pre className="stage-code">{code.length ? code.join('\n') : 'no equations'}</pre>}
        {shader &&
          (written ? (
            <pre className="stage-code">{code.join('\n')}</pre>
          ) : (
            <Button
              onPress={() => {
                writeDefaultShader(preset, s, onChange);
                onSelect(s.id);
              }}
              title={`start a ${s.label} shader from MilkDrop's default, as code`}
            >
              write my own
            </Button>
          ))}
        {blur && <span className="stage-caption">blurred too: a shader reads it</span>}
        {issues.length > 0 && <span className="stage-issue">{plural(issues.length, 'problem')}</span>}
      </Device>
    </div>
  );
});

/** Something drawn into the feedback: a small picture of it, and a way to take it off. */
const LayerNode = memo(function LayerNode({ stage: s, preset, problems, selected, onSelect, onChange }: NodeProps) {
  const issues = problemsOf(problems, s);
  const custom = s.owner && s.owner.list !== 'base';
  const driven = drivenBy(preset, s);
  const lines = codeLines(preset, s, 99).length;
  const caption = issues.length
    ? plural(issues.length, 'problem')
    : custom
      ? lines
        ? `${plural(lines, 'line')} of code`
        : 'no code'
      : summary(preset, s, 2) || (driven ? `${driven} set by motion` : 'as MilkDrop starts');
  return (
    <div className="stage" data-kind={s.kind} data-problem={issues.length ? '' : undefined} onPointerDown={() => onSelect(s.id)}>
      <Device
        name={s.label}
        title={s.term}
        selected={selected}
        onSelect={() => onSelect(s.id)}
        headerEnd={<RemoveLayer preset={preset} stage={s} onChange={onChange} compact />}
        portRows={<Wiring s={s} caption={caption} />}
      >
        <Picture which={s.picture!} className="layer-picture" />
      </Device>
    </div>
  );
});

/** The + under the layers: a menu of what can be drawn into the feedback. */
function AddLayer({ preset, onAdd }: { preset: Preset; onAdd(kind: LayerKind): void }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  return (
    <div className="stage-add">
      <span ref={anchor}>
        <Button onPress={() => setOpen((o) => !o)} title="draw something more into the feedback">
          + add layer
        </Button>
      </span>
      {open && (
        <Popup anchor={anchor} onDismiss={() => setOpen(false)} role="menu" label="add a layer" className="stage-add-menu">
          {offers(preset).map((o) => (
            <Button
              key={o.kind}
              disabled={!!o.full}
              onPress={() => {
                setOpen(false);
                onAdd(o.kind);
              }}
            >
              {o.label}
              {o.full && <i> — {o.full}</i>}
            </Button>
          ))}
        </Popup>
      )}
    </div>
  );
}

/**
 * How much to shrink the nodes so all of them fit the pane, from where they
 * stand now at size `size`.
 *
 * The widgets `Graph` owns its pan and zoom and has no setter yet (driving them
 * from outside isn't built), so the host fits by drawing
 * smaller: positions times the factor, faces under `--wdg-node-zoom`. Both scale
 * linearly, so one measurement gives the exact factor. The graph's own zoom `k`
 * is CSS `zoom` too, and rectangles under it are screen pixels (WebKit, and
 * Chromium 128+), so dividing by `k` turns the extent back into graph units.
 */
function fitting(box: HTMLElement | null, view: GraphView | null, size: number): number | null {
  const pane = box?.querySelector<HTMLElement>('.wdg-graph');
  const content = pane?.querySelector<HTMLElement>('.wdg-graph-content');
  if (!pane || !content || !view) return null;
  const k = view.scale();
  const origin = content.getBoundingClientRect();
  let right = 0;
  let bottom = 0;
  for (const node of content.querySelectorAll<HTMLElement>('.wdg-graph-node')) {
    const r = node.getBoundingClientRect();
    right = Math.max(right, r.right - origin.left);
    bottom = Math.max(bottom, r.bottom - origin.top);
  }
  if (right <= 0 || bottom <= 0) return null;
  const room = pane.getBoundingClientRect();
  // Measured at `size`, so the whole-size extent is this over `size`.
  const fits = Math.min(room.width / (right / size + 12), room.height / (bottom / size + 12)) / k;
  return Math.max(0.5, Math.min(1, fits));
}

/** MilkDrop's pipeline left to right, with the layers drawn into its feedback beside it. */
export function StageGraph({ preset, problems, selected, onSelect, onChange }: Props) {
  const layers = useMemo(() => layersOf(preset, problems), [preset, problems]);
  const shape = layers.map((s) => s.id).join(' ');
  const at = useMemo(() => layout(layers), [layers]);
  const wires = useMemo(() => cords(layers), [layers]);
  // Where nodes were dragged, for as long as the same nodes are showing.
  const [moved, setMoved] = useState<{ shape: string; at: Record<string, { x: number; y: number }> }>({ shape, at: {} });
  const dragged = moved.shape === shape ? moved.at : {};
  // A new set of nodes, a new pane size or the fit button mounts the graph afresh and fits it.
  const [fits, setFits] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const view = useRef<GraphView>(null);
  const key = `${shape}|${fits}`;

  // How small the nodes draw so they all fit; measured after each fresh mount.
  const [size, setSize] = useState(1);
  const sized = useRef(size);
  sized.current = size;
  // The pictures are asked for at the zoom they're shown at, read at each poll.
  useEffect(() => previewZoom(() => ({ node: sized.current, graph: view.current?.scale() ?? 1 })), []);  useEffect(() => {
    // A timer rather than animation frames: a window behind others gets none.
    const timer = window.setTimeout(() => {
      const next = fitting(box.current, view.current, sized.current);
      if (next !== null && Math.abs(next - sized.current) > 0.01) setSize(next);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [key]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let last = { w: el.clientWidth, h: el.clientHeight };
    let timer = 0;
    const observer = new ResizeObserver(() => {
      const now = { w: el.clientWidth, h: el.clientHeight };
      if (Math.abs(now.w - last.w) < 24 && Math.abs(now.h - last.h) < 24) return;
      last = now;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setFits((n) => n + 1), 150);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  const current = selected ?? FIRST;
  const add = (kind: LayerKind) => {
    const added = addLayer(preset, kind);
    if (!added) return;
    onChange(added.preset);
    onSelect(added.id);
  };
  const place = (id: string) => dragged[id] ?? { x: at[id].x * size, y: at[id].y * size };

  return (
    <div className="stage-graph-box" ref={box} style={{ '--wdg-node-zoom': size } as CSSProperties}>
      <Graph
        key={key}
        className="stage-graph"
        cords={wires}
        viewRef={view}
        minZoom={0.4}
        onMove={(id, x, y) => setMoved((m) => ({ shape, at: { ...(m.shape === shape ? m.at : {}), [id]: { x, y } } }))}
      >
        {CHAIN.map((s) => (
          <GraphNode key={s.id} id={s.id} {...place(s.id)}>
            <StageNode stage={s} preset={preset} problems={problems} selected={current === s.id} onSelect={onSelect} onChange={onChange} />
          </GraphNode>
        ))}
        {layers.map((s) => (
          <GraphNode key={s.id} id={s.id} {...place(s.id)}>
            <LayerNode stage={s} preset={preset} problems={problems} selected={current === s.id} onSelect={onSelect} onChange={onChange} />
          </GraphNode>
        ))}
        <GraphNode id="add" {...place('add')}>
          <AddLayer preset={preset} onAdd={add} />
        </GraphNode>
      </Graph>
      <div className="stage-graph-tools">
        <Button
          tone="quiet"
          onPress={() => {
            setMoved({ shape, at: {} });
            setFits((n) => n + 1);
          }}
          title="put every node back and fit them in the pane">
          fit
        </Button>
      </div>
    </div>
  );
}
