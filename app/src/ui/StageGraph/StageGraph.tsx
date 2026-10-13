import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ActionButton } from '@satoramoto/zen';
import { Device, DevicePortRow } from '@satoramoto/zen';
import { Graph, GraphNode, type GraphView } from '@satoramoto/zen';
import { Port } from '@satoramoto/zen';
import { Popup } from '@satoramoto/zen';
import { Stack } from '@satoramoto/zen';
import { Surface } from '@satoramoto/zen';
import { Text } from '@satoramoto/zen';
import { PREVIEW, type Owner, type Preset, type Problem } from '../model/api';
import { plural, show } from '../model/controls';
import { previewZoom, usePicture, writeDefaultShader } from '../model/lab';
import { cords, layout, port } from '../model/stage-layout';
import { CHAIN, FIRST, addLayer, codeLines, drivenBy, layersOf, offers, problemsOf, shaderCode, summaryOf, usesBlur, type LayerKind, type Stage } from '../model/stages';
import { RemoveLayer } from '../StageInspector/RemoveLayer';
import './StageGraph.css';

// A port of visual[flow]'s `app/src/StageGraph.tsx` (the lab's stage graph): the same export,
// props, copy and accessible names. Classes are `vs-stage*` (the original's `stage*`).

export interface StageGraphProps {
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

/** How long after a fresh mount the graph fits itself: a timer, since a window behind others gets no frames. */
const FIT_AFTER_MS = 120;

/**
 * A canvas showing one of the engine's stage pictures, on a `screen` Surface. It starts at the
 * base size; the lab's poll sets its `width` and `height` to the size each picture comes at.
 */
function Picture({ which, wide = false }: { which: number; wide?: boolean }) {
  const ref = usePicture(which);
  return (
    <Surface material="screen" radius="none" className="vs-stage-picture" data-wide={wide ? '' : undefined}>
      <canvas ref={ref} width={PREVIEW.width} height={PREVIEW.height} />
    </Surface>
  );
}

/** The node's one line of wiring: a port in, a port out, and a word between them. Every port here has a cord. */
function Wiring({ s, caption }: { s: Stage; caption?: string }) {
  const into = s.kind !== 'source' && s.kind !== 'layer';
  const from = s.kind !== 'out';
  return (
    <DevicePortRow
      inlet={into ? <Port id={port(s.id, 'in')} side="in" label={`into ${s.label}`} showLabel={false} connected /> : undefined}
      outlet={from ? <Port id={port(s.id, 'out')} side="out" label={`out of ${s.label}`} showLabel={false} connected /> : undefined}
    >
      {caption !== undefined && (
        <Text role="caption" tone="muted" truncate>
          {caption}
        </Text>
      )}
    </DevicePortRow>
  );
}

/** The head of a stage's code, a few lines in a well, cut rather than wrapped. */
function CodeHead({ lines }: { lines: string }) {
  return (
    <Surface as="pre" material="well" radius="input" className="vs-stage-code">
      <Text role="code" tone="muted" className="vs-stage-code-text">
        {lines}
      </Text>
    </Surface>
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
    <div className="vs-stage" data-kind={s.kind} onPointerDown={() => onSelect(s.id)}>
      <Device
        name={s.label}
        title={s.term}
        selected={selected}
        onSelect={() => onSelect(s.id)}
        problem={issues.length > 0}
        screen={s.picture !== undefined && s.kind !== 'out' ? <Picture which={s.picture} /> : undefined}
        portRows={<Wiring s={s} caption={caption} />}
      >
        {(s.kind === 'motion' || shader || blur || issues.length > 0) && (
          <Stack gap={1} align="stretch">
            {s.kind === 'motion' && <CodeHead lines={code.length ? code.join('\n') : 'no equations'} />}
            {shader &&
              (written ? (
                <CodeHead lines={code.join('\n')} />
              ) : (
                <ActionButton
                  onPress={() => {
                    writeDefaultShader(preset, s, onChange);
                    onSelect(s.id);
                  }}
                  title={`start a ${s.label} shader from MilkDrop's default, as code`}
                >
                  write my own
                </ActionButton>
              ))}
            {blur && (
              <Text role="caption" tone="muted" truncate>
                blurred too: a shader reads it
              </Text>
            )}
            {issues.length > 0 && (
              <Text role="caption" tone="danger">
                {plural(issues.length, 'problem')}
              </Text>
            )}
          </Stack>
        )}
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
    <div className="vs-stage" data-kind={s.kind} onPointerDown={() => onSelect(s.id)}>
      <Device
        name={s.label}
        title={s.term}
        selected={selected}
        onSelect={() => onSelect(s.id)}
        problem={issues.length > 0}
        headerEnd={<RemoveLayer preset={preset} stage={s} onChange={onChange} compact />}
        portRows={<Wiring s={s} caption={caption} />}
      >
        <Picture which={s.picture!} wide />
      </Device>
    </div>
  );
});

/** The + under the layers: a menu of what can be drawn into the feedback. */
function AddLayer({ preset, onAdd }: { preset: Preset; onAdd(kind: LayerKind): void }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  return (
    <div className="vs-stage-add">
      <span ref={anchor} className="vs-stage-add-anchor">
        <ActionButton onPress={() => setOpen((o) => !o)} title="draw something more into the feedback">
          + add layer
        </ActionButton>
      </span>
      {open && (
        <Popup anchor={anchor} onDismiss={() => setOpen(false)} role="menu" label="add a layer" className="vs-stage-add-menu">
          <Stack gap={0} align="stretch">
            {offers(preset).map((o) => (
              <ActionButton
                key={o.kind}
                tone="quiet"
                className="vs-stage-add-item"
                disabled={!!o.full}
                onPress={() => {
                  setOpen(false);
                  onAdd(o.kind);
                }}
              >
                <span className="vs-stage-add-words">
                  {o.label}
                  {o.full && (
                    <Text role="caption" tone="muted">
                      {' '}
                      — {o.full}
                    </Text>
                  )}
                </span>
              </ActionButton>
            ))}
          </Stack>
        </Popup>
      )}
    </div>
  );
}

/**
 * MilkDrop's pipeline left to right, with the layers drawn into its feedback beside it.
 *
 * **Job.** The lab's map of a preset: the chain (audio → motion → warp → feedback → composite →
 * screen) along the top, every layer the preset draws stacked under warp and cabled into the
 * feedback, and "+ add layer" waiting under the feedback. Each node is a `Device`: its stage
 * picture, one wiring row (a word on what it's set to), and the head of its code or "write my own"
 * for a shader still at MilkDrop's default; a layer's head carries its ×. Pressing a node selects
 * it for the inspector. Nodes drag for as long as the same nodes show; "fit" puts them back and
 * fits the graph to the pane.
 *
 * **Changed.** Built on core `Graph`, `Device`, `Port`, `ActionButton` and `Popup`. The graph fits
 * itself (`GraphView.fit`, `fitOnResize`), so the original's `fitting()` measurement and its
 * `--wdg-node-zoom` shrinking are gone: nodes sit at `layout()`'s positions in graph units and the
 * graph's own zoom does the fitting, after each fresh mount (a timer) and on a notable resize; the
 * pictures are asked for at `{ node: 1, graph: zoom }`. A problem is the Device's `problem` edge
 * (`--danger`) rather than an edge variable. Pictures sit on a `screen` Surface and code heads in a
 * `well` Surface, each as `Text`. Kind inks are neutral tone steps (motion and feedback
 * `--text-1`, shaders `--text-2`, layers `--text-3`), and cords neutral except audio in
 * `--success`: in this pack amber means caution, green the signal and the hues the stems, so the
 * original's blue/amber/green per kind would give a colour a second meaning. The add menu's items
 * are `quiet` buttons. The stage pictures and the shader default come from `model/lab`, never
 * `api`/`previews` (the app's bundle check).
 *
 * **Kept.** Props (`onSet` is accepted and unused, as in the original), copy, accessible names
 * (ports "into …"/"out of …", the menu "add a layer", the head's tooltip the MilkDrop term), the
 * add flow (add, then select what was added) and the remount-and-fit on a new set of nodes or "fit".
 *
 * **Tuning knobs** (StageGraph.css):
 * - `--vs-stage-wide`: a chain or layer node's width, `layout()`'s `WIDE` (168px under `roomy`).
 * - `--vs-stage-narrow`: the audio and screen ends' width, `NARROW` (88px under `roomy`).
 */
export function StageGraph({ preset, problems, selected, onSelect, onChange }: StageGraphProps) {
  const layers = useMemo(() => layersOf(preset, problems), [preset, problems]);
  const shape = layers.map((s) => s.id).join(' ');
  const at = useMemo(() => layout(layers), [layers]);
  const wires = useMemo(() => cords(layers), [layers]);
  // Where nodes were dragged, for as long as the same nodes are showing.
  const [moved, setMoved] = useState<{ shape: string; at: Record<string, { x: number; y: number }> }>({ shape, at: {} });
  const dragged = moved.shape === shape ? moved.at : {};
  // A new set of nodes or the fit button mounts the graph afresh and fits it; a resize re-fits in place.
  const [fits, setFits] = useState(0);
  const view = useRef<GraphView>(null);
  const key = `${shape}|${fits}`;

  // The pictures are asked for at the zoom they're shown at, read at each poll.
  useEffect(() => previewZoom(() => ({ node: 1, graph: view.current?.scale() ?? 1 })), []);
  useEffect(() => {
    const timer = window.setTimeout(() => view.current?.fit(), FIT_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [key]);

  const current = selected ?? FIRST;
  const add = (kind: LayerKind) => {
    const added = addLayer(preset, kind);
    if (!added) return;
    onChange(added.preset);
    onSelect(added.id);
  };
  const place = (id: string) => dragged[id] ?? at[id];

  return (
    <div className="vs-stage-graph-box">
      <Graph
        key={key}
        className="vs-stage-graph"
        cords={wires}
        viewRef={view}
        minZoom={0.4}
        fitOnResize
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
      <Stack direction="row" gap={1} className="vs-stage-graph-tools">
        <ActionButton
          tone="quiet"
          onPress={() => {
            setMoved({ shape, at: {} });
            setFits((n) => n + 1);
          }}
          title="put every node back and fit them in the pane"
        >
          fit
        </ActionButton>
      </Stack>
    </div>
  );
}
