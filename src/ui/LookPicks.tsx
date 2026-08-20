import type { LookDef, Scheme } from '../../protocol.ts';
import { Toggle } from '../../../widgets/src/controls/Toggle.tsx';
import { lookList, toggleId } from './edits.ts';

/**
 * Which looks a level contributes, as a row of switches.
 *
 * The same control for an archetype and for a layer, because the cascade treats
 * them the same way: both **add** to the pile and neither replaces the other.
 * Two different-looking controls would imply a difference that isn't there.
 *
 * Circuits sit after the built-ins and are marked, so the list stays readable as
 * it grows and so it is obvious which of these you can open up and change.
 */
export function LookPicks({
  scheme,
  chosen,
  onChange,
  width = 62,
}: {
  scheme: Scheme;
  chosen: readonly string[] | undefined;
  onChange(next: string[]): void;
  width?: number;
}) {
  return (
    <div className="picks">
      {lookList(scheme).map(({ id, def }: { id: string; def: LookDef }) => (
        <Toggle
          key={id}
          on={(chosen ?? []).includes(id)}
          width={width}
          className={def.circuit ? 'wired' : undefined}
          onChange={(on) => onChange(toggleId(chosen, id, on))}
        >
          {def.name || id}
        </Toggle>
      ))}
    </div>
  );
}
