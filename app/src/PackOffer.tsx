import { useEffect, useRef, useState, type JSX } from 'react';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import * as pack from './pack.ts';
import { say } from './words.ts';
import './credits.css';
import './settings.css';

const count = (n: number) => n.toLocaleString('en-US');
const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Calls `subscribe`'s listener until unmount, unlistening even when it resolves after (as Pack.tsx's `useListen`). */
function useListen(subscribe: () => Promise<UnlistenFn>) {
  const latest = useRef(subscribe);
  latest.current = subscribe;
  useEffect(() => {
    let live = true;
    let unlisten: UnlistenFn | undefined;
    let pending: Promise<UnlistenFn>;
    try {
      pending = latest.current();
    } catch {
      return; // not in the app (a browser tab, a test): nothing to follow
    }
    pending.then(
      (u) => (live ? (unlisten = u) : u()),
      () => {},
    );
    return () => {
      live = false;
      unlisten?.();
    };
  }, []);
}

/** Whether to offer: s.installed <= s.starter, or a download running or failed. Exported for the test. */
export function offers(s: pack.PackStatus): boolean {
  return s.installed <= s.starter || s.state === 'downloading' || s.state === 'failed';
}

/**
 * The library's one-line empty-state offer (decision 67): "These are the 120
 * starter presets. [Get the full library: 9,795 presets (180 MB)]" while only
 * the starter set is in; the download's progress while it runs (a progressbar
 * named like Pack.tsx's), and its error with the retry; nothing once more than
 * the starter set is installed or the pack is complete.
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
  useListen(() => pack.onProgress(setStatus));

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
    <div className="pack-offer" role="status">
      {action.state === 'downloading' ? (
        <span className="pack-progress" role="progressbar" aria-label={action.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((action.progress ?? 0) * 100)}>
          <span className="pack-progress-fill" style={{ width: `${(action.progress ?? 0) * 100}%` }} />
          <span className="pack-progress-label">{action.label}</span>
        </span>
      ) : (
        <>
          {action.error ? (
            <span className="pack-offer-error">{action.error}</span>
          ) : (
            <span>
              These are the {count(status.starter)} {say('starter set')}.
            </span>
          )}
          <Button className="pack-offer-get" onPress={download} title="Download every preset in projectM's Cream of the Crop into the presets folder">
            {action.label}
          </Button>
        </>
      )}
    </div>
  );
}
