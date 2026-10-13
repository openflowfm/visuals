import { NumberField } from '@satoramoto/zen';
import { Select } from '@satoramoto/zen';
import { Toggle } from '@satoramoto/zen';
import { paramOf, show } from '../model/controls';
import type { Spec } from '../model/params';
import './StageInspector.css';

/**
 * **Job.** One setting as the control its kind wants: a switch (on/off), a menu (an enum's items),
 * or a number to drag or type (whole numbers rounded).
 *
 * **Changed.** Core `Toggle` (`inside`), `Select` and `NumberField`; their widths are the
 * inspector's knobs (StageInspector.tsx) rather than the original's 64, 96 and 84 px props.
 *
 * **Kept.** Its props, the accessible names (the label), the titles (the file's key), the readings.
 */
export function Setting({ spec, value, onChange }: { spec: Spec; value: number; onChange(v: number): void }) {
  if (spec.kind === 'bool') {
    return (
      <Toggle className="vs-stage-setting vs-stage-setting-switch" on={value >= 0.5} onChange={(on) => onChange(on ? 1 : 0)} layout="inside" label={spec.label} title={spec.key}>
        {value >= 0.5 ? 'on' : 'off'}
      </Toggle>
    );
  }
  if (spec.kind === 'enum' && spec.items) {
    return (
      <Select className="vs-stage-setting vs-stage-setting-menu" items={spec.items} index={Math.round(value) - spec.min} onChange={(i) => onChange(spec.min + i)} label={spec.label} title={spec.key} />
    );
  }
  return (
    <NumberField
      className="vs-stage-setting vs-stage-setting-number"
      param={paramOf(spec, value)}
      value={value}
      onChange={(v) => onChange(spec.kind === 'float' ? v : Math.round(v))}
      label={spec.label}
      name=""
      display={show(spec, value)}
      title={spec.key}
    />
  );
}
