import { useEffect, useState, type JSX } from 'react';
import { ActionButton } from '@satoramoto/zen';
import { Text } from '@satoramoto/zen';
import * as pack from '../model/pack';
import { say } from '../model/words';
import { useTauriEvent } from '../model/hooks';
import { PackProgress } from '../Pack/Pack';
import './PackOffer.css';

const count = (n: number) => n.toLocaleString('en-US');
const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Whether to offer: s.installed <= s.starter, a download running or failed, or the full library in without its pictures. Exported for the test. */
export function offers(s: pack.PackStatus): boolean {
  return s.installed <= s.starter || s.state === 'downloading' || s.state === 'failed' || s.bare === true;
}

/**
 * **Job.** The library's one-line empty-state offer (decision 67): "These are the 120 starter
 * presets. [Get the full library: 9,795 presets (180 MB)]" while only the starter set is in; the
 * download's progress while it runs (a progressbar named like Pack's), and its error with the
 * retry; when the full library came without its pictures (projectM's fallback), that, with the
 * retry for them; nothing once more than the starter set is installed or the pack is complete
 * with its pictures.
 *
 * **Changed.** One quiet line of type on the main column's inset (`--mat-plate-inset`); the
 * button is the core `ActionButton`; the progress is Pack's `PackProgress` (a tone step, no box)
 * rather than a second copy of its markup; the app's `useTauriEvent` for the progress.
 *
 * **Kept.** When it offers, every line and label, the `role="status"` and the download flow.
 */
export function PackOffer(): JSX.Element | null {
  const [status, setStatus] = useState<pack.PackStatus | null>(null);

  useEffect(() => {
    let live = true;
    pack.status().then(
      (s) => live && setStatus(s),
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);
  useTauriEvent(pack.onProgress, setStatus);

  const action = status && offers(status) ? pack.packAction(status) : null;
  if (!status || !action) return null;

  const download = () => {
    setStatus({ ...status, state: 'downloading', error: null });
    pack.download().then(
      () => pack.status().then(setStatus, () => {}),
      (e) => setStatus((s) => s && { ...s, state: 'failed', error: why(e) }),
    );
  };

  return (
    <Text as="div" tabular className="vs-pack-offer" ariaRole="status">
      {action.state === 'downloading' ? (
        <PackProgress action={action} />
      ) : (
        <>
          {action.error ? (
            <span className="vs-pack-offer-error">{action.error}</span>
          ) : action.note ? (
            <span>{action.note}</span>
          ) : (
            <span>
              These are the {count(status.starter)} {say('starter set')}.
            </span>
          )}
          <ActionButton className="vs-pack-offer-get" onPress={download} title="Download every preset in projectM's Cream of the Crop into the presets folder">
            {action.label}
          </ActionButton>
        </>
      )}
    </Text>
  );
}
