import { useMemo, useState } from 'react';
import { Device } from '@openflow/widgets/chrome/Device.tsx';
import { Graph, GraphNode } from '@openflow/widgets/chrome/Graph.tsx';
import { Port } from '@openflow/widgets/chrome/Port.tsx';
import type { Preset, Problem } from './api.ts';
import { STAGES, cords, isOn, linesOf, port, problemsOf, setField, type Stage } from './stages.ts';

interface Props {
  preset: Preset;
  problems: Problem[];
  selected: string;
  onSelect(id: string): void;
  onChange(next: Preset): void;
}

/** MilkDrop's pipeline, one node per stage, wired the way the frame runs. */
export function StageGraph({ preset, problems, selected, onSelect, onChange }: Props) {
  const [moved, setMoved] = useState<Record<string, { x: number; y: number }>>({});
  const all = useMemo(cords, []);

  const toggle = (s: Stage, on: boolean) => {
    if (!s.slot) return;
    const { list, index } = s.slot;
    onChange(setField(preset, `${list}.${index}.values`, { ...preset[list][index].values, enabled: on ? 1 : 0 }));
  };

  return (
    <Graph
      className="stage-graph"
      cords={all}
      onMove={(id, x, y) => setMoved((m) => ({ ...m, [id]: { x, y } }))}
    >
      {STAGES.map((s) => {
        const at = moved[s.id] ?? s;
        const on = isOn(preset, s);
        const issues = problemsOf(problems, s);
        const lines = linesOf(preset, s);
        return (
          <GraphNode key={s.id} id={s.id} x={at.x} y={at.y}>
            <div className="stage" data-kind={s.kind} data-off={on ? undefined : ''} data-problem={issues.length ? '' : undefined}>
              <Device
                name={s.label}
                on={on}
                onToggle={s.slot ? (next) => toggle(s, next) : undefined}
                selected={selected === s.id}
                onSelect={() => onSelect(s.id)}
                inlets={s.inlets.map((i) => (
                  <Port key={i} id={port(s.id, i)} side="in" label={i} />
                ))}
                outlets={s.outlets.map((o) => (
                  <Port key={o} id={port(s.id, o)} side="out" label={o} />
                ))}
              >
                <div className="stage-face" onPointerDown={() => onSelect(s.id)}>
                  {s.code.length > 0 && <span>{lines ? `${lines} lines` : 'empty'}</span>}
                  {s.code.length > 0 && s.code[0].lang === 'hlsl' && !on && <span>default</span>}
                  {issues.length > 0 && <span className="stage-issue">{issues.length} problem{issues.length > 1 ? 's' : ''}</span>}
                </div>
              </Device>
            </div>
          </GraphNode>
        );
      })}
    </Graph>
  );
}
