import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { Button } from '@openflow/widgets/controls/Button.tsx';
import * as pack from './pack.ts';
import './credits.css';

/** A line the pack bar says after an add: how many came in, or why none did. */
export interface Note {
  text: string;
  error: boolean;
}

const count = (n: number) => n.toLocaleString('en-US');
const why = (e: unknown) => (e instanceof Error ? e.message : String(e));
const added = (n: number): Note => ({ text: `Added ${count(n)} preset${n === 1 ? '' : 's'}`, error: false });
const failed = (e: unknown): Note => ({ text: why(e), error: true });

/** Calls `subscribe`'s listener until unmount, unlistening even when it resolves after. */
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

/** Calls `open` when the app menu's Credits item is chosen. */
export function useCreditsMenu(open: () => void) {
  const latest = useRef(open);
  latest.current = open;
  useListen(() => pack.onCredits(() => latest.current()));
}

/**
 * Files dragged onto the window: `over` while they are above it, for the library's
 * highlight; on a drop their paths go to `pack.add`, and `note` says how it went.
 */
export function useDropToAdd(): { over: boolean; note: Note | null } {
  const [over, setOver] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  useListen(() =>
    getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === 'enter' || payload.type === 'over') {
        setOver(true);
      } else if (payload.type === 'leave') {
        setOver(false);
      } else {
        setOver(false);
        if (!payload.paths.length) return;
        pack.add(payload.paths.map((path) => ({ path }))).then(
          (n) => setNote(added(n)),
          (e) => setNote(failed(e)),
        );
      }
    }),
  );
  return { over, note };
}

export interface PackBarProps {
  /** Presets in the library now. */
  presets: number;
  /** The latest drop's note, from `useDropToAdd`. */
  dropped: Note | null;
  credits: boolean;
  onCredits(): void;
}

/**
 * The foot of the library: how many presets it has, getting the full library
 * (with its progress, and a retry when it fails), adding a folder of presets,
 * and the credits.
 */
export function PackBar({ presets, dropped, credits, onCredits }: PackBarProps) {
  const [status, setStatus] = useState<pack.PackStatus | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);

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
  useEffect(() => setNote(dropped), [dropped]);

  const action = status && pack.packAction(status);

  const download = () => {
    if (!status) return;
    setStatus({ ...status, state: 'downloading', error: null });
    pack.download().then(
      () => pack.status().then(setStatus, () => {}),
      (e) => setStatus((s) => s && { ...s, state: 'failed', error: why(e) }),
    );
  };

  const pick = async (ev: ChangeEvent<HTMLInputElement>) => {
    const input = ev.currentTarget;
    const files = Array.from(input.files ?? []).filter((f) => /\.milk$/i.test(f.name));
    input.value = ''; // the same folder can be picked again
    if (!files.length) {
      setNote({ text: 'No .milk files in that folder.', error: true });
      return;
    }
    try {
      const items = await Promise.all(files.map(async (f) => ({ name: f.webkitRelativePath || f.name, text: await f.text() })));
      setNote(added(await pack.add(items)));
    } catch (e) {
      setNote(failed(e));
    }
  };

  return (
    <div className="pack">
      {action && (
        <div className="pack-get" data-state={action.state}>
          {action.state === 'downloading' ? (
            <div className="pack-progress" role="progressbar" aria-label={action.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((action.progress ?? 0) * 100)}>
              <span className="pack-progress-fill" style={{ width: `${(action.progress ?? 0) * 100}%` }} />
              <span className="pack-progress-label">{action.label}</span>
            </div>
          ) : (
            <Button className="pack-download" onPress={download} title="Download every preset in projectM's Cream of the Crop into the presets folder">
              {action.label}
            </Button>
          )}
          {action.error && (
            <p className="pack-note" data-error="" role="alert">
              {action.error}
            </p>
          )}
        </div>
      )}
      {note && (
        <p className="pack-note" data-error={note.error ? '' : undefined} role="status">
          {note.text}
        </p>
      )}
      <div className="pack-row">
        <span className="pack-count">{count(presets)} presets</span>
        <Button tone="quiet" onPress={() => picker.current?.click()} title="Copy a folder of .milk presets into the library">
          Add a folder…
        </Button>
        <Button tone="quiet" onPress={onCredits} title={credits ? 'Back to the presets' : 'Who made these presets, and the terms they come under'}>
          {credits ? 'Presets' : 'Credits'}
        </Button>
      </div>
      <input
        ref={(el) => {
          picker.current = el;
          el?.setAttribute('webkitdirectory', ''); // a folder, not files; React has no prop for it
        }}
        className="pack-picker"
        type="file"
        multiple
        hidden
        tabIndex={-1}
        onChange={pick}
      />
    </div>
  );
}
