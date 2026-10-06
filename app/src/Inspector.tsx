import { useEffect, useState } from 'react';
import type { Preset, Problem } from './api.ts';

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
import { getField, problemsOf, setField, setValue, valuesOf, type Stage } from './stages.ts';

interface Props {
  preset: Preset;
  stage: Stage;
  problems: Problem[];
  onChange(next: Preset): void;
}

/** One stage's code and numbers, edited in place. */
export function Inspector({ preset, stage, problems, onChange }: Props) {
  const issues = problemsOf(problems, stage);
  const values = valuesOf(preset, stage);
  return (
    <div className="inspector">
      <h2>{stage.label}</h2>
      {issues.map((p, i) => (
        <p key={i} className="problem">
          <b>{p.stage}{p.line ? `:${p.line}` : ''}</b> {p.message}
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
      {values.length > 0 && (
        <div className="values">
          {values.map(([key, v]) => (
            <label key={key}>
              <span>{key}</span>
              <NumberCell value={v} onChange={(n) => onChange(setValue(preset, stage, key, n))} />
            </label>
          ))}
        </div>
      )}
      {stage.code.length === 0 && values.length === 0 && <p className="quiet">Nothing to set here.</p>}
    </div>
  );
}
