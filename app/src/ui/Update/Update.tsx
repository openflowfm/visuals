import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActionButton } from '@satoramoto/zen';
import { Modal } from '@satoramoto/zen';
import { Opaque } from '@satoramoto/zen';
import { Text } from '@satoramoto/zen';
import * as api from '../model/api';
import { useTauriEvent } from '../model/hooks';
import { listen, openUrl, type UnlistenFn } from '../model/ipc';
import { blocks, type Inline } from '../model/notes';
import './Update.css';

/**
 * Updates: the app looks for a newer version once when it opens, quietly, and
 * again whenever the menu's "Check for Updates…" asks (the `update-check`
 * event). A newer version is shown with what's new in it and installed only
 * when the user says so. Mount `<Update />` once, anywhere: it shows nothing
 * until there is something to say.
 */

/** Where the updates sheet is. */
export type UpdateState = { kind: 'idle' } | { kind: 'checking' } | { kind: 'found'; update: api.Update } | { kind: 'latest' } | { kind: 'said'; message: string } | { kind: 'installing' };

/** What a check came back with: an update, none, or what went wrong. */
export type CheckResult = { update: api.Update | null } | { error: string };

/**
 * What to show after a check. The one on launch (`asked` false) speaks only
 * when there is an update: being up to date, a build without updates and a
 * failed check are said only to someone who asked.
 */
export function afterCheck(result: CheckResult, asked: boolean): UpdateState {
  if ('error' in result) return asked ? { kind: 'said', message: result.error } : { kind: 'idle' };
  if (result.update) return { kind: 'found', update: result.update };
  return asked ? { kind: 'latest' } : { kind: 'idle' };
}

/** The day a release came out, from the date the app gives (`2026-10-08 6:00:00.0 +00:00:00`), or null. */
export function day(date: string | null): string | null {
  return date?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
}

const onUpdateCheck = (f: (payload: unknown) => void): Promise<UnlistenFn> => listen(api.UPDATE_CHECK_EVENT, (e) => f(e.payload));

const check = (): Promise<CheckResult> =>
  api.updateCheck().then(
    (update) => ({ update }),
    (e: unknown) => ({ error: String(e) }),
  );

/**
 * One run of the notes, drawn as React elements, so every bit of text is escaped. Bold and code
 * are Text (`bold`: inside a bold run, so code keeps the strong weight it would inherit).
 */
function Run({ run, bold }: { run: Inline; bold?: boolean }): ReactNode {
  switch (run.kind) {
    case 'text':
      return run.text;
    case 'code':
      return (
        <Text as="code" role="code" size="caption" weight={bold ? 'strong' : undefined}>
          {run.text}
        </Text>
      );
    case 'bold':
      return (
        <Text as="strong" size="inherit" weight="strong">
          <Runs runs={run.children} bold />
        </Text>
      );
    case 'link':
      // In the system browser, never inside the app's own window.
      return (
        <a
          href={run.href}
          title={run.href}
          onClick={(e) => {
            e.preventDefault();
            void openUrl(run.href);
          }}
        >
          {run.text}
        </a>
      );
  }
}

const Runs = ({ runs, bold }: { runs: Inline[]; bold?: boolean }) => runs.map((run, i) => <Run key={i} run={run} bold={bold} />);

/** The release notes, with their paragraphs, lists, bold, code and links. */
export function Notes({ notes }: { notes: string }) {
  const parts = useMemo(() => blocks(notes), [notes]);
  return parts.map((block, i) => {
    switch (block.kind) {
      case 'paragraph':
        return (
          <p key={i}>
            <Runs runs={block.children} />
          </p>
        );
      case 'heading':
        return (
          <p key={i}>
            <Text as="strong" size="inherit" weight="strong">
              <Runs runs={block.children} bold />
            </Text>
          </p>
        );
      case 'list':
        return (
          <ul key={i}>
            {block.items.map((item, j) => (
              <li key={j}>
                <Runs runs={item} />
              </li>
            ))}
          </ul>
        );
    }
  });
}

/** A core `Modal` in an `Opaque` scope: it may open over the native preview. */
function Dialog({ title, onClose, actions, children }: { title: string; onClose(): void; actions?: ReactNode; children?: ReactNode }) {
  return (
    <Opaque className="vs-update">
      <Modal title={title} onClose={onClose} actions={actions} className="vs-update-dialog">
        {children}
      </Modal>
    </Opaque>
  );
}

/**
 * **Job.** The updates dialog: quiet on launch unless a newer version is out; the menu's "Check
 * for Updates…" also says when there is none, or what went wrong.
 *
 * **Changed.** The core `Modal` (an `overlay` layer) inside an `Opaque` scope, its buttons core
 * `ActionButton`s. Tauri's `listen` and the opener's `openUrl` come through the bridge
 * (`model/ipc`). The notes' scrolling box is a class (`vs-update-notes`), not an inline style.
 *
 * **Kept.** Every export (`UpdateState`, `CheckResult`, `afterCheck`, `day`, `Notes`, `Update`),
 * every state, the copy and the dialog names.
 */
export function Update() {
  const [state, setState] = useState<UpdateState>({ kind: 'idle' });

  // Once, on launch, quietly.
  useEffect(() => {
    let live = true;
    check().then((result) => {
      if (live) setState((now) => (now.kind === 'idle' ? afterCheck(result, false) : now));
    });
    return () => {
      live = false;
    };
  }, []);

  useTauriEvent(onUpdateCheck, () => {
    if (state.kind === 'installing' || state.kind === 'checking') return;
    setState({ kind: 'checking' });
    check().then((result) => setState(afterCheck(result, true)));
  });

  const close = useCallback(() => setState((now) => (now.kind === 'installing' ? now : { kind: 'idle' })), []);

  const install = useCallback(() => {
    setState({ kind: 'installing' });
    // On success the app restarts into the new version, so only a failure comes back.
    api.updateInstall().catch((e: unknown) => setState({ kind: 'said', message: String(e) }));
  }, []);

  switch (state.kind) {
    case 'idle':
      return null;
    case 'checking':
      return (
        <Dialog title="Updates" onClose={close}>
          <p>Looking for a newer version…</p>
        </Dialog>
      );
    case 'latest':
      return (
        <Dialog title="Updates" onClose={close}>
          <p>You have the latest version.</p>
        </Dialog>
      );
    case 'said':
      return (
        <Dialog title="Updates" onClose={close}>
          <p>{state.message}</p>
        </Dialog>
      );
    case 'installing':
      return (
        <Dialog title="Updating" onClose={close}>
          <p>Downloading and installing. visual[flow] opens again when it's done.</p>
        </Dialog>
      );
    case 'found': {
      const { version, notes, date } = state.update;
      const when = day(date);
      return (
        <Dialog
          title={`Version ${version} is out`}
          onClose={close}
          actions={
            <>
              <ActionButton onPress={install}>Install and restart</ActionButton>
              <ActionButton tone="quiet" onPress={close}>
                Later
              </ActionButton>
            </>
          }
        >
          {when && <p>Released {when}.</p>}
          <p>What's new:</p>
          <div className="vs-update-notes">{notes.trim() ? <Notes notes={notes} /> : <p>The release says nothing about it.</p>}</div>
        </Dialog>
      );
    }
  }
}
