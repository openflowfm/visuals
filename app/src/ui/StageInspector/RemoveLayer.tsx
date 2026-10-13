import { ActionButton } from '@satoramoto/zen';
import type { Preset } from '../model/api';
import { drivenBy, removeLayer, type Stage } from '../model/stages';

interface Props {
  preset: Preset;
  stage: Stage;
  onChange(next: Preset): void;
  /** The × on a layer node's header, rather than the inspector's "remove". */
  compact?: boolean;
}

/**
 * **Job.** Takes a layer off, its code kept; disabled while motion's per-frame code turns it on
 * regardless, with a title saying which variable and where to change it. The inspector's
 * "remove" (danger), or the quiet × on a layer node's header (`compact`).
 *
 * **Changed.** Core `ActionButton` in place of the widgets `Button`.
 *
 * **Kept.** Its props, the words, the titles and the accessible name (`remove <label>` when compact).
 */
export function RemoveLayer({ preset, stage, onChange, compact = false }: Props) {
  const driven = drivenBy(preset, stage);
  return (
    <ActionButton
      tone={compact ? 'quiet' : 'danger'}
      label={compact ? `remove ${stage.label}` : undefined}
      disabled={!!driven}
      title={driven ? `motion's per-frame code sets ${driven}: change it there to take this off` : compact ? `take ${stage.label} off (its code is kept)` : 'take this layer off; its code is kept'}
      onPress={() => {
        const next = removeLayer(preset, stage.id);
        if (next) onChange(next);
      }}
    >
      {compact ? '×' : 'remove'}
    </ActionButton>
  );
}
