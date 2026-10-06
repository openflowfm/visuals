import { useEffect, useState } from 'react';
import type { Owner, Preset, Problem } from './api.ts';
import { getField, otherValues, problemsOf, setField, settingsOf, type Stage } from './stages.ts';

/** A number field that lets you type `-` or `0.` on the way to a number. */
function NumberCell({ value, onChange }: { value: number; onChange(n: number): void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (Number(text) !== value) setText(String(value));
    // Only an outside change should overwrite what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

interface Props {
  preset: Preset;
  stage: Stage;
  problems: Problem[];
  /** Code changed: the preset is applied whole. */
  onChange(next: Preset): void;
  /** A setting changed: applied live. */
  onSet(owner: Owner, key: string, value: number): void;
}

/** One stage's code and every one of its settings, edited in place. */
export function Inspector({ preset, stage, problems, onChange, onSet }: Props) {
  const issues = problemsOf(problems, stage);
  const settings = settingsOf(preset, stage);
  const other = stage.id === 'frame' ? otherValues(preset) : [];
  return (
    <div className="inspector">
      <h2>{stage.label}</h2>
      {issues.map((p, i) => (
        <p key={i} className="problem">
          <b>
            {p.stage}
            {p.line ? `:${p.line}` : ''}
          </b>{' '}
          {p.message}
        </p>
      ))}
      {stage.code.map((c) => {
        const text = getField(preset, c.field);
        return (
          <label key={c.field} className="code">
            <span>
              {c.label} <i>{c.lang}</i>
            </span>
            <textarea
              spellCheck={false}
              value={text}
              rows={Math.min(40, Math.max(4, text.split('\n').length + 1))}
              onChange={(e) => onChange(setField(preset, c.field, e.target.value))}
            />
          </label>
        );
      })}
      {(settings.length > 0 || other.length > 0) && (
        <div className="values">
          {settings.map(([spec, v]) => (
            <label key={spec.key} title={spec.key}>
              <span>{spec.label}</span>
              <NumberCell value={v} onChange={(n) => onSet(stage.owner!, spec.key, n)} />
            </label>
          ))}
          {other.map(([key, v]) => (
            <label key={key}>
              <span>{key}</span>
              <NumberCell value={v} onChange={(n) => onSet({ list: 'base' }, key, n)} />
            </label>
          ))}
        </div>
      )}
      {stage.code.length === 0 && settings.length === 0 && other.length === 0 && <p className="quiet">Nothing to set here.</p>}
    </div>
  );
}
