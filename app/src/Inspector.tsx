import { NumberField } from '@openflow/widgets/controls/NumberField.tsx';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import type { Owner, Preset, Problem } from './api.ts';
import { Setting } from './graph/Setting.tsx';
import { defaultShader, drivenBy, getField, otherValues, problemsOf, removeLayer, setField, settingsOf, stageFor } from './stages.ts';
import './graph.css';

interface Props {
  preset: Preset;
  /** The stage selected in the graph, by id; null is motion. */
  selected: string | null;
  problems: Problem[];
  /** Code changed, or a layer came off: the preset is applied whole. */
  onChange(next: Preset): void;
  /** A setting changed: applied live. */
  onSet(owner: Owner, key: string, value: number): void;
}

const BASE: Owner = { list: 'base' };

/** A file value nothing else claims: any number, typed or dragged. */
const loose = (key: string, value: number) => ({
  kind: 'float' as const,
  min: Math.min(0, value),
  max: Math.max(1, value * 2),
  defaultValue: value,
  name: key,
});

/** One stage's code and every one of its settings, edited in place. */
export function Inspector({ preset, selected, problems, onChange, onSet }: Props) {
  const stage = stageFor(preset, selected, problems);
  const issues = problemsOf(problems, stage);
  const settings = settingsOf(preset, stage);
  const other = otherValues(preset);
  const shader = stage.kind === 'shader';
  const unwritten = shader && preset[stage.id as 'warp' | 'comp'].trim() === '';
  const removable = stage.kind === 'layer';
  const driven = drivenBy(preset, stage);
  return (
    <div className="inspector">
      <header>
        <div>
          <h2>{stage.label}</h2>
          <p className="term">{stage.term}</p>
        </div>
        {removable && (
          <Button
            tone="danger"
            disabled={!!driven}
            title={driven ? `motion's per-frame code sets ${driven}: change it there to take this off` : 'take this layer off; its code is kept'}
            onPress={() => {
              const next = removeLayer(preset, stage.id);
              if (next) onChange(next);
            }}
          >
            remove
          </Button>
        )}
      </header>
      {issues.map((p, i) => (
        <p key={i} className="problem">
          <b>
            {p.stage}
            {p.line ? `:${p.line}` : ''}
          </b>{' '}
          {p.message}
        </p>
      ))}
      {unwritten && (
        <div className="inspector-default">
          <p className="quiet">This preset uses MilkDrop's default {stage.label} shader.</p>
          <Button onPress={() => onChange({ ...preset, [stage.id]: defaultShader(preset, stage.id as 'warp' | 'comp') })}>write my own</Button>
        </div>
      )}
      {!unwritten &&
        stage.code.map((c) => {
          const text = getField(preset, c.field);
          return (
            <label key={c.field} className="code">
              <span>
                {c.label} <i>{c.term}</i>
              </span>
              <textarea
                spellCheck={false}
                value={text}
                rows={Math.min(30, Math.max(4, text.split('\n').length + 1))}
                onChange={(e) => onChange(setField(preset, c.field, e.target.value))}
              />
            </label>
          );
        })}
      {stage.id === 'comp' && !unwritten && settings.length > 0 && <p className="quiet">These settings only reach the picture through MilkDrop's default composite.</p>}
      {settings.length > 0 && (
        <div className="values">
          {settings.map(([spec, v]) => (
            <label key={spec.key} title={spec.key}>
              <span>{spec.label}</span>
              <Setting spec={spec} value={v} onChange={(n) => onSet(stage.owner!, spec.key, n)} />
            </label>
          ))}
        </div>
      )}
      {stage.code.length === 0 && settings.length === 0 && <p className="quiet">Nothing to set here.</p>}
      {other.length > 0 && (
        <details className="file">
          <summary>file</summary>
          <p className="quiet">Values the file holds that no stage uses.</p>
          <div className="values">
            {other.map(([key, v]) => (
              <label key={key} title={key}>
                <span>{key}</span>
                <NumberField param={loose(key, v)} value={v} onChange={(n) => onSet(BASE, key, n)} label={key} name="" width={84} showFill={false} />
              </label>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
