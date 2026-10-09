import { Button } from '@openflow/widgets/controls/Button.tsx';

/**
 * ⚙ Settings (#98), a sheet over any view: opened with `openSheet('settings')`
 * from `views.tsx`, mounted by `App`. A placeholder until 0.5.
 */
export function Settings({ open, onClose }: { open: boolean; onClose(): void }) {
  if (!open) return null;
  return (
    <div className="vf-sheet" role="dialog" aria-label="Settings">
      <div className="vf-sheet-head">
        <h2>Settings</h2>
        <Button tone="quiet" label="Close settings" title="Close" onPress={onClose}>
          ✕
        </Button>
      </div>
      <p>Settings come in 0.5.</p>
    </div>
  );
}
