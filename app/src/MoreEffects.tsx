import { Button } from '@openflow/widgets/controls/Button.tsx';

/**
 * The More effects drawer (#98), a sheet over any view: opened with
 * `openSheet('effects')` from `views.tsx`, mounted by `App`. A placeholder until
 * its 0.5 lane (#98) lands.
 */
export function MoreEffects({ open, onClose }: { open: boolean; onClose(): void }) {
  if (!open) return null;
  return (
    <div className="vf-sheet" role="dialog" aria-label="More effects">
      <div className="vf-sheet-head">
        <h2>More effects</h2>
        <Button tone="quiet" label="Close more effects" title="Close" onPress={onClose}>
          ✕
        </Button>
      </div>
      <p>More effects are coming in a later 0.5 lane.</p>
    </div>
  );
}
