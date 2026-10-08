import { Button } from '@openflow/widgets/controls/Button.tsx';
import type { Preset } from '../api.ts';
import { drivenBy, removeLayer, type Stage } from '../stages.ts';

interface Props {
  preset: Preset;
  stage: Stage;
  onChange(next: Preset): void;
  /** The × on a layer node's header, rather than the inspector's "remove". */
  compact?: boolean;
}

/** Takes a layer off, its code kept; disabled while motion's per-frame code turns it on regardless. */
export function RemoveLayer({ preset, stage, onChange, compact = false }: Props) {
  const driven = drivenBy(preset, stage);
  return (
    <Button
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
    </Button>
  );
}
