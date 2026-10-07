import { NumberField } from '@openflow/widgets/controls/NumberField.tsx';
import { Select } from '@openflow/widgets/controls/Select.tsx';
import { Toggle } from '@openflow/widgets/controls/Toggle.tsx';
import type { Param } from '@openflow/widgets/param/param.ts';
import type { Spec } from '../params.ts';

/** A control's range: the spec's, stretched to reach what the file says — presets
 * set `sx=100` as readily as `sx=1`, and a field pinned at its end hides that. */
export const paramOf = (s: Spec, value: number): Param => ({
  kind: s.kind === 'enum' ? 'enum' : s.kind === 'int' || s.kind === 'bool' ? 'int' : 'float',
  min: Math.min(s.min, value),
  max: Math.max(s.max, value),
  defaultValue: s.def,
  steps: s.kind === 'int' || s.kind === 'enum' ? s.max - s.min + 1 : undefined,
  items: s.items,
  name: s.label,
});

/** A value as a reading: the item's name, a whole number, or a few decimals. */
export const show = (s: Spec, v: number) =>
  s.kind === 'enum'
    ? (s.items?.[Math.round(v)] ?? String(v))
    : s.kind === 'bool'
      ? v >= 0.5
        ? 'on'
        : 'off'
      : s.kind === 'int'
        ? String(Math.round(v))
        : Math.abs(v) >= 10
          ? v.toFixed(1)
          : String(Number(v.toFixed(3)));

/** One setting as the control its kind wants: a switch, a menu, or a number to drag or type. */
export function Setting({ spec, value, onChange }: { spec: Spec; value: number; onChange(v: number): void }) {
  if (spec.kind === 'bool') {
    return (
      <Toggle on={value >= 0.5} onChange={(on) => onChange(on ? 1 : 0)} layout="inside" label={spec.label} title={spec.key} width={64}>
        {value >= 0.5 ? 'on' : 'off'}
      </Toggle>
    );
  }
  if (spec.kind === 'enum' && spec.items) {
    return <Select items={spec.items} index={Math.round(value) - spec.min} onChange={(i) => onChange(spec.min + i)} label={spec.label} title={spec.key} width={96} />;
  }
  return (
    <NumberField
      param={paramOf(spec, value)}
      value={value}
      onChange={(v) => onChange(spec.kind === 'float' ? v : Math.round(v))}
      label={spec.label}
      name=""
      display={show(spec, value)}
      title={spec.key}
      width={84}
    />
  );
}
