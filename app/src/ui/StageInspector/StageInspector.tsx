import type { ChangeEvent } from 'react';
import { ActionButton } from '@satoramoto/zen';
import { NumberField } from '@satoramoto/zen';
import { focusRing } from '@satoramoto/zen';
import { Stack } from '@satoramoto/zen';
import { Surface } from '@satoramoto/zen';
import { Text } from '@satoramoto/zen';
import type { Owner, Preset, Problem } from '../model/api';
import { range } from '../model/controls';
import { writeDefaultShader } from '../model/lab';
import { BASE, bakedIn, getField, otherValues, problemsOf, setField, settingsOf, shaderCode, stageFor } from '../model/stages';
import { RemoveLayer } from './RemoveLayer';
import { Setting } from './Setting';
import './StageInspector.css';

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

/** A file value nothing else claims: any number, typed or dragged. */
const loose = (key: string, value: number) => range(key, Math.min(0, value), Math.max(1, value * 2), value);

/** Rows for a code box: its lines and one more, from 4 to 30. */
const rowsFor = (text: string) => Math.min(30, Math.max(4, text.split('\n').length + 1));

/**
 * **Job.** The lab's inspector beside the stage graph: one stage's code and every one of its
 * settings, edited in place. Its label (a heading) and MilkDrop's term for it; remove, for a
 * layer; its problems (`stage:line message`, in the danger colour); its code boxes, each sized to
 * its lines (4 to 30 rows), or for a shader still on MilkDrop's default, a note and "write my own"
 * (the lab's `default_shader`, then `onChange`); the settings in two columns, a setting a written
 * shader has baked in struck through under the why; "Nothing to set here." when it has neither;
 * and a `file` disclosure with the values the file holds that no stage claims. Code and removing
 * a layer go out whole (`onChange`); a setting goes out live (`onSet`, owner, key, value).
 *
 * **Changed.** Strings are `Text` in a role (`heading` the label, `caption` the term and notes,
 * `label` a code box's name, `code` the .milk names); sections are `Stack`s; the code boxes sit in
 * a `well` Surface; the controls are core `ActionButton`, `NumberField`, `Select` and `Toggle`.
 * The `file` disclosure is a native `<details>` (core `Disclosure` is a bare toggle with no
 * summary) and has no rule above it (near borderless: space instead). Problems are `--danger`.
 * Widths are knobs, not px props.
 *
 * **Kept.** Its props, the order, every word, accessible name and title, the commands (only through
 * `model/lab`, never `api`).
 *
 * **Tuning knobs.**
 * - `--vs-stage-inspector-number`: a number setting's width (the original's 84px).
 * - `--vs-stage-inspector-menu`: an enum setting's menu width (96px).
 * - `--vs-stage-inspector-switch`: an on/off setting's width (64px).
 */
export function StageInspector({ preset, selected, problems, onChange, onSet }: Props) {
  const stage = stageFor(preset, selected, problems);
  const issues = problemsOf(problems, stage);
  const settings = settingsOf(preset, stage);
  const other = otherValues(preset);
  const shader = stage.kind === 'shader';
  const unwritten = shader && shaderCode(preset, stage).trim() === '';
  const removable = stage.kind === 'layer';
  const baked = bakedIn(preset, stage);
  return (
    <Stack className="vs-stage-inspector" gap={3}>
      <Stack as="header" direction="row" justify="between" align="start" gap={2}>
        <Stack gap={0}>
          <Text as="h2" role="heading" tone="primary">
            {stage.label}
          </Text>
          <Text as="p" role="caption" tone="muted">
            {stage.term}
          </Text>
        </Stack>
        {removable && <RemoveLayer preset={preset} stage={stage} onChange={onChange} />}
      </Stack>
      {issues.map((p, i) => (
        <Text key={i} as="p" role="caption" tone="danger" className="vs-stage-inspector-problem">
          <Text as="b" size="inherit" weight="strong">
            {p.stage}
            {p.line ? `:${p.line}` : ''}
          </Text>{' '}
          {p.message}
        </Text>
      ))}
      {unwritten && (
        <Stack gap={1} align="start">
          <Text as="p" role="caption" tone="muted">
            This preset uses MilkDrop's default {stage.label} shader.
          </Text>
          <ActionButton onPress={() => writeDefaultShader(preset, stage, onChange)}>write my own</ActionButton>
        </Stack>
      )}
      {!unwritten &&
        stage.code.map((c) => {
          const text = getField(preset, c.field);
          return (
            <Stack key={c.field} as="label" gap={1} className="vs-stage-inspector-code">
              <Text role="label" tone="secondary">
                {c.label}{' '}
                <Text role="code" tone="muted" className="vs-stage-inspector-term">
                  {c.term}
                </Text>
              </Text>
              <Surface material="well" radius="input" className="vs-stage-inspector-well">
                <Text
                  as="textarea"
                  role="code"
                  className={`vs-stage-inspector-text ${focusRing}`}
                  spellCheck={false}
                  value={text}
                  rows={rowsFor(text)}
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(setField(preset, c.field, e.target.value))}
                />
              </Surface>
            </Stack>
          );
        })}
      {baked && settings.length > 0 && (
        <Text as="p" role="caption" tone="muted">
          {baked.why}
        </Text>
      )}
      {settings.length > 0 && (
        <div className="vs-stage-inspector-values">
          {settings.map(([spec, v]) => {
            const gone = baked?.keys.has(spec.key) ?? false;
            return (
              <label key={spec.key} title={gone ? `${spec.key}: no longer applies` : spec.key} className="vs-stage-inspector-row" data-baked={gone ? '' : undefined}>
                <Text truncate tone={gone ? 'muted' : undefined} className="vs-stage-inspector-name">
                  {spec.label}
                </Text>
                <Setting spec={spec} value={v} onChange={(n) => onSet(stage.owner!, spec.key, n)} />
              </label>
            );
          })}
        </div>
      )}
      {stage.code.length === 0 && settings.length === 0 && (
        <Text as="p" role="caption" tone="muted">
          Nothing to set here.
        </Text>
      )}
      {other.length > 0 && (
        <details className="vs-stage-inspector-file">
          <summary className="vs-stage-inspector-summary">
            <Text role="label" tone="muted">
              file
            </Text>
          </summary>
          <Stack gap={2}>
            <Text as="p" role="caption" tone="muted">
              Values the file holds that no stage uses.
            </Text>
            <div className="vs-stage-inspector-values">
              {other.map(([key, v]) => (
                <label key={key} title={key} className="vs-stage-inspector-row">
                  <Text role="code" size="label" truncate className="vs-stage-inspector-name vs-stage-inspector-key">
                    {key}
                  </Text>
                  <NumberField className="vs-stage-setting vs-stage-setting-number" param={loose(key, v)} value={v} onChange={(n) => onSet(BASE, key, n)} label={key} name="" showFill={false} />
                </label>
              ))}
            </div>
          </Stack>
        </details>
      )}
    </Stack>
  );
}
