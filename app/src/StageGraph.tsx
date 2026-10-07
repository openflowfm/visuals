import { memo, useMemo, useState } from 'react';
import { Device, DevicePortRow } from '@openflow/widgets/chrome/Device.tsx';
import { Graph, GraphNode } from '@openflow/widgets/chrome/Graph.tsx';
import { Port } from '@openflow/widgets/chrome/Port.tsx';
import { Slider } from '@openflow/widgets/controls/Slider.tsx';
import { Toggle } from '@openflow/widgets/controls/Toggle.tsx';
import type { Param } from '@openflow/widgets/param/param.ts';
import type { Owner, Preset, Problem } from './api.ts';
import type { Spec } from './params.ts';
import { usePreview } from './previews.ts';
import { STAGES, codeLines, cords, isOn, port, problemsOf, settingsOf, usesBlur, type Stage } from './stages.ts';

import './graph.css';

interface Props {
  preset: Preset;
  problems: Problem[];
  /** The stage open in the inspector; null is the first. */
  selected: string | null;
  onSelect(id: string): void;
  /** The preset changed whole (a stage added or removed): applied as a load. */
  onChange(next: Preset): void;
  /** One setting turned on a face: applied live, without reloading the preset. */
  onSet(owner: Owner, key: string, value: number): void;
}

/** A control's range: the spec's, stretched to reach what the file says — presets
 * set `sx=100` as readily as `sx=1`, and a slider pinned at its end hides that. */
const paramOf = (s: Spec, value: number): Param => ({
  kind: s.kind === 'enum' ? 'enum' : s.kind === 'int' ? 'int' : 'float',
  min: Math.min(s.min, value),
  max: Math.max(s.max, value),
  defaultValue: s.def,
  steps: s.kind === 'int' || s.kind === 'enum' ? s.max - s.min + 1 : undefined,
  items: s.items,
  name: s.label,
});

const show = (s: Spec, v: number) =>
  s.kind === 'enum' ? (s.items?.[Math.round(v)] ?? String(v)) : s.kind === 'int' ? String(Math.round(v)) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(3);

function Control({ spec, value, onChange }: { spec: Spec; value: number; onChange(v: number): void }) {
  if (spec.kind === 'bool') {
    return (
      <Toggle on={value >= 0.5} onChange={(on) => onChange(on ? 1 : 0)} layout="inside" name={spec.key} label={spec.label} title={spec.key}>
        {value >= 0.5 ? 'on' : 'off'}
      </Toggle>
    );
  }
  return (
    <Slider
      param={paramOf(spec, value)}
      value={value}
      onChange={(v) => onChange(spec.kind === 'float' ? v : Math.round(v))}
      name={spec.label}
      orientation="horizontal"
      layout="inside"
      display={show(spec, value)}
      title={spec.key}
    />
  );
}

interface NodeProps {
  stage: Stage;
  preset: Preset;
  problems: Problem[];
  selected: boolean;
  onSelect(id: string): void;
  onSet(owner: Owner, key: string, value: number): void;
}

/** One stage: its picture, its settings as controls, and the head of its code. */
const StageNode = memo(function StageNode({ stage: s, preset, problems, selected, onSelect, onSet }: NodeProps) {
  const picture = usePreview(s.picture);
  const on = isOn(preset, s);
  const issues = problemsOf(problems, s);
  const settings = settingsOf(preset, s).filter(([spec]) => spec.face);
  const code = codeLines(preset, s, 5);
  const idle = s.id === 'blur' && !usesBlur(preset);
  const enabled = s.owner && s.owner.list !== 'base' ? s.owner : undefined;
  return (
    <div className="stage" data-kind={s.kind} data-off={on ? undefined : ''} data-problem={issues.length ? '' : undefined}>
      <Device
        name={s.label}
        on={on}
        onToggle={enabled ? (next) => onSet(enabled, 'enabled', next ? 1 : 0) : undefined}
        selected={selected}
        onSelect={() => onSelect(s.id)}
        screen={
          s.picture !== undefined ? (
            <div className="stage-screen" data-idle={idle ? 'no shader reads blur' : undefined}>
              <canvas ref={picture} width={192} height={108} className="stage-picture" />
            </div>
          ) : undefined
        }
        outlets={s.outlets.map((o) => (
          <Port key={o} id={port(s.id, o)} side="out" label={o} />
        ))}
        portRows={[
          ...s.inlets.map((i) => <DevicePortRow key={`in:${i}`} inlet={<Port id={port(s.id, i)} side="in" label={i} />} />),
          ...(s.code.length
            ? [
                <DevicePortRow key="code">
                  <pre className="stage-code" onPointerDown={() => onSelect(s.id)} title="edit in the inspector">
                    {code.length ? code.join('\n') : s.code[0].lang === 'hlsl' ? "MilkDrop's default" : 'no code'}
                  </pre>
                </DevicePortRow>,
              ]
            : []),
          ...settings.map(([spec, value]) => (
            <DevicePortRow key={spec.key} inlet={<Port id={port(s.id, spec.key)} side="in" label={spec.label} showLabel={false} />}>
              <Control spec={spec} value={value} onChange={(v) => onSet(s.owner!, spec.key, v)} />
            </DevicePortRow>
          )),
          ...(issues.length
            ? [
                <DevicePortRow key="problems">
                  <span className="stage-issue">
                    {issues.length} problem{issues.length > 1 ? 's' : ''}
                  </span>
                </DevicePortRow>,
              ]
            : []),
        ]}
      />
    </div>
  );
});

/** MilkDrop's pipeline, one node per stage, wired the way the frame runs. */
export function StageGraph({ preset, problems, selected, onSelect, onSet }: Props) {
  const [moved, setMoved] = useState<Record<string, { x: number; y: number }>>({});
  const all = useMemo(cords, []);
  return (
    <Graph className="stage-graph" cords={all} onMove={(id, x, y) => setMoved((m) => ({ ...m, [id]: { x, y } }))}>
      {STAGES.map((s) => {
        const at = moved[s.id] ?? s;
        return (
          <GraphNode key={s.id} id={s.id} x={at.x} y={at.y}>
            <StageNode stage={s} preset={preset} problems={problems} selected={(selected ?? STAGES[0].id) === s.id} onSelect={onSelect} onSet={onSet} />
          </GraphNode>
        );
      })}
    </Graph>
  );
}
