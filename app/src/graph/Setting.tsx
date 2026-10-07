import { NumberField } from '@openflow/widgets/controls/NumberField.tsx';
import { Select } from '@openflow/widgets/controls/Select.tsx';
import { Toggle } from '@openflow/widgets/controls/Toggle.tsx';
import { paramOf, show } from '../controls.ts';
import type { Spec } from '../params.ts';

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
